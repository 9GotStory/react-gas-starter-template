import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createItem,
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchItems,
  GasApiError,
  parseGasEnvelope,
} from './gasClient';

function createAbortAwareHangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal?.addEventListener(
        'abort',
        () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true },
      );
    });
  });
}

describe('parseGasEnvelope', () => {
  const isString = (v: unknown): v is string => typeof v === 'string';

  it('returns typed data when ok is true and validator passes', () => {
    const result = parseGasEnvelope({ ok: true, data: 'hello' }, isString);
    expect(result).toBe('hello');
  });

  it('throws GasApiError when ok is false', () => {
    expect(() =>
      parseGasEnvelope(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Missing code' } },
        isString,
      ),
    ).toThrowError(new GasApiError('VALIDATION_ERROR', 'Missing code'));
  });

  it('throws GasApiError on malformed envelope', () => {
    expect(() => parseGasEnvelope('not-an-object', isString)).toThrowError(
      new GasApiError('INVALID_ENVELOPE', 'Malformed response envelope from GAS API'),
    );
  });

  it('throws GasApiError when data fails validation', () => {
    expect(() => parseGasEnvelope({ ok: true, data: 123 }, isString)).toThrowError(
      new GasApiError('INVALID_DATA', 'Response data failed boundary validation'),
    );
  });
});

describe('gasClient HTTP calls', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends POST with text/plain;charset=utf-8 and AbortSignal to avoid CORS preflight', async () => {
    const created = {
      id: '1',
      code: '0042',
      name: 'Sample',
      createdAt: '2026-11-20T00:00:00.000Z',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: created }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createItem(
      { code: '0042', name: 'Sample' },
      { apiUrl: 'https://script.google.com/macros/s/test/exec' },
    );

    expect(result).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://script.google.com/macros/s/test/exec');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(init.body).toBe(
      JSON.stringify({
        action: 'createItem',
        payload: { code: '0042', name: 'Sample' },
      }),
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fetches and validates item list via GET with absolute URL preserving existing query params', async () => {
    const items = [
      { id: '1', code: '0042', name: 'Sample', createdAt: '2026-11-20T00:00:00.000Z' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: items }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchItems({
      apiUrl: 'https://script.google.com/macros/s/test/exec?env=staging',
    });

    expect(result).toEqual(items);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'https://script.google.com/macros/s/test/exec?env=staging&action=listItems',
    );
    expect(init.method).toBe('GET');
  });

  it('supports relative URL paths for both GET and POST requests', async () => {
    const items = [
      { id: '1', code: '00123', name: 'Mock Item', createdAt: '2026-11-20T00:00:00.000Z' },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: items }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: items[0] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const fetched = await fetchItems({ apiUrl: '/api/gas?mode=mock' });
    const created = await createItem({ code: '00123', name: 'Mock Item' }, { apiUrl: '/api/gas' });

    expect(fetched).toEqual(items);
    expect(created).toEqual(items[0]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gas?mode=mock&action=listItems');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/gas');
  });

  it('enforces default 20-second timeout and classifies expiration as TIMEOUT', async () => {
    vi.useFakeTimers();
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(20_000);

    vi.stubGlobal('fetch', createAbortAwareHangingFetch());

    const requestPromise = fetchItems({ apiUrl: '/api/gas' });
    const expectation = expect(requestPromise).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(20_000);
    await expectation;
  });

  it('supports custom timeoutMs and distinguishes TIMEOUT from caller ABORTED', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', createAbortAwareHangingFetch());

    const callerController = new AbortController();
    const requestPromise = createItem(
      { code: '001', name: 'Slow Item' },
      { apiUrl: '/api/gas', timeoutMs: 250, signal: callerController.signal },
    );
    const expectation = expect(requestPromise).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(250);
    await expectation;
    expect(callerController.signal.aborted).toBe(false);
  });

  it('classifies mid-flight caller AbortSignal cancellation as ABORTED rather than TIMEOUT', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', createAbortAwareHangingFetch());

    const callerController = new AbortController();
    const requestPromise = fetchItems({
      apiUrl: '/api/gas',
      timeoutMs: 10_000,
      signal: callerController.signal,
    });
    const expectation = expect(requestPromise).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'ABORTED',
    });

    callerController.abort();
    await expectation;
  });

  it('rejects immediately with ABORTED without calling fetch when caller signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const callerController = new AbortController();
    callerController.abort();

    await expect(
      fetchItems({ apiUrl: '/api/gas', signal: callerController.signal }),
    ).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'ABORTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies HTTP 200 HTML response as NON_JSON_RESPONSE instead of raw SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html><body>Google Sign-In</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    await expect(fetchItems({ apiUrl: '/api/gas' })).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'NON_JSON_RESPONSE',
      status: 200,
    });
  });

  it('classifies HTTP 200 unparseable plain-text response as NON_JSON_RESPONSE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Apps Script temporary error page', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      ),
    );

    await expect(
      createItem({ code: '001', name: 'Test' }, { apiUrl: '/api/gas' }),
    ).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'NON_JSON_RESPONSE',
      status: 200,
    });
  });

  it('preserves HTTP status on non-2xx responses as HTTP_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );

    await expect(fetchItems({ apiUrl: '/api/gas' })).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'HTTP_ERROR',
      status: 429,
    });
  });

  it('classifies fetch network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fetchItems({ apiUrl: '/api/gas' })).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'NETWORK_ERROR',
    });
  });
});
