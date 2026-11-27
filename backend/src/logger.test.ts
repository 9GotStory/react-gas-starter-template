import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getErrorName, logError, logInfo, logWarn } from './logger';

describe('structured GAS logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits structured JSON entries routed by severity', () => {
    logInfo('gas.info', { handler: 'doGet', count: 2 });
    logWarn('gas.warn', { handler: 'doPost', errorCode: 'LOCK_TIMEOUT' });
    logError('gas.error', { handler: 'doPost', errorCode: 'INTERNAL_ERROR' });

    const info = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])) as Record<
      string,
      unknown
    >;
    const warn = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0])) as Record<
      string,
      unknown
    >;
    const error = JSON.parse(String(vi.mocked(console.error).mock.calls[0][0])) as Record<
      string,
      unknown
    >;

    expect(info).toMatchObject({ severity: 'INFO', event: 'gas.info', handler: 'doGet', count: 2 });
    expect(warn).toMatchObject({
      severity: 'WARN',
      event: 'gas.warn',
      handler: 'doPost',
      errorCode: 'LOCK_TIMEOUT',
    });
    expect(error).toMatchObject({
      severity: 'ERROR',
      event: 'gas.error',
      handler: 'doPost',
      errorCode: 'INTERNAL_ERROR',
    });
    expect(typeof info.timestamp).toBe('string');
  });

  it('strips sensitive keys (secrets, tokens, PII, Spreadsheet IDs) from log output', () => {
    logError('gas.request.error', {
      handler: 'doPost',
      errorCode: 'INTERNAL_ERROR',
      spreadsheetId: 'sheet-secret-1',
      spreadsheet_id: 'sheet-secret-2',
      token: 'bearer-xyz',
      apiSecret: 's3cr3t',
      api_key: 'key-123',
      email: 'alice@example.com',
      payload: 'private',
    });

    const raw = String(vi.mocked(console.error).mock.calls[0][0]);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      severity: 'ERROR',
      event: 'gas.request.error',
      handler: 'doPost',
      errorCode: 'INTERNAL_ERROR',
    });
    expect(raw).not.toContain('sheet-secret-1');
    expect(raw).not.toContain('sheet-secret-2');
    expect(raw).not.toContain('bearer-xyz');
    expect(raw).not.toContain('s3cr3t');
    expect(raw).not.toContain('key-123');
    expect(raw).not.toContain('alice@example.com');
    expect(raw).not.toContain('private');
  });

  it('extracts safe error names without reading exception messages', () => {
    expect(getErrorName(new TypeError('sensitive detail'))).toBe('TypeError');
    expect(getErrorName('raw string error')).toBe('string');
  });
});
