/**
 * The shape every tool returns. A raw API error is never thrown at the model:
 * it is translated into one of these so the caller can branch on `status`.
 */

export interface Candidate {
  id: number;
  name: string;
  /** Disambiguating detail for a human — e.g. "last interaction 2026-03-14". */
  hint: string;
}

export type ToolResult<T> =
  | ({ status: 'ok' } & T)
  | { status: 'ambiguous'; query: string; candidates: Candidate[] }
  | { status: 'not_found'; query: string; near_misses: Candidate[] }
  | { status: 'rate_limited'; retry_after_seconds: number | null; message: string }
  | { status: 'error'; message: string };

export const ok = <T extends object>(value: T): ToolResult<T> => ({ status: 'ok', ...value });

export const ambiguous = <T>(query: string, candidates: Candidate[]): ToolResult<T> => ({
  status: 'ambiguous',
  query,
  candidates,
});

export const notFound = <T>(query: string, nearMisses: Candidate[] = []): ToolResult<T> => ({
  status: 'not_found',
  query,
  near_misses: nearMisses,
});

export const rateLimited = <T>(retryAfterSeconds: number | null): ToolResult<T> => ({
  status: 'rate_limited',
  retry_after_seconds: retryAfterSeconds,
  message:
    'Monica rate limit exhausted. Nothing was written. The capture is unchanged; retry later.',
});

export const failed = <T>(message: string): ToolResult<T> => ({ status: 'error', message });
