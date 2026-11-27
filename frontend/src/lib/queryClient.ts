import { QueryClient } from '@tanstack/react-query';
import { GasApiError } from '../api/gasClient';

export const MAX_QUERY_RETRIES = 1;

/**
 * Identifies transient GAS / network errors safe to retry once on read queries:
 * `TIMEOUT`, `NETWORK_ERROR`, `LOCK_TIMEOUT`, and HTTP `429` / `5xx`.
 * Never retries `ABORTED` or client/validation/config/contract errors.
 */
export function isTransientGasError(error: unknown): boolean {
  if (!(error instanceof GasApiError)) {
    return false;
  }

  switch (error.code) {
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
    case 'LOCK_TIMEOUT':
      return true;
    case 'HTTP_ERROR':
      return (
        error.status === 429 ||
        (typeof error.status === 'number' && error.status >= 500 && error.status < 600)
      );
    default:
      return false;
  }
}

/**
 * Selective TanStack Query retry policy tuned for GAS execution quotas:
 * retries queries at most once and strictly for transient errors.
 */
export function shouldRetryGasQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }
  return isTransientGasError(error);
}

/**
 * Creates a QueryClient tuned for Google Apps Script Web App limits:
 * disables window-focus refetches, caches for 5 minutes, retries queries at most once
 * strictly on transient errors, and enforces zero automatic retries for mutations.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
        retry: shouldRetryGasQuery,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryClient = createQueryClient();
