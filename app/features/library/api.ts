import { decode } from 'base64-arraybuffer';
import { randomUUID } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { AnalysisOutput, LibraryItem, ScoreOutput } from '../../../shared/contracts';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiFetch';

const BUCKET = 'thumbnails';
const THUMB_WIDTH = 400;

interface SaveItemInput {
  photoUri: string; // local file uri from the camera
  analysis: AnalysisOutput;
  score: ScoreOutput;
}

// Called on swipe-left. Swipe-right (delete) must never call this.
export async function saveItem({ photoUri, analysis, score }: SaveItemInput): Promise<LibraryItem> {
  // getSession reads the cached session, so rapid-fire saves don't each hit the network.
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error('not signed in');
  if (!score.best_listing) throw new Error('no listing to save'); // items.best_listing is NOT NULL

  const id = randomUUID();
  const path = `${userId}/${id}.jpg`;

  // Resize before upload; RN can't reliably upload Blobs, so send an ArrayBuffer.
  const rendered = await ImageManipulator.manipulate(photoUri).resize({ width: THUMB_WIDTH }).renderAsync();
  const thumb = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(thumb.base64!), { contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;

  const thumbnail_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { data, error } = await supabase
    .from('items')
    .insert({
      id,
      thumbnail_url,
      name: analysis.name,
      summary: analysis.summary,
      category: analysis.category,
      brand: analysis.brand,
      model: analysis.model,
      score: Math.round(score.score), // column is int 0..100
      verdict: score.verdict,
      subscores: score.subscores,
      best_listing: score.best_listing,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data as LibraryItem;
}

export async function listItems(): Promise<LibraryItem[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as LibraryItem[];
}

export async function getItem(id: string): Promise<LibraryItem | null> {
  const { data, error } = await supabase.from('items').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as LibraryItem | null;
}

// The backend serializes cancellation with the watcher's purchase claim.
export async function stopWatching(id: string): Promise<void> {
  await apiFetch(`/checkout/items/${id}/autobuy`, { method: 'DELETE' });
}

export async function removeItem(item: Pick<LibraryItem, 'id' | 'user_id'>): Promise<void> {
  const { error } = await supabase.from('items').delete().eq('id', item.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([`${item.user_id}/${item.id}.jpg`]);
}
