import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useCallback, useEffect, useId, useState } from 'react';
import type { LibraryItem } from '../../../shared/contracts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { getItem, listItems } from './api';

// Applies one Realtime change to the newest-first list.
export function applyChange(
  prev: LibraryItem[],
  payload: Pick<RealtimePostgresChangesPayload<LibraryItem>, 'eventType' | 'new' | 'old'>,
): LibraryItem[] {
  if (payload.eventType === 'DELETE') {
    return prev.filter((i) => i.id !== (payload.old as Partial<LibraryItem>).id);
  }
  const row = payload.new as LibraryItem;
  if (payload.eventType === 'INSERT') {
    return [row, ...prev.filter((i) => i.id !== row.id)];
  }
  return prev.map((i) => (i.id === row.id ? row : i));
}

// All of the signed-in user's saved items, newest first, kept live via Realtime
// (so e.g. checkout_status flipping to 'purchased' shows up without a refresh).
export function useLibrary() {
  const { userId } = useAuth();
  const instanceId = useId(); // unique channel per hook instance; topics can't be shared
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listItems());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    refresh();

    const channel = supabase
      .channel(`items:${userId}:${instanceId}`)
      .on<LibraryItem>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${userId}` },
        (payload) => setItems((prev) => applyChange(prev, payload)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, instanceId, refresh]);

  return { items, loading, error, refresh };
}

// A single saved item for the detail screen, kept live via Realtime.
export function useItem(id: string | undefined) {
  const instanceId = useId();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) return;
    getItem(id)
      .then(setItem, setError)
      .finally(() => setLoading(false));

    const channel = supabase
      .channel(`item:${id}:${instanceId}`)
      .on<LibraryItem>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'items', filter: `id=eq.${id}` },
        (payload) => setItem(payload.new as LibraryItem),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, instanceId]);

  return { item, loading, error };
}
