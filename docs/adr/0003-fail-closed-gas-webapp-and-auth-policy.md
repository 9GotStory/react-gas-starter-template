# Fail-closed GAS Web App defaults and mandatory backend auth verification

Status: accepted

Configure `backend/appsscript.json` with fail-closed defaults (`executeAs: "USER_DEPLOYING"`, `access: "MYSELF"`) and explicit least-privilege `oauthScopes` (`https://www.googleapis.com/auth/spreadsheets`), while requiring a pre-deployment Security Review and real server-side token verification before any downstream project exposes `ANYONE_ANONYMOUS`.

## Considered Options

- **Fail-closed `MYSELF` default + least-privilege `oauthScopes` + mandatory backend auth policy (Selected):** Prevents newly created projects from accidentally exposing live Google Sheets publicly, limits OAuth scope creep, and enforces explicit security review before enabling cross-origin public web app access.
- **Keep `ANYONE_ANONYMOUS` as template default with README warnings:** Reduces friction for initial cross-origin `fetch()` testing, but fails open and risks exposing real spreadsheet data if a developer deploys before implementing authentication.

## Consequences

- Cross-origin React SPAs in downstream projects that require `access: "ANYONE_ANONYMOUS"` must pass a Security Review prior to deployment.
- Any `ANYONE_ANONYMOUS` endpoint accessing non-public data or performing writes must verify tokens server-side (cryptographic signature, issuer `iss`, audience `aud`, and expiration `exp`) and enforce action/role authorization before reading or writing Sheets.
- Authentication tokens must never be sent in URL query parameters and static `VITE_*` frontend variables must never be used as authentication secrets; tokens must be sent in the `POST` body (avoiding custom `Authorization` headers that trigger unsupported GAS CORS preflight requests).
- Auth implementation remains in the Project-Specific capability tier; Base Template does not ship hardcoded or placeholder auth mechanisms.
