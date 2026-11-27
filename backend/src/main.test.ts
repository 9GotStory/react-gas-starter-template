import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doGet, doPost } from './main';
import {
  ITEMS_HEADERS,
  MAX_ITEM_CODE_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_REQUEST_BODY_LENGTH,
} from './sheetsLogic';

interface RangeWriteSnapshot {
  row: number;
  col: number;
  values: unknown[][];
  formatsAtWriteTime: string[][];
}

interface MockSheetState {
  name: string;
  values: unknown[][];
  formats: string[][];
  writes: RangeWriteSnapshot[];
}

interface MockGasHarness {
  operations: string[];
  sheets: Map<string, MockSheetState>;
  setProperty: (key: string, value: string | null) => void;
  seedSheet: (name: string, rows: unknown[][]) => MockSheetState;
  setLockAvailable: (available: boolean) => void;
  setOpenByIdError: (error: Error | null) => void;
  setFlushError: (error: Error | null) => void;
}

function createMockGasHarness(): MockGasHarness {
  const operations: string[] = [];
  const properties = new Map<string, string>();
  const sheets = new Map<string, MockSheetState>();
  let lockAvailable = true;
  let openByIdError: Error | null = null;
  let flushError: Error | null = null;
  let uuidCounter = 0;

  const ensureGridSize = (state: MockSheetState, rows: number, cols: number): void => {
    while (state.values.length < rows) {
      state.values.push([]);
    }
    while (state.formats.length < rows) {
      state.formats.push([]);
    }
    for (let r = 0; r < rows; r += 1) {
      while (state.values[r].length < cols) {
        state.values[r].push('');
      }
      while (state.formats[r].length < cols) {
        state.formats[r].push('General');
      }
    }
  };

  const createSheetApi = (state: MockSheetState) => {
    const getLastRow = () => state.values.length;
    const getLastColumn = () => state.values.reduce((max, row) => Math.max(max, row.length), 0);

    const getRange = (startRow: number, startCol: number, numRows = 1, numCols = 1) => {
      const rangeApi = {
        getValues: () => {
          const result: unknown[][] = [];
          for (let r = 0; r < numRows; r += 1) {
            const rowValues: unknown[] = [];
            const sourceRow = state.values[startRow - 1 + r] ?? [];
            for (let c = 0; c < numCols; c += 1) {
              rowValues.push(sourceRow[startCol - 1 + c] ?? '');
            }
            result.push(rowValues);
          }
          return result;
        },
        setNumberFormat: (format: string) => {
          operations.push(`sheet:${state.name}:setNumberFormat:${format}`);
          ensureGridSize(state, startRow - 1 + numRows, startCol - 1 + numCols);
          for (let r = 0; r < numRows; r += 1) {
            for (let c = 0; c < numCols; c += 1) {
              state.formats[startRow - 1 + r][startCol - 1 + c] = format;
            }
          }
          return rangeApi;
        },
        setValues: (matrix: unknown[][]) => {
          operations.push(`sheet:${state.name}:setValues`);
          ensureGridSize(state, startRow - 1 + numRows, startCol - 1 + numCols);
          const formatsAtWriteTime: string[][] = [];
          for (let r = 0; r < numRows; r += 1) {
            const rowFormats: string[] = [];
            for (let c = 0; c < numCols; c += 1) {
              rowFormats.push(state.formats[startRow - 1 + r][startCol - 1 + c] ?? 'General');
              state.values[startRow - 1 + r][startCol - 1 + c] = matrix[r]?.[c] ?? '';
            }
            formatsAtWriteTime.push(rowFormats);
          }
          state.writes.push({
            row: startRow,
            col: startCol,
            values: matrix.map((r) => [...r]),
            formatsAtWriteTime,
          });
          return rangeApi;
        },
      };
      return rangeApi;
    };

    return {
      getName: () => state.name,
      getLastRow,
      getLastColumn,
      getDataRange: () => getRange(1, 1, Math.max(1, getLastRow()), Math.max(1, getLastColumn())),
      getRange,
    };
  };

  const spreadsheetApi = {
    getSheetByName: (name: string) => {
      const state = sheets.get(name);
      return state ? createSheetApi(state) : null;
    },
    insertSheet: (name: string) => {
      operations.push(`spreadsheet:insertSheet:${name}`);
      const state: MockSheetState = { name, values: [], formats: [], writes: [] };
      sheets.set(name, state);
      return createSheetApi(state);
    },
  };

  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
    }),
  });

  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => {
      operations.push(`spreadsheet:openById:${id}`);
      if (openByIdError) {
        throw openByIdError;
      }
      return spreadsheetApi;
    },
    getActiveSpreadsheet: () => {
      operations.push('spreadsheet:getActiveSpreadsheet');
      throw new Error('getActiveSpreadsheet must never be called');
    },
    flush: () => {
      operations.push('spreadsheet:flush');
      if (flushError) {
        throw flushError;
      }
    },
  });

  vi.stubGlobal('LockService', {
    getScriptLock: () => ({
      tryLock: (timeoutMs: number) => {
        operations.push(`lock:tryLock:${timeoutMs}`);
        return lockAvailable;
      },
      releaseLock: () => {
        operations.push('lock:releaseLock');
      },
    }),
  });

  vi.stubGlobal('ContentService', {
    MimeType: {
      JSON: 'JSON',
    },
    createTextOutput: (content: string) => {
      let mimeType = 'TEXT';
      const output = {
        setMimeType: (nextMime: string) => {
          mimeType = nextMime;
          return output;
        },
        getContent: () => content,
        getMimeType: () => mimeType,
      };
      return output;
    },
  });

  vi.stubGlobal('Utilities', {
    getUuid: () => {
      uuidCounter += 1;
      return `uuid-${uuidCounter}`;
    },
  });

  return {
    operations,
    sheets,
    setProperty: (key, value) => {
      if (value === null) {
        properties.delete(key);
      } else {
        properties.set(key, value);
      }
    },
    seedSheet: (name, rows) => {
      const state: MockSheetState = {
        name,
        values: rows.map((row) => [...row]),
        formats: rows.map((row) => row.map(() => 'General')),
        writes: [],
      };
      sheets.set(name, state);
      return state;
    },
    setLockAvailable: (available) => {
      lockAvailable = available;
    },
    setOpenByIdError: (error) => {
      openByIdError = error;
    },
    setFlushError: (error) => {
      flushError = error;
    },
  };
}

function parseOutput(output: GoogleAppsScript.Content.TextOutput): unknown {
  expect(output.getMimeType()).toBe('JSON');
  return JSON.parse(output.getContent()) as unknown;
}

function makeGetEvent(action?: string): GoogleAppsScript.Events.DoGet {
  return {
    parameter: action === undefined ? {} : { action },
  } as GoogleAppsScript.Events.DoGet;
}

function makePostEvent(contents: string): GoogleAppsScript.Events.DoPost {
  return {
    postData: { contents },
  } as GoogleAppsScript.Events.DoPost;
}

describe('GAS backend entrypoints (doGet & doPost)', () => {
  let harness: MockGasHarness;

  beforeEach(() => {
    harness = createMockGasHarness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('SPREADSHEET_ID configuration (ADR-0002)', () => {
    it('returns CONFIG_MISSING on doGet without calling getActiveSpreadsheet', () => {
      const response = parseOutput(doGet(makeGetEvent('listItems')));

      expect(response).toEqual({
        ok: false,
        error: {
          code: 'CONFIG_MISSING',
          message: 'SPREADSHEET_ID is not configured',
        },
      });
      expect(harness.operations).not.toContain('spreadsheet:getActiveSpreadsheet');
      expect(harness.operations.some((op) => op.startsWith('spreadsheet:openById'))).toBe(false);
    });

    it('returns CONFIG_MISSING on doPost when SPREADSHEET_ID is blank without acquiring lock', () => {
      harness.setProperty('SPREADSHEET_ID', '   ');
      const response = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({ action: 'createItem', payload: { code: '001', name: 'A' } }),
          ),
        ),
      );

      expect(response).toEqual({
        ok: false,
        error: {
          code: 'CONFIG_MISSING',
          message: 'SPREADSHEET_ID is not configured',
        },
      });
      expect(harness.operations).not.toContain('spreadsheet:getActiveSpreadsheet');
      expect(harness.operations.some((op) => op.startsWith('lock:'))).toBe(false);
    });
  });

  describe('doGet read-only behavior and schema validation', () => {
    beforeEach(() => {
      harness.setProperty('SPREADSHEET_ID', 'sheet-test-id');
    });

    it('rejects unsupported GET action with INVALID_ACTION', () => {
      expect(parseOutput(doGet(makeGetEvent('deleteAll')))).toEqual({
        ok: false,
        error: { code: 'INVALID_ACTION', message: 'Unsupported GET action' },
      });
    });

    it('performs zero sheet mutations and returns [] when Items sheet does not exist', () => {
      const response = parseOutput(doGet(makeGetEvent('listItems')));

      expect(response).toEqual({ ok: true, data: [] });
      expect(harness.sheets.has('Items')).toBe(false);
      expect(harness.operations).toEqual(['spreadsheet:openById:sheet-test-id']);
    });

    it('returns [] with zero mutations when Items sheet exists with no rows or headers only', () => {
      harness.seedSheet('Items', []);
      expect(parseOutput(doGet(makeGetEvent('listItems')))).toEqual({ ok: true, data: [] });

      harness.seedSheet('Items', [[...ITEMS_HEADERS]]);
      expect(parseOutput(doGet(makeGetEvent('listItems')))).toEqual({ ok: true, data: [] });
      expect(
        harness.operations.some((op) => op.includes('setValues') || op.includes('insertSheet')),
      ).toBe(false);
    });

    it('returns SCHEMA_ERROR when required headers are missing', () => {
      harness.seedSheet('Items', [['id', 'code']]);

      expect(parseOutput(doGet(makeGetEvent('listItems')))).toEqual({
        ok: false,
        error: {
          code: 'SCHEMA_ERROR',
          message: 'Missing required sheet header: name',
        },
      });
    });

    it('reads Items preserving leading zeros, filtering blank rows, and normalizing Date cells to ISO-8601', () => {
      const date = new Date('2026-11-20T10:20:30.000Z');
      harness.seedSheet('Items', [
        ['code', 'name', 'createdAt', 'id'],
        ['', '', '', ''],
        ['00123', 'Widget One', date, 'id-1'],
        ['   ', null, undefined, ''],
        ['054', 'Widget Two', '2026-11-21T00:00:00.000Z', 'id-2'],
      ]);

      expect(parseOutput(doGet(makeGetEvent('listItems')))).toEqual({
        ok: true,
        data: [
          {
            id: 'id-1',
            code: '00123',
            name: 'Widget One',
            createdAt: '2026-11-20T10:20:30.000Z',
          },
          {
            id: 'id-2',
            code: '054',
            name: 'Widget Two',
            createdAt: '2026-11-21T00:00:00.000Z',
          },
        ],
      });
    });
  });

  describe('doPost concurrency, flush ordering, formatting, and validation', () => {
    beforeEach(() => {
      harness.setProperty('SPREADSHEET_ID', 'sheet-test-id');
    });

    it('initializes missing sheet under lock, formats all text columns as @ before write, flushes before unlock, and persists readable Item', () => {
      const postResponse = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: ' 00123 ', name: 'Widget Alpha' },
            }),
          ),
        ),
      );

      expect(postResponse).toMatchObject({
        ok: true,
        data: {
          id: 'uuid-1',
          code: '00123',
          name: 'Widget Alpha',
        },
      });

      // Verify strict operation order: tryLock -> openById -> insertSheet -> format/write headers -> format/write row -> flush -> releaseLock
      const tryLockIdx = harness.operations.indexOf('lock:tryLock:10000');
      const insertIdx = harness.operations.indexOf('spreadsheet:insertSheet:Items');
      const flushIdx = harness.operations.indexOf('spreadsheet:flush');
      const releaseIdx = harness.operations.indexOf('lock:releaseLock');

      expect(tryLockIdx).toBeGreaterThanOrEqual(0);
      expect(insertIdx).toBeGreaterThan(tryLockIdx);
      expect(flushIdx).toBeGreaterThan(insertIdx);
      expect(releaseIdx).toBeGreaterThan(flushIdx);

      // Verify all 4 text columns received '@' format BEFORE setValues()
      const itemsSheet = harness.sheets.get('Items');
      expect(itemsSheet).toBeDefined();
      expect(itemsSheet?.writes).toHaveLength(2);
      expect(itemsSheet?.writes[0].formatsAtWriteTime).toEqual([['@', '@', '@', '@']]);
      expect(itemsSheet?.writes[1].formatsAtWriteTime).toEqual([['@', '@', '@', '@']]);

      // Verify item is retrievable via doGet with leading zeros intact
      const getResponse = parseOutput(doGet(makeGetEvent('listItems')));
      expect(getResponse).toEqual({
        ok: true,
        data: [(postResponse as { ok: true; data: unknown }).data],
      });
    });

    it('initializes headers on an existing empty Items sheet and respects custom header column order on write', () => {
      harness.seedSheet('Items', []);
      const firstResponse = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: '0007', name: 'First Item' },
            }),
          ),
        ),
      );
      expect(firstResponse).toMatchObject({ ok: true, data: { code: '0007', name: 'First Item' } });

      harness.seedSheet('Items', [['name', 'createdAt', 'code', 'id']]);
      const secondResponse = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: '0042', name: 'Reordered Item' },
            }),
          ),
        ),
      );
      expect(secondResponse).toMatchObject({
        ok: true,
        data: { id: 'uuid-2', code: '0042', name: 'Reordered Item' },
      });

      const itemsSheet = harness.sheets.get('Items');
      expect(itemsSheet?.writes).toHaveLength(1);
      expect(itemsSheet?.writes[0].formatsAtWriteTime).toEqual([['@', '@', '@', '@']]);
      expect(itemsSheet?.values[1][0]).toBe('Reordered Item');
      expect(itemsSheet?.values[1][2]).toBe('0042');
      expect(itemsSheet?.values[1][3]).toBe('uuid-2');
    });

    it('initializes headers when Items sheet has only a single whitespace-only row', () => {
      harness.seedSheet('Items', [['   ', '']]);

      const response = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: '0088', name: 'Clean Init' },
            }),
          ),
        ),
      );

      expect(response).toMatchObject({
        ok: true,
        data: { code: '0088', name: 'Clean Init' },
      });
    });

    it('always releases LockService in finally even when SpreadsheetApp.flush() throws, logging structured JSON without secrets', () => {
      const secretSpreadsheetId = 'secret-sheet-987654';
      harness.setProperty('SPREADSHEET_ID', secretSpreadsheetId);
      harness.setFlushError(
        new Error(`Flush failed for ${secretSpreadsheetId} token=super-secret-token`),
      );

      const response = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: '00999', name: 'Alice Private PII' },
            }),
          ),
        ),
      );

      expect(response).toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal server error occurred',
        },
      });

      const flushIdx = harness.operations.indexOf('spreadsheet:flush');
      const releaseIdx = harness.operations.indexOf('lock:releaseLock');
      expect(flushIdx).toBeGreaterThan(0);
      expect(releaseIdx).toBeGreaterThan(flushIdx);

      const errorSpy = vi.mocked(console.error);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const rawLog = String(errorSpy.mock.calls[0][0]);
      const parsedLog = JSON.parse(rawLog) as Record<string, unknown>;
      expect(parsedLog).toMatchObject({
        severity: 'ERROR',
        handler: 'doPost',
        action: 'createItem',
        phase: 'flush',
        errorCode: 'INTERNAL_ERROR',
        errorName: 'Error',
      });
      expect(typeof parsedLog.timestamp).toBe('string');
      expect(rawLog).not.toContain(secretSpreadsheetId);
      expect(rawLog).not.toContain('super-secret-token');
      expect(rawLog).not.toContain('Alice Private PII');
      expect(rawLog).not.toContain('00999');
    });

    it('returns LOCK_TIMEOUT when ScriptLock cannot be acquired', () => {
      harness.setLockAvailable(false);

      const response = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: '001', name: 'Widget' },
            }),
          ),
        ),
      );

      expect(response).toEqual({
        ok: false,
        error: {
          code: 'LOCK_TIMEOUT',
          message: 'Server is busy, please retry',
        },
      });
      expect(harness.operations).not.toContain('lock:releaseLock');
      expect(harness.operations).not.toContain('spreadsheet:flush');
    });

    it('returns SCHEMA_ERROR and releases lock when existing Items sheet has invalid headers', () => {
      harness.seedSheet('Items', [['id', 'code']]);

      const response = parseOutput(
        doPost(
          makePostEvent(
            JSON.stringify({
              action: 'createItem',
              payload: { code: '001', name: 'Widget' },
            }),
          ),
        ),
      );

      expect(response).toEqual({
        ok: false,
        error: {
          code: 'SCHEMA_ERROR',
          message: 'Missing required sheet header: name',
        },
      });
      expect(harness.operations).toContain('lock:releaseLock');
      expect(harness.operations).not.toContain('spreadsheet:flush');
    });

    it('rejects malformed JSON, unsupported action, non-string, empty, and over-length payloads with canonical errors', () => {
      expect(parseOutput(doPost(makePostEvent('{bad json')))).toEqual({
        ok: false,
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      });

      expect(parseOutput(doPost(makePostEvent(JSON.stringify({ action: 'unknown' }))))).toEqual({
        ok: false,
        error: { code: 'INVALID_ACTION', message: 'Unsupported POST action' },
      });

      expect(
        parseOutput(
          doPost(
            makePostEvent(
              JSON.stringify({ action: 'createItem', payload: { code: 123, name: 'Test' } }),
            ),
          ),
        ),
      ).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Both code and name must be strings' },
      });

      expect(
        parseOutput(
          doPost(
            makePostEvent(
              JSON.stringify({
                action: 'createItem',
                payload: { code: '0'.repeat(MAX_ITEM_CODE_LENGTH + 1), name: 'Test' },
              }),
            ),
          ),
        ),
      ).toEqual({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `code must not exceed ${MAX_ITEM_CODE_LENGTH} characters`,
        },
      });

      expect(
        parseOutput(
          doPost(
            makePostEvent(
              JSON.stringify({
                action: 'createItem',
                payload: { code: '001', name: 'A'.repeat(MAX_ITEM_NAME_LENGTH + 1) },
              }),
            ),
          ),
        ),
      ).toEqual({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `name must not exceed ${MAX_ITEM_NAME_LENGTH} characters`,
        },
      });

      expect(parseOutput(doPost(makePostEvent('a'.repeat(MAX_REQUEST_BODY_LENGTH + 1))))).toEqual({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Request payload must not exceed ${MAX_REQUEST_BODY_LENGTH} characters`,
        },
      });

      expect(harness.operations).toEqual([]);
    });

    it('neutralizes formula injection prefixes (=, +, -, @, tab, CR) on write', () => {
      const formulas = ['=SUM(A1:A2)', '+123', '-123', '@cmd', '\t=1+1', '\r+1'];
      for (const formula of formulas) {
        const res = parseOutput(
          doPost(
            makePostEvent(
              JSON.stringify({
                action: 'createItem',
                payload: { code: formula, name: formula },
              }),
            ),
          ),
        ) as { ok: true; data: { code: string; name: string } };

        expect(res.ok).toBe(true);
        expect(res.data.code).toBe(`'${formula}`);
        expect(res.data.name).toBe(`'${formula}`);
      }
    });
  });

  describe('structured JSON error logging on doGet unexpected failure', () => {
    it('logs structured JSON without Spreadsheet ID or secrets and returns generic INTERNAL_ERROR', () => {
      const secretId = 'sheet-prod-secret-42';
      harness.setProperty('SPREADSHEET_ID', secretId);
      harness.setOpenByIdError(new Error(`Cannot open ${secretId} with Bearer secret-abc`));

      const response = parseOutput(doGet(makeGetEvent('listItems')));

      expect(response).toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal server error occurred',
        },
      });

      const errorSpy = vi.mocked(console.error);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const rawLog = String(errorSpy.mock.calls[0][0]);
      const parsedLog = JSON.parse(rawLog) as Record<string, unknown>;
      expect(parsedLog).toMatchObject({
        severity: 'ERROR',
        handler: 'doGet',
        action: 'listItems',
        errorCode: 'INTERNAL_ERROR',
        errorName: 'Error',
      });
      expect(rawLog).not.toContain(secretId);
      expect(rawLog).not.toContain('secret-abc');
      expect(rawLog).not.toContain('Cannot open');
    });
  });
});
