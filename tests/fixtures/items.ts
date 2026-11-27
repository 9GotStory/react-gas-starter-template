export const MOCK_GAS_API_PATH = '/api/gas';

export interface MockItemFixture {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export const INITIAL_MOCK_ITEMS: readonly MockItemFixture[] = [
  {
    id: 'mock-item-001',
    code: '00042',
    name: 'Starter Thermal Label',
    createdAt: '2026-11-20T08:00:00.000Z',
  },
  {
    id: 'mock-item-002',
    code: '05400',
    name: 'Warehouse Scanner Dock',
    createdAt: '2026-11-21T09:30:00.000Z',
  },
];

export const LEADING_ZERO_CREATE_FIXTURE = {
  code: '00123',
  name: 'Leading Zero Archive Box',
} as const;

export const MOCK_HTML_ERROR_BODY =
  '<!doctype html><html lang="en"><body><h1>Google Sign-In</h1><p>Sign in to access Apps Script Web App</p></body></html>';

const MAX_ITEM_CODE_LENGTH = 64;
const MAX_ITEM_NAME_LENGTH = 200;
const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

function validateAndSanitizeField(
  fieldName: 'code' | 'name',
  rawValue: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  const hasLeadingFormulaChar = FORMULA_PREFIX_REGEX.test(rawValue);
  const normalized = hasLeadingFormulaChar ? rawValue.trimEnd() : rawValue.trim();

  if (normalized.length > maxLength) {
    return {
      ok: false,
      message: `${fieldName} must not exceed ${maxLength} characters`,
    };
  }

  const sanitized =
    hasLeadingFormulaChar || FORMULA_PREFIX_REGEX.test(normalized) ? `'${normalized}` : normalized;
  return { ok: true, value: sanitized };
}

export interface MockGasResponse {
  status: number;
  contentType: string;
  body: string;
}

export interface MockGasController {
  handleGet: (searchParams: URLSearchParams) => MockGasResponse;
  handlePost: (rawBody: string) => MockGasResponse;
}

function jsonResponse(payload: unknown, status = 200): MockGasResponse {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  };
}

/**
 * Framework-free in-memory mock GAS controller shared between the dev-only Vite
 * middleware and Playwright E2E `page.route()` handlers (ADR-0004).
 */
export function createMockGasController(
  initialItems: readonly MockItemFixture[] = INITIAL_MOCK_ITEMS,
): MockGasController {
  const items: MockItemFixture[] = initialItems.map((item) => ({ ...item }));
  let sequence = items.length;

  return {
    handleGet(searchParams) {
      const action = searchParams.get('action') ?? '';
      if (action !== 'listItems') {
        return jsonResponse({
          ok: false,
          error: { code: 'INVALID_ACTION', message: 'Unsupported GET action' },
        });
      }
      return jsonResponse({
        ok: true,
        data: items.map((item) => ({ ...item })),
      });
    },

    handlePost(rawBody) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return jsonResponse({
          ok: false,
          error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        });
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as Record<string, unknown>).action !== 'createItem'
      ) {
        return jsonResponse({
          ok: false,
          error: { code: 'INVALID_ACTION', message: 'Unsupported POST action' },
        });
      }

      const payload = (parsed as Record<string, unknown>).payload;
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return jsonResponse({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Payload must be an object' },
        });
      }

      const record = payload as Record<string, unknown>;
      if (typeof record.code !== 'string' || typeof record.name !== 'string') {
        return jsonResponse({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Both code and name must be strings' },
        });
      }

      if (!record.code.trim() || !record.name.trim()) {
        return jsonResponse({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Both code and name are required' },
        });
      }

      const codeCheck = validateAndSanitizeField('code', record.code, MAX_ITEM_CODE_LENGTH);
      if (!codeCheck.ok) {
        return jsonResponse({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: codeCheck.message },
        });
      }

      const nameCheck = validateAndSanitizeField('name', record.name, MAX_ITEM_NAME_LENGTH);
      if (!nameCheck.ok) {
        return jsonResponse({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: nameCheck.message },
        });
      }

      sequence += 1;
      const created: MockItemFixture = {
        id: `mock-item-${String(sequence).padStart(3, '0')}`,
        code: codeCheck.value,
        name: nameCheck.value,
        createdAt: new Date(Date.UTC(2026, 10, 27, 0, sequence, 0)).toISOString(),
      };
      items.push(created);

      return jsonResponse({ ok: true, data: { ...created } });
    },
  };
}
