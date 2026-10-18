import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// Non-2xx response from our server; `status` lets callers tell e.g. 404 from 503.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Calls our server with the user's access token attached.
// Use this for every server request (/analyze, /score, /checkout, ...).
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new ApiError(`${init.method ?? 'GET'} ${path} failed: ${res.status}`, res.status);
  return res.json() as Promise<T>;
}
