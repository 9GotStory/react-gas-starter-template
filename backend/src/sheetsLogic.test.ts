import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_WRITE_ROWS,
  MAX_ITEM_CODE_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_REQUEST_BODY_LENGTH,
  SchemaError,
  buildColumnMap,
  errorEnvelope,
  mapRowsToItems,
  okEnvelope,
  sanitizeSheetCell,
  validateBatchWriteRows,
  validateCreateItemPayload,
  validateRequestBodySize,
} from './sheetsLogic';

describe('sanitizeSheetCell', () => {
  it('neutralizes formula injection prefixes including tab and carriage return', () => {
    expect(sanitizeSheetCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeSheetCell('+123')).toBe("'+123");
    expect(sanitizeSheetCell('-123')).toBe("'-123");
    expect(sanitizeSheetCell('@cmd')).toBe("'@cmd");
    expect(sanitizeSheetCell('\t=SUM(A1:A2)')).toBe("'\t=SUM(A1:A2)");
    expect(sanitizeSheetCell('\t123')).toBe("'\t123");
    expect(sanitizeSheetCell('\r+123')).toBe("'\r+123");
    expect(sanitizeSheetCell('\r123')).toBe("'\r123");
    expect(sanitizeSheetCell('  =SUM(A1:A2)  ')).toBe("'=SUM(A1:A2)");
  });

  it('preserves leading zeros and normal strings', () => {
    expect(sanitizeSheetCell(' 00123 ')).toBe('00123');
    expect(sanitizeSheetCell('Widget A')).toBe('Widget A');
  });
});

describe('buildColumnMap and mapRowsToItems', () => {
  it('maps columns regardless of header order', () => {
    const rows = [
      ['name', 'createdAt', 'code', 'id'],
      ['Widget', '2026-11-20T00:00:00.000Z', '0042', 'abc-1'],
    ];

    expect(mapRowsToItems(rows)).toEqual([
      {
        id: 'abc-1',
        code: '0042',
        name: 'Widget',
        createdAt: '2026-11-20T00:00:00.000Z',
      },
    ]);
  });

  it('throws SchemaError when a required header is missing', () => {
    expect(() => buildColumnMap(['id', 'code'])).toThrow(SchemaError);
    expect(() => buildColumnMap(['id', 'code'])).toThrow('Missing required sheet header: name');
    expect(() => mapRowsToItems([['id', 'code']])).toThrow(SchemaError);
  });

  it('returns an empty list for empty sheets or header-only valid sheets', () => {
    expect(mapRowsToItems([])).toEqual([]);
    expect(mapRowsToItems([['']])).toEqual([]);
    expect(mapRowsToItems([['id', 'code', 'name', 'createdAt']])).toEqual([]);
  });

  it('filters blank rows and serializes Date cells to ISO-8601 strings', () => {
    const createdAt = new Date('2026-11-20T08:15:30.000Z');
    const rows = [
      ['id', 'code', 'name', 'createdAt'],
      ['', '', '', ''],
      ['   ', null, undefined, ''],
      ['id-1', '00123', 'Widget A', createdAt],
      ['id-2', '054', 'Widget B', new Date('invalid')],
    ];

    expect(mapRowsToItems(rows)).toEqual([
      {
        id: 'id-1',
        code: '00123',
        name: 'Widget A',
        createdAt: '2026-11-20T08:15:30.000Z',
      },
      {
        id: 'id-2',
        code: '054',
        name: 'Widget B',
        createdAt: '',
      },
    ]);
  });
});

describe('validateCreateItemPayload & bounded limits', () => {
  it('validates, trims, and sanitizes valid payloads', () => {
    const res = validateCreateItemPayload({ code: ' 0099 ', name: '=HYPERLINK()' });
    expect(res).toEqual({
      ok: true,
      value: { code: '0099', name: "'=HYPERLINK()" },
    });

    const tabRes = validateCreateItemPayload({ code: '00123', name: '\t=1+1' });
    expect(tabRes).toEqual({
      ok: true,
      value: { code: '00123', name: "'\t=1+1" },
    });
  });

  it('rejects non-object, array, and non-string field payloads', () => {
    expect(validateCreateItemPayload(null)).toEqual({
      ok: false,
      error: 'Payload must be an object',
    });
    expect(validateCreateItemPayload([])).toEqual({
      ok: false,
      error: 'Payload must be an object',
    });
    expect(validateCreateItemPayload({ code: 123, name: 'Test' })).toEqual({
      ok: false,
      error: 'Both code and name must be strings',
    });
    expect(validateCreateItemPayload({ code: '001', name: true })).toEqual({
      ok: false,
      error: 'Both code and name must be strings',
    });
  });

  it('rejects empty or whitespace-only fields including tabs and carriage returns', () => {
    expect(validateCreateItemPayload({ code: '  ', name: 'Test' })).toEqual({
      ok: false,
      error: 'Both code and name are required',
    });
    expect(validateCreateItemPayload({ code: '001', name: '\t\r  ' })).toEqual({
      ok: false,
      error: 'Both code and name are required',
    });
  });

  it('rejects code and name values exceeding bounded max lengths', () => {
    expect(
      validateCreateItemPayload({
        code: '0'.repeat(MAX_ITEM_CODE_LENGTH + 1),
        name: 'Valid',
      }),
    ).toEqual({
      ok: false,
      error: `code must not exceed ${MAX_ITEM_CODE_LENGTH} characters`,
    });

    expect(
      validateCreateItemPayload({
        code: '00123',
        name: 'A'.repeat(MAX_ITEM_NAME_LENGTH + 1),
      }),
    ).toEqual({
      ok: false,
      error: `name must not exceed ${MAX_ITEM_NAME_LENGTH} characters`,
    });

    expect(
      validateCreateItemPayload({
        code: '0'.repeat(MAX_ITEM_CODE_LENGTH),
        name: 'A'.repeat(MAX_ITEM_NAME_LENGTH),
      }).ok,
    ).toBe(true);
  });

  it('enforces bounded request body and batch write limits', () => {
    expect(validateRequestBodySize('{"action":"createItem"}')).toEqual({
      ok: true,
      value: '{"action":"createItem"}',
    });
    expect(validateRequestBodySize('x'.repeat(MAX_REQUEST_BODY_LENGTH + 1))).toEqual({
      ok: false,
      error: `Request payload must not exceed ${MAX_REQUEST_BODY_LENGTH} characters`,
    });

    expect(validateBatchWriteRows([['id-1', '001', 'A', '2026-11-20T00:00:00.000Z']])).toEqual({
      ok: true,
    });
    expect(validateBatchWriteRows([])).toEqual({
      ok: false,
      error: 'Batch write must contain at least one row',
    });
    expect(validateBatchWriteRows(new Array(MAX_BATCH_WRITE_ROWS + 1).fill([]))).toEqual({
      ok: false,
      error: `Batch write must not exceed ${MAX_BATCH_WRITE_ROWS} rows`,
    });
  });

  it('builds standard JSON envelopes with canonical error codes', () => {
    expect(okEnvelope({ count: 1 })).toEqual({ ok: true, data: { count: 1 } });
    expect(errorEnvelope('VALIDATION_ERROR', 'Nope')).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Nope' },
    });
  });
});
