import { useCallback, useRef, useState } from 'react';
import type { AnalysisOutput, ScoreOutput } from '../../../shared/contracts';
import { removeItem, saveItem } from './api';

// 'no_listing': scored, but no store sells it new, so there is no best listing and it cannot be saved.
export type ScoreStatus = 'scoring' | 'ready' | 'unavailable' | 'error' | 'no_listing';

// Everything on screen for one snap, so a swiped-away card can be put back exactly.
export interface Snap {
  photoUri: string;
  analysis: AnalysisOutput;
  score: ScoreOutput | null;
  scoreStatus: ScoreStatus;
}

export interface UndoBanner {
  id: number;
  message: string;
  undo: () => void;
}

interface Options {
  onRestore: (snap: Snap) => void; // Undo of a delete: show the card again
  onSaveFailed: (snap: Snap) => void; // the write failed after the card was swiped away
  onUndoFailed: () => void; // Undo of a save couldn't remove the row, so it's still in the Library
}

const UNDO_RETRY_DELAY_MS = 1500;

// Undo of a save gets one retry (e.g. a signal blip) before giving up.
async function removeWithRetry(item: Parameters<typeof removeItem>[0]): Promise<void> {
  try {
    await removeItem(item);
  } catch {
    await new Promise((r) => setTimeout(r, UNDO_RETRY_DELAY_MS));
    await removeItem(item);
  }
}

// Swipe-to-save and swipe-to-delete with a 5s Undo (render `banner` with <UndoBar key={banner.id}>).
// Save writes right away so the upload overlaps the Undo window; Undo then removes the row.
// Delete never touches the DB; Undo just hands the snap back.
export function useSaveSnap({ onRestore, onSaveFailed, onUndoFailed }: Options) {
  const [banner, setBanner] = useState<UndoBanner | null>(null);
  const nextId = useRef(0);
  const callbacks = useRef({ onRestore, onSaveFailed, onUndoFailed });
  callbacks.current = { onRestore, onSaveFailed, onUndoFailed };

  const show = useCallback((message: string, undo: () => void) => {
    const id = ++nextId.current;
    setBanner({ id, message, undo: () => { setBanner((b) => (b?.id === id ? null : b)); undo(); } });
    return id;
  }, []);

  const save = useCallback((snap: Snap) => {
    if (!snap.score) return; // items needs a score; the card blocks this swipe anyway
    let undone = false;
    const pending = saveItem({ photoUri: snap.photoUri, analysis: snap.analysis, score: snap.score }).catch((e) => {
      console.warn('saveItem failed:', e instanceof Error ? e.message : e);
      setBanner((b) => (b?.id === id ? null : b));
      if (!undone) callbacks.current.onSaveFailed(snap);
      return null;
    });
    const id = show('Saved to Library', () => {
      undone = true;
      // Undo can land before the upload finishes: wait for the row, then delete it.
      void pending.then((item) => item && removeWithRetry(item)).catch((e) => {
        console.warn('undo save failed:', e instanceof Error ? e.message : e);
        callbacks.current.onUndoFailed();
      });
    });
  }, [show]);

  const discard = useCallback((snap: Snap) => {
    show('Deleted', () => callbacks.current.onRestore(snap));
  }, [show]);

  // UndoBar's onExpire: only clear the banner it belongs to.
  const dismiss = useCallback((id: number) => {
    setBanner((b) => (b?.id === id ? null : b));
  }, []);

  return { banner, save, discard, dismiss };
}
