import { useCallback, useRef, useState } from 'react';
import type { AnalysisOutput, ScoreOutput } from '../../../shared/contracts';
import { removeItem, saveItem } from './api';

export type ScoreStatus = 'scoring' | 'ready' | 'unavailable' | 'error';

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
}

// Swipe-to-save and swipe-to-delete with a 5s Undo (render `banner` with <UndoBar key={banner.id}>).
// Save writes right away so the upload overlaps the Undo window; Undo then removes the row.
// Delete never touches the DB; Undo just hands the snap back.
export function useSaveSnap({ onRestore, onSaveFailed }: Options) {
  const [banner, setBanner] = useState<UndoBanner | null>(null);
  const nextId = useRef(0);
  const callbacks = useRef({ onRestore, onSaveFailed });
  callbacks.current = { onRestore, onSaveFailed };

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
      void pending.then((item) => item && removeItem(item)).catch((e) => {
        console.warn('undo save failed:', e instanceof Error ? e.message : e);
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
