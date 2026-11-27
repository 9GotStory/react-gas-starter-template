import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { GasApiError } from '../api/gasClient';
import { createQueryClient, shouldRetryGasQuery } from './queryClient';

function createFastRetryClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retryDelay: 0,
    },
  });
  return client;
}

describe('queryClient GAS-friendly defaults and selective retries', () => {
  it('configures GAS-friendly defaults and zero mutation retries', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.staleTime).toBe(5 * 60 * 1000);
    expect(defaults.queries?.retry).toBe(shouldRetryGasQuery);
    expect(defaults.mutations?.retry).toBe(0);
  });

  it.each([
    ['TIMEOUT', new GasApiError('TIMEOUT', 'Request timed out')],
    ['NETWORK_ERROR', new GasApiError('NETWORK_ERROR', 'Network failure')],
    ['LOCK_TIMEOUT', new GasApiError('LOCK_TIMEOUT', 'Server is busy, please retry')],
    ['HTTP 429', new GasApiError('HTTP_ERROR', 'Rate limited', { status: 429 })],
    ['HTTP 500', new GasApiError('HTTP_ERROR', 'Server error', { status: 500 })],
    ['HTTP 503', new GasApiError('HTTP_ERROR', 'Service unavailable', { status: 503 })],
  ])('retries queries at most once on transient error: %s', async (_label, transientError) => {
    const client = createFastRetryClient();
    const queryFn = vi.fn().mockRejectedValue(transientError);

    await expect(
      client.fetchQuery({
        queryKey: ['items', _label],
        queryFn,
      }),
    ).rejects.toBe(transientError);

    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('recovers when a transient query failure succeeds on the single retry', async () => {
    const client = createFastRetryClient();
    const queryFn = vi
      .fn()
      .mockRejectedValueOnce(new GasApiError('LOCK_TIMEOUT', 'Server is busy'))
      .mockResolvedValueOnce([
        { id: '1', code: '001', name: 'Recovered', createdAt: '2026-11-27T00:00:00.000Z' },
      ]);

    const result = await client.fetchQuery({
      queryKey: ['items', 'recover'],
      queryFn,
    });

    expect(result).toHaveLength(1);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ABORTED', new GasApiError('ABORTED', 'Request was aborted')],
    ['VALIDATION_ERROR', new GasApiError('VALIDATION_ERROR', 'Invalid payload')],
    ['CONFIG_MISSING', new GasApiError('CONFIG_MISSING', 'Missing SPREADSHEET_ID')],
    ['SCHEMA_ERROR', new GasApiError('SCHEMA_ERROR', 'Missing required sheet header: name')],
    ['INVALID_JSON', new GasApiError('INVALID_JSON', 'Invalid JSON')],
    ['INVALID_ACTION', new GasApiError('INVALID_ACTION', 'Unsupported action')],
    ['INTERNAL_ERROR', new GasApiError('INTERNAL_ERROR', 'Internal server error')],
    ['NON_JSON_RESPONSE', new GasApiError('NON_JSON_RESPONSE', 'HTML login page', { status: 200 })],
    ['INVALID_ENVELOPE', new GasApiError('INVALID_ENVELOPE', 'Malformed envelope')],
    ['INVALID_DATA', new GasApiError('INVALID_DATA', 'Data failed validation')],
    ['HTTP 400', new GasApiError('HTTP_ERROR', 'Bad request', { status: 400 })],
    ['HTTP 401', new GasApiError('HTTP_ERROR', 'Unauthorized', { status: 401 })],
    ['HTTP 403', new GasApiError('HTTP_ERROR', 'Forbidden', { status: 403 })],
    ['HTTP 404', new GasApiError('HTTP_ERROR', 'Not found', { status: 404 })],
    ['HTTP without status', new GasApiError('HTTP_ERROR', 'Unknown HTTP error')],
    ['unclassified Error', new Error('Unexpected bug')],
    ['raw AbortError', new DOMException('Aborted', 'AbortError')],
  ])(
    'never retries queries on non-transient or aborted error: %s',
    async (_label, nonTransientError) => {
      const client = createFastRetryClient();
      const queryFn = vi.fn().mockRejectedValue(nonTransientError);

      await expect(
        client.fetchQuery({
          queryKey: ['items', _label],
          queryFn,
        }),
      ).rejects.toBe(nonTransientError);

      expect(queryFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['TIMEOUT', new GasApiError('TIMEOUT', 'Timed out')],
    ['NETWORK_ERROR', new GasApiError('NETWORK_ERROR', 'Offline')],
    ['LOCK_TIMEOUT', new GasApiError('LOCK_TIMEOUT', 'Busy')],
    ['HTTP 503', new GasApiError('HTTP_ERROR', 'Unavailable', { status: 503 })],
  ])(
    'never automatically retries mutations even on transient error: %s',
    async (_label, transientError) => {
      const client = createFastRetryClient();
      const mutationFn = vi.fn().mockRejectedValue(transientError);
      const observer = new MutationObserver<unknown, Error, void>(client, { mutationFn });

      await expect(observer.mutate(undefined)).rejects.toBe(transientError);
      expect(mutationFn).toHaveBeenCalledTimes(1);
    },
  );
});
