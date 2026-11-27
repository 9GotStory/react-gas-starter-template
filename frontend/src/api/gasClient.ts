/**
 * Default timeout (20 seconds) tuned for Google Apps Script Web App cold starts
 * while preventing stalled requests from hanging indefinitely.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Canonical error codes returned by the GAS backend `{ ok: false, error }` envelope.
 */
export const SERVER_ERROR_CODES = [
  'CONFIG_MISSING',
  'SCHEMA_ERROR',
  'INVALID_JSON',
  'INVALID_ACTION',
  'VALIDATION_ERROR',
  'LOCK_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

/**
 * Canonical client-side error codes produced by `gasClient` at the HTTP/boundary seam.
 */
export const CLIENT_ERROR_CODES = [
  'TIMEOUT',
  'ABORTED',
  'NETWORK_ERROR',
  'HTTP_ERROR',
  'NON_JSON_RESPONSE',
  'INVALID_ENVELOPE',
  'INVALID_DATA',
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type GasErrorCode = ServerErrorCode | ClientErrorCode | (string & {});

export interface ItemDto {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface CreateItemInput {
  code: string;
  name: string;
}

export interface GasErrorPayload {
  code: GasErrorCode;
  message: string;
}

export type GasEnvelope<T> = { ok: true; data: T } | { ok: false; error: GasErrorPayload };

export interface GasRequestOptions {
  apiUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GasApiErrorOptions {
  status?: number;
  cause?: unknown;
}

export class GasApiError extends Error {
  readonly code: GasErrorCode;
  readonly status?: number;

  constructor(code: GasErrorCode, message: string, options?: GasApiErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'GasApiError';
    this.code = code;
    this.status = options?.status;
  }
}

const HTML_CONTENT_TYPE_REGEX = /\b(?:text\/html|application\/xhtml\+xml)\b/i;
const ABSOLUTE_URL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function resolveApiUrl(explicitUrl?: string): string {
  if (explicitUrl !== undefined) {
    const trimmed = explicitUrl.trim();
    if (!trimmed) {
      throw new GasApiError('CONFIG_MISSING', 'GAS API URL must be a non-empty string');
    }
    return trimmed;
  }

  const envUrl = import.meta.env.VITE_GAS_API_URL;
  if (typeof envUrl !== 'string' || !envUrl.trim()) {
    throw new GasApiError('CONFIG_MISSING', 'VITE_GAS_API_URL is not configured');
  }
  return envUrl.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(value: unknown): boolean {
  return (
    (value instanceof DOMException && value.name === 'AbortError') ||
    (value instanceof Error && value.name === 'AbortError')
  );
}

/**
 * Resolves both absolute GAS Web App URLs (`https://script.google.com/...`) and
 * relative paths (`/api/gas`, `./api/gas`) for local mock/proxy setups.
 */
function buildRequestUrl(baseUrl: string, searchParams?: Record<string, string>): string {
  if (!searchParams) {
    return baseUrl;
  }

  if (ABSOLUTE_URL_SCHEME_REGEX.test(baseUrl)) {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  const hashIndex = baseUrl.indexOf('#');
  const hash = hashIndex >= 0 ? baseUrl.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? baseUrl.slice(0, hashIndex) : baseUrl;

  const queryIndex = withoutHash.indexOf('?');
  const pathPart = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const queryPart = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const params = new URLSearchParams(queryPart);
  for (const [key, value] of Object.entries(searchParams)) {
    params.set(key, value);
  }

  const serialized = params.toString();
  return `${pathPart}${serialized ? `?${serialized}` : ''}${hash}`;
}

/**
 * Validates raw JSON parsed as `unknown` against the GAS envelope contract.
 */
export function parseGasEnvelope<T>(raw: unknown, validateData: (data: unknown) => data is T): T {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    throw new GasApiError('INVALID_ENVELOPE', 'Malformed response envelope from GAS API');
  }

  if (raw.ok === false) {
    const err = isRecord(raw.error) ? raw.error : {};
    const code = typeof err.code === 'string' ? err.code : 'GAS_ERROR';
    const message = typeof err.message === 'string' ? err.message : 'Unknown GAS API error';
    throw new GasApiError(code, message);
  }

  if (!validateData(raw.data)) {
    throw new GasApiError('INVALID_DATA', 'Response data failed boundary validation');
  }

  return raw.data;
}

function isItemDto(value: unknown): value is ItemDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function isItemList(value: unknown): value is ItemDto[] {
  return Array.isArray(value) && value.every(isItemDto);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers?.get('content-type') ?? '';
  if (HTML_CONTENT_TYPE_REGEX.test(contentType)) {
    throw new GasApiError(
      'NON_JSON_RESPONSE',
      'GAS API returned an HTML response instead of JSON (check Web App access or deployment settings)',
      { status: response.status },
    );
  }

  const bodyText = await response.text();
  try {
    return JSON.parse(bodyText) as unknown;
  } catch (err) {
    throw new GasApiError(
      'NON_JSON_RESPONSE',
      'GAS API returned a non-JSON response (check Web App access or deployment settings)',
      { status: response.status, cause: err },
    );
  }
}

interface ExecuteGasRequestConfig<T> {
  method: 'GET' | 'POST';
  searchParams?: Record<string, string>;
  headers?: HeadersInit;
  body?: string;
  options: GasRequestOptions;
  validateData: (data: unknown) => data is T;
}

async function executeGasRequest<T>({
  method,
  searchParams,
  headers,
  body,
  options,
  validateData,
}: ExecuteGasRequestConfig<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }

  const requestUrl = buildRequestUrl(resolveApiUrl(options.apiUrl), searchParams);

  const callerSignal = options.signal;
  if (callerSignal?.aborted) {
    throw new GasApiError('ABORTED', 'Request was aborted');
  }

  const controller = new AbortController();
  let abortCause: 'timeout' | 'caller' | null = null;

  const handleCallerAbort = () => {
    if (abortCause === null) {
      abortCause = 'caller';
    }
    controller.abort(callerSignal?.reason);
  };

  callerSignal?.addEventListener('abort', handleCallerAbort, { once: true });

  const timeoutId = setTimeout(() => {
    if (abortCause === null) {
      abortCause = 'timeout';
    }
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(requestUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GasApiError('HTTP_ERROR', `GAS ${method} failed with status ${response.status}`, {
        status: response.status,
      });
    }

    const raw = await parseJsonResponse(response);
    return parseGasEnvelope(raw, validateData);
  } catch (err) {
    if (abortCause === 'caller') {
      throw new GasApiError('ABORTED', 'Request was aborted', { cause: err });
    }
    if (abortCause === 'timeout') {
      throw new GasApiError('TIMEOUT', `GAS ${method} request timed out after ${timeoutMs}ms`, {
        cause: err,
      });
    }
    if (err instanceof GasApiError) {
      throw err;
    }
    if (isAbortError(err)) {
      throw new GasApiError('ABORTED', 'Request was aborted', { cause: err });
    }
    throw new GasApiError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
      { cause: err },
    );
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', handleCallerAbort);
  }
}

/**
 * Fetches items from GAS Web App `doGet`.
 * Supports both absolute URLs and relative paths, enforces a configurable timeout
 * (default 20,000 ms), and forwards caller/TanStack Query `AbortSignal`.
 */
export async function fetchItems(options: GasRequestOptions = {}): Promise<ItemDto[]> {
  return executeGasRequest({
    method: 'GET',
    searchParams: { action: 'listItems' },
    options,
    validateData: isItemList,
  });
}

/**
 * Sends a mutation to GAS Web App `doPost` using `text/plain;charset=utf-8`
 * to avoid CORS preflight (`OPTIONS`) requests (see EXC-1).
 */
export async function createItem(
  input: CreateItemInput,
  options: GasRequestOptions = {},
): Promise<ItemDto> {
  return executeGasRequest({
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action: 'createItem',
      payload: input,
    }),
    options,
    validateData: isItemDto,
  });
}
