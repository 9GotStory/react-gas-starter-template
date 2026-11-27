# Coding Standards

> Covers architecture, runtime invariants, and judgement calls across Frontend and GAS Backend.
> Formatting, import ordering, and basic syntax/type checks are enforced by Prettier, ESLint, and `tsc` — do not duplicate them in reviews.

## Capability Tiers

Adopt capabilities pragmatically — keep the base template minimal and add optional packages only when required by an approved spec.

- **Core (Required):** TypeScript Strict, ESLint, Prettier, Vitest, Playwright CLI/MCP (Browser QA), and TanStack Query.
- **Optional (On Demand — add only when required by a real spec):** Zod / Advanced Validation, Idempotency, Schema Management, React Router, shadcn/ui, Lucide, React Hook Form, TanStack Table, Pagination / Batch Processing, and Retry / Backoff.
- **Project-Specific:** Authentication / Authorization and domain-specific capabilities driven by business requirements.

## 1. Monorepo & API Boundaries (Hard Violations)

- **[ARCH-1] Strict Workspace Separation:** `frontend/` must never import GAS globals or `backend/` runtime code; `backend/` must never depend on DOM, browser APIs, or React modules.
- **[ARCH-2] Single Frontend API Client:** React components must not call `fetch` directly against GAS Web App URLs. Route all requests through `frontend/src/api/gasClient.ts`, which encapsulates endpoint URLs, payload serialization, and error normalization.
- **[ARCH-3] Decoupled GAS Domain Logic:** Keep pure transformation, schema mapping, and validation logic in dedicated modules (`backend/src/sheetsLogic.ts`, etc.) separate from `SpreadsheetApp`, `LockService`, and `PropertiesService` calls in `backend/src/main.ts` so core backend rules remain unit-testable offline in Vitest while sharing the exact same code bundled into `backend/dist/Code.js` for `@google/clasp`.
- **[ARCH-4] No Speculative Abstraction:** Do not introduce generic wrappers, factories, or shared monorepo packages until at least two distinct use cases require them.

## 2. Frontend: React, TypeScript, TanStack Query & Tailwind (Conventions)

- **[FE-1] No `useEffect` + `fetch`:** Never fetch or mutate server data inside `useEffect`. Route all server state through TanStack Query (`useQuery`, `useMutation`) hooks wrapping `gasClient`.
- **[FE-2] GAS-Friendly QueryClient Defaults & Selective Retries:** Keep `refetchOnWindowFocus: false`, `staleTime: 5 * 60 * 1000`, selective query retries (at most 1 retry strictly on transient errors: `TIMEOUT`, `NETWORK_ERROR`, `LOCK_TIMEOUT`, and HTTP `429`/`5xx`; never retry `ABORTED` or validation/config/contract errors), and `mutations.retry: 0` to respect GAS execution quotas, tolerate cold starts, and prevent duplicate writes.
- **[FE-3] Validate & Classify at the API Boundary:** Enforce a configurable request timeout (default `20_000` ms) with `AbortController` while forwarding caller/TanStack Query `AbortSignal` (`TIMEOUT` vs `ABORTED`), support both absolute GAS URLs and relative local paths, classify HTTP 200 HTML/non-JSON responses as typed `NON_JSON_RESPONSE` errors, treat raw JSON returned by GAS as `unknown`, and validate the `{ ok: true, data }` / `{ ok: false, error }` envelope before entering UI state (`TIMEOUT`, `ABORTED`, `NETWORK_ERROR`, `HTTP_ERROR`, `NON_JSON_RESPONSE`, `INVALID_ENVELOPE`, `INVALID_DATA`). Do not use blind type assertions (`as SomeType`) on unvalidated network responses.
- **[FE-4] Derive State Instead of Syncing:** Compute derived values during render rather than storing duplicate state synchronized via `useEffect`.
- **[FE-5] Explicit Async States & Routing:** Every GAS-backed view must handle loading, empty, and error states explicitly. When a spec requires multiple pages/routes, install and use `react-router` instead of ad-hoc state switching.

## 3. Backend: Google Apps Script & Sheets (Hard Violations)

- **[GAS-1] Batch Sheet I/O Only:** Never call `getValue()`, `setValue()`, or `appendRow()` inside a loop. Always read/write ranges in bulk with `getValues()` and `setValues()`.
- **[GAS-2] Preserve String Columns & Leading Zeros:** Codes/IDs with leading zeros (e.g., `054`, `00123`, phone numbers) and all `Item` text columns (`id`, `code`, `name`, `createdAt`) must remain `string` end-to-end across Frontend, API DTOs, and Sheets. On write (`backend/src/main.ts`), always apply `.setNumberFormat("@")` to all target text columns **before** batch `.setValues()`. On read (`backend/src/sheetsLogic.ts`), filter blank rows, normalize `Date` cells to ISO-8601 strings, and preserve string values without coercing leading-zero codes to `number`.
- **[GAS-3] Lock Concurrent Writes & Keep Reads Read-Only:** Keep `doGet` strictly read-only (zero sheet mutations; return `[]` if the sheet or data rows do not yet exist, and `SCHEMA_ERROR` if headers are invalid). Wrap all `doPost` sheet initialization and batch writes in `LockService.getScriptLock()` with a bounded `tryLock()` timeout, call `SpreadsheetApp.flush()` after writes, and always execute `lock.releaseLock()` in a `finally` block even if `flush()` throws (ADR-0002).
- **[GAS-4] Centralized Column Schema:** Resolve columns via header mapping or a single schema definition rather than scattering hardcoded numeric column indices across handlers.
- **[GAS-5] `ContentService`, Canonical Error Envelope & Structured Logging:** Use `doGet` / `doPost` with `ContentService.createTextOutput(...).setMimeType(ContentService.MimeType.JSON)`. Per Google Official Documentation, `ContentService` cannot set custom HTTP status codes (e.g., `400`, `401`, `404`) or custom response headers, and Google redirects `/exec` via HTTP `302` to `script.googleusercontent.com` (clients must follow redirects). Every path must return `{ ok: true, data }` or `{ ok: false, error: { code, message } }` using canonical server error codes (`CONFIG_MISSING`, `SCHEMA_ERROR`, `INVALID_JSON`, `INVALID_ACTION`, `VALIDATION_ERROR`, `LOCK_TIMEOUT`, `INTERNAL_ERROR`). Record unexpected errors server-side via structured JSON `console` logs (excluding secrets, tokens, PII, and raw Spreadsheet IDs) and return a safe generic `INTERNAL_ERROR` message to clients without leaking raw exception details.
- **[GAS-6] GAS Quotas (Pragmatic):** Respect official [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas) (6 min/execution standard runtime, 30 simultaneous executions/user, 1,000/script, and daily service quotas) via batch Sheets I/O (`[GAS-1]`) and TanStack Query defaults (`[FE-2]`). Do not build complex quota-management, queueing, or rate-limiter systems upfront unless an approved spec requires them.

## 4. Security & Data Integrity (Hard Violations)

- **[SEC-1] Validate Backend Inputs:** Enforce strict string types, trimming, non-empty checks, bounded field lengths, allowed actions, and bounded payload/batch limits in `doGet`/`doPost` before touching any Sheet range.
- **[SEC-2] Explicit `SPREADSHEET_ID` & No Hardcoded Secrets:** Resolve `SPREADSHEET_ID` strictly from `PropertiesService.getScriptProperties()` and fail closed with `CONFIG_MISSING` when unset (never fall back to `SpreadsheetApp.getActiveSpreadsheet()`, ADR-0002). Read frontend endpoint URLs from `import.meta.env.VITE_GAS_API_URL`.
- **[SEC-3] Guard Against Formula Injection:** Sanitize user-supplied strings starting with `=`, `+`, `-`, `@`, `\t`, or `\r` (e.g., prefixing `'` or rejecting per spec) before writing them into Google Sheets cells.

## 5. Testing & Seams (Conventions)

- **[TEST-1] Test Behavior at Seams:** Write Vitest tests against public component behavior, API client & QueryClient contracts, backend `doGet`/`doPost` entrypoints, pure GAS transform functions, and cross-workspace API contract tests (`tests/contract/api.contract.test.ts`) linking frontend `gasClient` directly to backend `doGet`/`doPost` in memory. Do not assert on Tailwind utility class names or internal hook implementation details.
- **[TEST-2] Isolated & Deterministic:** Mock network boundaries (`fetch`) in frontend tests and pass fake clocks/IDs where needed; tests must never hit a live GAS deployment or real Google Sheet.
- **[TEST-3] Browser QA via Playwright CLI/MCP:** Use either Playwright CLI (`npx playwright-cli`) or Playwright MCP (`.mcp.json`)—never both simultaneously. Do not add a full Playwright E2E test suite unless explicitly required by a spec.
  - **Base Template (Offline / Unconnected):** Verify the template using `npm ci`, `npm run check`, `npm run build`, and `npm run verify:gas-bundle` (confirming `backend/dist/` contains strictly `Code.js` and `appsscript.json`, exposes top-level `doGet`/`doPost` globals, and stays within its size budget), and run Playwright Browser QA against a **Mock API** (UI, responsive layouts, interactions) without connecting to live GAS. Never create a GAS project, bind Google Sheets, run `clasp push`/`deploy`, or request credentials to test the Base Template.
  - **Connected Projects (Live GAS Deployment Only):** Once a downstream project is connected to a real GAS deployment, verify actual GAS API response reading in a real browser via Playwright (confirming CORS, the HTTP `302` redirect to `script.googleusercontent.com`, and valid JSON rather than an HTML login/error page) before concluding live GAS integration works.

## 6. Deliberate Exceptions (Do Not Flag)

- **[EXC-1] GAS CORS Simple `POST` Requests:** Sending `POST` payloads from `frontend/` to GAS with `Content-Type: text/plain;charset=utf-8` or `application/x-www-form-urlencoded` (without unnecessary custom request headers such as `Authorization` or `X-*`) is intentional to avoid CORS preflight (`OPTIONS`), which GAS Web Apps do not support. Do not flag this as an incorrect `Content-Type` header.
- **[EXC-2] GAS Global Entrypoints & Bundle Footer:** Exporting `doGet` / `doPost` in `backend/src/main.ts` and re-exposing them as top-level global functions via `backend/build.mjs` footer (`dist/Code.js`) is required by the Apps Script V8 runtime and `@google/clasp` v3.
- **[EXC-3] Intentional Type Duplication:** Duplicating small API DTO types and canonical error codes between `frontend/` and `backend/` is acceptable when avoiding a shared build pipeline keeps GAS deployment simple, provided they remain verified by cross-workspace API contract tests (`tests/contract/api.contract.test.ts`, ADR-0001).
