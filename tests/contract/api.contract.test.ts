import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doGet, doPost } from '../../backend/src/main';
import {
  BACKEND_ERROR_CODES,
  MAX_ITEM_CODE_LENGTH,
  MAX_ITEM_NAME_LENGTH,
} from '../../backend/src/sheetsLogic';
import { createMockGasHarness, type MockGasHarness } from '../../backend/test/mockGasHarness';
import {
  createItem,
  fetchItems,
  GasApiError,
  SERVER_ERROR_CODES,
} from '../../frontend/src/api/gasClient';

const ABSOLUTE_GAS_URL = 'https://script.google.com/macros/s/contract-test/exec';
const RELATIVE_GAS_URL = '/api/gas';

/**
 * Thin in-memory `fetch` adapter bridging frontend `gasClient` directly to
 * backend `doGet` and `doPost` handlers so DTOs, payload serialization,
 * envelopes, and canonical error codes are verified end-to-end across workspaces (ADR-0001).
 */
function createInMemoryGasFetch(): typeof fetch {
  return async (input, init) => {
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsedUrl = new URL(rawUrl, 'https://contract.local');
    const method = (init?.method ?? 'GET').toUpperCase();

    let output: GoogleAppsScript.Content.TextOutput;
    if (method === 'GET') {
      const parameter: Record<string, string> = {};
      parsedUrl.searchParams.forEach((value, key) => {
        parameter[key] = value;
      });
      output = doGet({ parameter } as GoogleAppsScript.Events.DoGet);
    } else if (method === 'POST') {
      const contents = typeof init?.body === 'string' ? init.body : '';
      output = doPost({ postData: { contents } } as GoogleAppsScript.Events.DoPost);
    } else {
      return new Response('Method Not Allowed', { status: 405 });
    }

    expect(output.getMimeType()).toBe('JSON');
    return new Response(output.getContent(), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  };
}

describe('Cross-workspace API contract (frontend gasClient <-> backend doGet/doPost)', () => {
  let harness: MockGasHarness;

  beforeEach(() => {
    harness = createMockGasHarness();
    harness.setProperty('SPREADSHEET_ID', 'contract-sheet-id');
    vi.stubGlobal('fetch', createInMemoryGasFetch());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps canonical server error codes aligned between frontend and backend', () => {
    expect(SERVER_ERROR_CODES).toEqual(BACKEND_ERROR_CODES);
  });

  it('round-trips createItem and fetchItems preserving leading-zero Item codes over absolute and relative URLs', async () => {
    const initial = await fetchItems({ apiUrl: ABSOLUTE_GAS_URL });
    expect(initial).toEqual([]);
    expect(harness.sheets.has('Items')).toBe(false);

    const created = await createItem(
      { code: '00123', name: 'Leading Zero Widget' },
      { apiUrl: ABSOLUTE_GAS_URL },
    );

    expect(created).toMatchObject({
      id: 'uuid-1',
      code: '00123',
      name: 'Leading Zero Widget',
    });
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);

    const second = await createItem(
      { code: '054', name: 'Relative Path Widget' },
      { apiUrl: RELATIVE_GAS_URL },
    );

    const listed = await fetchItems({ apiUrl: RELATIVE_GAS_URL });
    expect(listed).toEqual([created, second]);
  });

  it('reads existing Date cells normalized to ISO-8601 strings and ignores blank rows', async () => {
    harness.seedSheet('Items', [
      ['code', 'name', 'createdAt', 'id'],
      ['', '', '', ''],
      ['00042', 'Seeded Widget', new Date('2026-11-20T08:30:00.000Z'), 'seed-1'],
    ]);

    const items = await fetchItems({ apiUrl: ABSOLUTE_GAS_URL });
    expect(items).toEqual([
      {
        id: 'seed-1',
        code: '00042',
        name: 'Seeded Widget',
        createdAt: '2026-11-20T08:30:00.000Z',
      },
    ]);
  });

  it('neutralizes formula injection prefixes consistently across create and read', async () => {
    const created = await createItem(
      { code: '=SUM(A1:A2)', name: '+1234' },
      { apiUrl: ABSOLUTE_GAS_URL },
    );

    expect(created.code).toBe("'=SUM(A1:A2)");
    expect(created.name).toBe("'+1234");

    const listed = await fetchItems({ apiUrl: ABSOLUTE_GAS_URL });
    expect(listed).toEqual([created]);
  });

  it('surfaces backend VALIDATION_ERROR as typed GasApiError on empty and over-length payloads', async () => {
    await expect(
      createItem({ code: '   ', name: 'Widget' }, { apiUrl: ABSOLUTE_GAS_URL }),
    ).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'VALIDATION_ERROR',
      message: 'Both code and name are required',
    });

    await expect(
      createItem(
        { code: '0'.repeat(MAX_ITEM_CODE_LENGTH + 1), name: 'Widget' },
        { apiUrl: ABSOLUTE_GAS_URL },
      ),
    ).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'VALIDATION_ERROR',
      message: `code must not exceed ${MAX_ITEM_CODE_LENGTH} characters`,
    });

    await expect(
      createItem(
        { code: '001', name: 'A'.repeat(MAX_ITEM_NAME_LENGTH + 1) },
        { apiUrl: ABSOLUTE_GAS_URL },
      ),
    ).rejects.toMatchObject({
      name: 'GasApiError',
      code: 'VALIDATION_ERROR',
      message: `name must not exceed ${MAX_ITEM_NAME_LENGTH} characters`,
    });
  });

  it('surfaces backend LOCK_TIMEOUT as typed GasApiError when ScriptLock is contended', async () => {
    harness.setLockAvailable(false);

    await expect(
      createItem({ code: '00123', name: 'Contended Item' }, { apiUrl: ABSOLUTE_GAS_URL }),
    ).rejects.toEqual(new GasApiError('LOCK_TIMEOUT', 'Server is busy, please retry'));
  });

  it('surfaces backend SCHEMA_ERROR on both fetchItems and createItem when headers are invalid', async () => {
    harness.seedSheet('Items', [['id', 'code']]);

    await expect(fetchItems({ apiUrl: ABSOLUTE_GAS_URL })).rejects.toEqual(
      new GasApiError('SCHEMA_ERROR', 'Missing required sheet header: name'),
    );

    await expect(
      createItem({ code: '00123', name: 'Widget' }, { apiUrl: ABSOLUTE_GAS_URL }),
    ).rejects.toEqual(new GasApiError('SCHEMA_ERROR', 'Missing required sheet header: name'));
  });

  it('surfaces backend CONFIG_MISSING on both fetchItems and createItem when SPREADSHEET_ID is unset', async () => {
    harness.setProperty('SPREADSHEET_ID', null);

    await expect(fetchItems({ apiUrl: ABSOLUTE_GAS_URL })).rejects.toEqual(
      new GasApiError('CONFIG_MISSING', 'SPREADSHEET_ID is not configured'),
    );

    await expect(
      createItem({ code: '00123', name: 'Widget' }, { apiUrl: ABSOLUTE_GAS_URL }),
    ).rejects.toEqual(new GasApiError('CONFIG_MISSING', 'SPREADSHEET_ID is not configured'));
  });

  it('surfaces backend INTERNAL_ERROR with generic message without leaking spreadsheet secrets', async () => {
    harness.setProperty('SPREADSHEET_ID', 'secret-contract-sheet-999');
    harness.setOpenByIdError(new Error('Failed opening secret-contract-sheet-999'));

    await expect(fetchItems({ apiUrl: ABSOLUTE_GAS_URL })).rejects.toEqual(
      new GasApiError('INTERNAL_ERROR', 'An internal server error occurred'),
    );
  });
});
