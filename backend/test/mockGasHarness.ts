import { vi } from 'vitest';

export interface RangeWriteSnapshot {
  row: number;
  col: number;
  values: unknown[][];
  formatsAtWriteTime: string[][];
}

export interface MockSheetState {
  name: string;
  values: unknown[][];
  formats: string[][];
  writes: RangeWriteSnapshot[];
}

export interface MockGasHarness {
  operations: string[];
  sheets: Map<string, MockSheetState>;
  setProperty: (key: string, value: string | null) => void;
  seedSheet: (name: string, rows: unknown[][]) => MockSheetState;
  setLockAvailable: (available: boolean) => void;
  setOpenByIdError: (error: Error | null) => void;
  setFlushError: (error: Error | null) => void;
}

/**
 * Installs minimal in-memory Google Apps Script service doubles
 * (`PropertiesService`, `SpreadsheetApp`, `LockService`, `ContentService`, `Utilities`)
 * for offline Vitest backend integration and cross-workspace API contract tests.
 */
export function createMockGasHarness(): MockGasHarness {
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
