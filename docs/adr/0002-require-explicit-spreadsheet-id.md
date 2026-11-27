# Require explicit SPREADSHEET_ID via Script Properties without active spreadsheet fallback

Status: accepted

Resolve the target spreadsheet strictly via `PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')` and return `CONFIG_MISSING` when unset, removing the `SpreadsheetApp.getActiveSpreadsheet()` fallback, while guaranteeing `SpreadsheetApp.flush()` before releasing `LockService` in a `finally` block.

## Considered Options

- **Require explicit `SPREADSHEET_ID` only (Selected):** Enforces strict environment isolation between Staging and Production spreadsheets, fails fast with `CONFIG_MISSING` instead of an unguarded `null` error in standalone scripts, and prevents accidental writes to an unintended container-bound sheet.
- **Fallback to `SpreadsheetApp.getActiveSpreadsheet()` when `SPREADSHEET_ID` is unset:** Slightly more convenient for container-bound scripts, but weakens environment isolation and risks silently targeting the wrong spreadsheet if Script Properties are misconfigured.

## Consequences

- Every GAS deployment (Staging and Production) must explicitly configure `SPREADSHEET_ID` in Script Properties before serving requests.
- Write handlers must run inside `LockService.getScriptLock()`, call `SpreadsheetApp.flush()` after writes, and always execute `lock.releaseLock()` inside `finally` even if `flush()` throws.
