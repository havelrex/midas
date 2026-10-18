import type { AnalysisOutput, ScoreOutput } from '../../shared/contracts';
import { ApiError, apiFetch } from './apiFetch';

// The server has no /score route yet (Havel). A 404 means "not built", not "this item failed".
export class ScoreUnavailableError extends Error {}

// The photo gave no model number (server answers 422); the user must retake.
export class ScoreNeedsModelError extends Error {}

export async function scoreItem(analysis: AnalysisOutput, signal?: AbortSignal): Promise<ScoreOutput> {
  try {
    return await apiFetch<ScoreOutput>('/score', { method: 'POST', signal, body: JSON.stringify(analysis) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new ScoreUnavailableError('Scoring is not available yet');
    if (e instanceof ApiError && e.status === 422) throw new ScoreNeedsModelError('Exact model unknown');
    throw e;
  }
}
