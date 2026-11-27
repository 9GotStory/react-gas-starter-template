import { getErrorName, logError, logInfo, logWarn } from './logger';
import {
  ITEMS_HEADERS,
  SchemaError,
  buildColumnMap,
  buildItemRow,
  errorEnvelope,
  isBlankCell,
  mapRowsToItems,
  okEnvelope,
  validateBatchWriteRows,
  validateCreateItemPayload,
  validateRequestBodySize,
  type ApiEnvelope,
  type ItemRecord,
} from './sheetsLogic';

const SHEET_NAME = 'Items';
const LOCK_TIMEOUT_MS = 10_000;
const INTERNAL_ERROR_MESSAGE = 'An internal server error occurred';

type HandlerName = 'doGet' | 'doPost';

/**
 * Resolves `SPREADSHEET_ID` strictly from Script Properties (ADR-0002).
 * Returns `null` when unset so callers fail closed with `CONFIG_MISSING`
 * without falling back to `SpreadsheetApp.getActiveSpreadsheet()`.
 */
function getRequiredSpreadsheetId(): string | null {
  const raw = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function isSheetEffectivelyEmpty(sheet: GoogleAppsScript.Spreadsheet.Sheet): boolean {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) {
    return true;
  }
  if (lastRow === 1) {
    const firstRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0] ?? [];
    return firstRow.every(isBlankCell);
  }
  return false;
}

/**
 * Ensures the `Items` sheet and its header row exist.
 * Must only be invoked from write paths inside `LockService.getScriptLock()`.
 */
function getOrCreateItemsSheet(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
): GoogleAppsScript.Spreadsheet.Sheet {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (isSheetEffectivelyEmpty(sheet)) {
    const headerRange = sheet.getRange(1, 1, 1, ITEMS_HEADERS.length);
    headerRange.setNumberFormat('@');
    headerRange.setValues([[...ITEMS_HEADERS]]);
  }

  return sheet;
}

function jsonResponse<T>(payload: ApiEnvelope<T>): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function missingConfigResponse(
  handler: HandlerName,
  action: string,
): GoogleAppsScript.Content.TextOutput {
  logWarn('gas.config.missing', {
    handler,
    action,
    errorCode: 'CONFIG_MISSING',
  });
  return jsonResponse(errorEnvelope('CONFIG_MISSING', 'SPREADSHEET_ID is not configured'));
}

function handleUnexpectedError(
  handler: HandlerName,
  action: string,
  phase: string,
  err: unknown,
): GoogleAppsScript.Content.TextOutput {
  if (err instanceof SchemaError) {
    logWarn('gas.schema.error', {
      handler,
      action,
      phase,
      errorCode: 'SCHEMA_ERROR',
    });
    return jsonResponse(errorEnvelope('SCHEMA_ERROR', err.message));
  }

  logError('gas.request.error', {
    handler,
    action,
    phase,
    errorCode: 'INTERNAL_ERROR',
    errorName: getErrorName(err),
  });
  return jsonResponse(errorEnvelope('INTERNAL_ERROR', INTERNAL_ERROR_MESSAGE));
}

/**
 * GAS Web App GET entrypoint (GAS-1 .. GAS-5, SEC-1 .. SEC-3, EXC-2, ADR-0002).
 * Strictly read-only: performs zero sheet mutations.
 * Exposed globally via `backend/build.mjs` footer when bundled to `dist/Code.js`.
 */
export function doGet(e?: GoogleAppsScript.Events.DoGet): GoogleAppsScript.Content.TextOutput {
  let phase = 'validateAction';
  const rawAction = e?.parameter?.action ?? '';
  const safeAction = rawAction === 'listItems' ? rawAction : 'unknown';

  try {
    if (rawAction !== 'listItems') {
      return jsonResponse(errorEnvelope('INVALID_ACTION', 'Unsupported GET action'));
    }

    phase = 'loadConfig';
    const spreadsheetId = getRequiredSpreadsheetId();
    if (!spreadsheetId) {
      return missingConfigResponse('doGet', safeAction);
    }

    phase = 'openSpreadsheet';
    const ss = SpreadsheetApp.openById(spreadsheetId);

    phase = 'readItems';
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      return jsonResponse(okEnvelope([]));
    }

    const values = sheet.getDataRange().getValues();
    const items = mapRowsToItems(values);

    return jsonResponse(okEnvelope(items));
  } catch (err) {
    return handleUnexpectedError('doGet', safeAction, phase, err);
  }
}

/**
 * GAS Web App POST entrypoint (GAS-1 .. GAS-5, SEC-1 .. SEC-3, EXC-2, ADR-0002).
 * Runs sheet initialization, plain-text `@` formatting, batch write, and
 * `SpreadsheetApp.flush()` under `LockService.getScriptLock()`.
 * Exposed globally via `backend/build.mjs` footer when bundled to `dist/Code.js`.
 */
export function doPost(e?: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  let phase = 'validatePayload';
  let safeAction = 'unknown';

  try {
    const bodyCheck = validateRequestBodySize(e?.postData?.contents ?? '');
    if (!bodyCheck.ok) {
      return jsonResponse(errorEnvelope('VALIDATION_ERROR', bodyCheck.error));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyCheck.value);
    } catch {
      return jsonResponse(errorEnvelope('INVALID_JSON', 'Request body must be valid JSON'));
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).action !== 'createItem'
    ) {
      return jsonResponse(errorEnvelope('INVALID_ACTION', 'Unsupported POST action'));
    }
    safeAction = 'createItem';

    const validation = validateCreateItemPayload((parsed as Record<string, unknown>).payload);
    if (!validation.ok) {
      return jsonResponse(errorEnvelope('VALIDATION_ERROR', validation.error));
    }

    const batchCheck = validateBatchWriteRows([validation.value]);
    if (!batchCheck.ok) {
      return jsonResponse(errorEnvelope('VALIDATION_ERROR', batchCheck.error));
    }

    phase = 'loadConfig';
    const spreadsheetId = getRequiredSpreadsheetId();
    if (!spreadsheetId) {
      return missingConfigResponse('doPost', safeAction);
    }

    phase = 'acquireLock';
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      logWarn('gas.lock.timeout', {
        handler: 'doPost',
        action: safeAction,
        errorCode: 'LOCK_TIMEOUT',
      });
      return jsonResponse(errorEnvelope('LOCK_TIMEOUT', 'Server is busy, please retry'));
    }

    try {
      phase = 'openSpreadsheet';
      const ss = SpreadsheetApp.openById(spreadsheetId);

      phase = 'initSheet';
      const sheet = getOrCreateItemsSheet(ss);

      phase = 'readHeaders';
      const lastColumn = sheet.getLastColumn();
      const headerRow = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
      const col = buildColumnMap(headerRow);

      phase = 'writeItem';
      const item: ItemRecord = {
        id: Utilities.getUuid(),
        code: validation.value.code,
        name: validation.value.name,
        createdAt: new Date().toISOString(),
      };

      const rowsToWrite = [buildItemRow(item, col, headerRow.length)];
      const nextRowIndex = sheet.getLastRow() + 1;
      const targetRange = sheet.getRange(nextRowIndex, 1, rowsToWrite.length, headerRow.length);

      // Apply plain-text `@` formatting to all text columns (id, code, name, createdAt) before batch write (GAS-2)
      targetRange.setNumberFormat('@');
      targetRange.setValues(rowsToWrite);

      phase = 'flush';
      SpreadsheetApp.flush();

      logInfo('gas.item.created', {
        handler: 'doPost',
        action: safeAction,
        rowCount: rowsToWrite.length,
      });

      return jsonResponse(okEnvelope(item));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return handleUnexpectedError('doPost', safeAction, phase, err);
  }
}
