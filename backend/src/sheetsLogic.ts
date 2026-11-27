export const ITEMS_HEADERS = ['id', 'code', 'name', 'createdAt'] as const;

export type ItemHeader = (typeof ITEMS_HEADERS)[number];

export const BACKEND_ERROR_CODES = [
  'CONFIG_MISSING',
  'SCHEMA_ERROR',
  'INVALID_JSON',
  'INVALID_ACTION',
  'VALIDATION_ERROR',
  'LOCK_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

export const MAX_ITEM_CODE_LENGTH = 64;
export const MAX_ITEM_NAME_LENGTH = 200;
export const MAX_REQUEST_BODY_LENGTH = 16_384;
export const MAX_BATCH_WRITE_ROWS = 500;

const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

export interface ItemRecord {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export type ColumnMap = Record<ItemHeader, number>;

export type ApiEnvelope<T> =
  { ok: true; data: T } | { ok: false; error: { code: BackendErrorCode; message: string } };

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

export function okEnvelope<T>(data: T): ApiEnvelope<T> {
  return { ok: true, data };
}

export function errorEnvelope(code: BackendErrorCode, message: string): ApiEnvelope<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Prevents Google Sheets formula injection by prefixing cells starting with
 * `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`).
 */
export function sanitizeSheetCell(value: unknown): string {
  const raw = String(value ?? '');
  if (FORMULA_PREFIX_REGEX.test(raw)) {
    return `'${raw}`;
  }

  const trimmed = raw.trim();
  if (FORMULA_PREFIX_REGEX.test(trimmed)) {
    return `'${trimmed}`;
  }

  return trimmed;
}

export function isBlankCell(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime());
  }
  return false;
}

function normalizeCellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

/**
 * Builds a column-index map from the central header row so handlers
 * never rely on hardcoded column positions.
 */
export function buildColumnMap(headerRow: readonly unknown[]): ColumnMap {
  const indexByName = new Map<string, number>();
  headerRow.forEach((cell, idx) => {
    indexByName.set(String(cell ?? '').trim(), idx);
  });

  const map = {} as ColumnMap;
  for (const header of ITEMS_HEADERS) {
    const idx = indexByName.get(header);
    if (idx === undefined) {
      throw new SchemaError(`Missing required sheet header: ${header}`);
    }
    map[header] = idx;
  }
  return map;
}

/**
 * Maps a 2D batch range from `getValues()` into typed `ItemRecord[]`.
 * Filters blank rows and normalizes `Date` cells to ISO-8601 strings.
 */
export function mapRowsToItems(values: readonly (readonly unknown[])[]): ItemRecord[] {
  if (values.length === 0) {
    return [];
  }

  if (values.length === 1 && values[0].every(isBlankCell)) {
    return [];
  }

  const col = buildColumnMap(values[0]);
  if (values.length === 1) {
    return [];
  }

  const items: ItemRecord[] = [];
  for (const row of values.slice(1)) {
    const isBlankItemRow = ITEMS_HEADERS.every((header) => isBlankCell(row[col[header]]));
    if (isBlankItemRow) {
      continue;
    }

    items.push({
      id: normalizeCellToString(row[col.id]),
      code: normalizeCellToString(row[col.code]),
      name: normalizeCellToString(row[col.name]),
      createdAt: normalizeCellToString(row[col.createdAt]),
    });
  }

  return items;
}

/**
 * Validates raw POST request body size before JSON parsing.
 */
export function validateRequestBodySize(
  rawBody: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof rawBody !== 'string') {
    return { ok: false, error: 'Request payload must be a string' };
  }
  if (rawBody.length > MAX_REQUEST_BODY_LENGTH) {
    return {
      ok: false,
      error: `Request payload must not exceed ${MAX_REQUEST_BODY_LENGTH} characters`,
    };
  }
  return { ok: true, value: rawBody };
}

/**
 * Enforces bounded batch write row counts before touching any Sheet range.
 */
export function validateBatchWriteRows(
  rows: readonly unknown[],
): { ok: true } | { ok: false; error: string } {
  if (rows.length === 0) {
    return { ok: false, error: 'Batch write must contain at least one row' };
  }
  if (rows.length > MAX_BATCH_WRITE_ROWS) {
    return {
      ok: false,
      error: `Batch write must not exceed ${MAX_BATCH_WRITE_ROWS} rows`,
    };
  }
  return { ok: true };
}

function validateBoundedTextField(
  fieldName: 'code' | 'name',
  rawValue: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = FORMULA_PREFIX_REGEX.test(rawValue) ? rawValue.trimEnd() : rawValue.trim();

  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `${fieldName} must not exceed ${maxLength} characters`,
    };
  }

  return { ok: true, value: sanitizeSheetCell(normalized) };
}

/**
 * Validates raw `createItem` POST payload parsed as `unknown`.
 */
export function validateCreateItemPayload(
  raw: unknown,
): { ok: true; value: { code: string; name: string } } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Payload must be an object' };
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.code !== 'string' || typeof record.name !== 'string') {
    return { ok: false, error: 'Both code and name must be strings' };
  }

  if (!record.code.trim() || !record.name.trim()) {
    return { ok: false, error: 'Both code and name are required' };
  }

  const codeCheck = validateBoundedTextField('code', record.code, MAX_ITEM_CODE_LENGTH);
  if (!codeCheck.ok) {
    return codeCheck;
  }

  const nameCheck = validateBoundedTextField('name', record.name, MAX_ITEM_NAME_LENGTH);
  if (!nameCheck.ok) {
    return nameCheck;
  }

  return {
    ok: true,
    value: {
      code: codeCheck.value,
      name: nameCheck.value,
    },
  };
}

/**
 * Maps an `ItemRecord` into a single sheet row aligned with the resolved column schema.
 */
export function buildItemRow(item: ItemRecord, col: ColumnMap, columnCount: number): string[] {
  const row = new Array<string>(columnCount).fill('');
  row[col.id] = item.id;
  row[col.code] = item.code;
  row[col.name] = item.name;
  row[col.createdAt] = item.createdAt;
  return row;
}
