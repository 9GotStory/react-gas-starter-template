# Deployment & Operations Runbook

> **Scope:** Concise solo-dev day-2 operational runbook for downstream projects created from `react-gas-starter-template` (ADR-0002, ADR-0003, ADR-0006).
>
> **Base Template Offline Boundary:** Do **not** execute `clasp` commands, create GAS projects, bind Google Sheets, or request Google credentials inside the unconnected Base Template repository. Verify the Base Template strictly offline with `npm ci && npm run verify`.

---

## 1. Environments Overview

Keep exactly **three** environments (do not split UAT out of Staging):

| Environment     | Purpose                            | Frontend API Target                                             | Backend GAS Config (Gitignored)                        | Data Store                                        |
| --------------- | ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| **Development** | Local dev & interactive QA         | `/api/gas` (dev-only offline mock middleware via `npm run dev`) | None required                                          | Plain shared fixtures (`tests/fixtures/items.ts`) |
| **Staging**     | Integration testing + UAT sign-off | Staging Web App `/exec` URL                                     | `backend/.clasp.staging.json` + `backend/.env.staging` | Dedicated **Staging** Google Sheet                |
| **Production**  | Live end users                     | Production Web App `/exec` URL                                  | `backend/.clasp.prod.json` + `backend/.env.prod`       | Dedicated **Production** Google Sheet             |

**Hard Isolation Invariant (ADR-0006):** Staging and Production must have strictly distinct `scriptId`, `deploymentId`, and `SPREADSHEET_ID`. Never swap `.clasp.json` manually; always use file-isolated `clasp -P` guarded scripts.

---

## 2. One-Time Environment Setup (Connected Projects Only)

Perform once per downstream project after `npm ci && npm run verify` passes:

1. **Authenticate `clasp` locally** (never store `.clasprc.json` or Google OAuth credentials in Git or GitHub Actions):
   ```bash
   npm run gas:login
   ```
2. **Provision isolated resources:**
   - Create two separate Google Sheets (**Staging** and **Production**) and two separate standalone Google Apps Script projects (**Staging** and **Production**).
   - In **each** Apps Script project's **Project Settings → Script Properties**, set `SPREADSHEET_ID` to that environment's Sheet ID (mandatory per ADR-0002; runtime fails closed with `CONFIG_MISSING` when unset and never falls back to `getActiveSpreadsheet()`).
3. **Create local gitignored config files** (`.gitignore` blocks `.clasp*.json` and `.env*` while tracking only `backend/.clasp.json.example` and `backend/.env.example`):
   ```bash
   cp backend/.clasp.json.example backend/.clasp.staging.json
   cp backend/.clasp.json.example backend/.clasp.prod.json
   cp backend/.env.example backend/.env.staging
   cp backend/.env.example backend/.env.prod
   ```
   - Set distinct `scriptId` values in `backend/.clasp.staging.json` and `backend/.clasp.prod.json` (keep `"srcDir": "dist"`).
   - Set distinct `SPREADSHEET_ID` values in `backend/.env.staging` and `backend/.env.prod` (used solely by the local collision guard; GAS runtime still reads Script Properties) and leave `GAS_DEPLOYMENT_ID=` blank until Step 4 generates each environment's deployment ID.
4. **Bootstrap initial immutable Web App deployment IDs (first time only):**
   ```bash
   npm run build && npm run verify:gas-bundle
   npm run gas:push:staging
   npx --workspace=backend clasp -P .clasp.staging.json create-deployment -d "Initial staging deployment"
   ```
   - Record the returned `deploymentId` in `backend/.env.staging` as `GAS_DEPLOYMENT_ID`.
   - Repeat for Production when ready for first release (`npm run gas:push:prod -- --confirm "PUSH PROD"`, then `clasp -P .clasp.prod.json create-deployment -d "Initial production deployment"`), and record its distinct `GAS_DEPLOYMENT_ID` in `backend/.env.prod`.
5. **Verify guards with `--dry-run` (runs all checks + build + bundle verification without touching GAS):**
   ```bash
   npm run gas:deploy:staging -- --version v1.0.0-rc.1 --dry-run
   npm run gas:deploy:prod -- --version v1.0.0 --confirm "DEPLOY PROD v1.0.0" --dry-run
   ```
6. **Configure Frontend environment URLs separately:**
   - Set Staging frontend `VITE_GAS_API_URL` to the Staging `/exec` URL and Production frontend `VITE_GAS_API_URL` to the Production `/exec` URL. Never share URLs across environments.

---

## 3. Pre-Deploy Security Review Gate (ADR-0003)

`backend/appsscript.json` defaults to **fail-closed** (`executeAs: "USER_DEPLOYING"`, `access: "MYSELF"`) with explicit least-privilege `oauthScopes` (`https://www.googleapis.com/auth/spreadsheets`).

Before **any** deployment that changes `webapp.access` to `"ANYONE_ANONYMOUS"` (for cross-origin React SPAs):

- [ ] **Mandatory Security Review completed** and documented in the PR/issue before deploying.
- [ ] **Server-side token verification implemented** for every non-public read or write: verify cryptographic signature, issuer (`iss`), audience (`aud`), and expiration (`exp`), then enforce action/role authorization before touching Sheets.
- [ ] **Safe token transport:** send tokens strictly in the `POST` body (never in URL query parameters, never as static `VITE_*` frontend secrets, and never in custom `Authorization` headers that trigger unsupported GAS CORS preflight requests).
- [ ] **Least-privilege scopes:** confirm `backend/appsscript.json` requests only the minimum `oauthScopes` needed.
- [ ] **Server-side idempotency (transactional downstream projects):** for transactional, financial, inventory, or non-duplicable writes, confirm a caller-supplied `requestId` is verified inside `LockService.getScriptLock()` against a durable Google Sheet key (never `CacheService` alone; see `CODING_STANDARDS.md` `[SEC-5]`).
- [ ] **Real-browser verification (Staging):** verify in a real browser (Playwright CLI/MCP) that cross-origin requests follow the HTTP `302` redirect to `script.googleusercontent.com` and return valid JSON (not a Google Sign-In HTML page / `NON_JSON_RESPONSE`).

---

## 4. Standard Release Flow & Release Candidate Commit Parity

Merging into `main` **never** auto-deploys Production (ADR-0006). GitHub Actions CI enforces offline `quality` and `e2e` gates with zero GAS credentials, and `scripts/gas-deploy.mjs` explicitly blocks Production deploys inside CI (`CI=true` / `GITHUB_ACTIONS=true`).

### Step-by-Step Promotion

1. **Select a Release Candidate (RC) commit on `main`:**
   - Ensure the PR (including `CHANGELOG.md` updates for the upcoming SemVer release) passed `quality` + `e2e` CI checks and merged into `main`.
   - Pull `main` locally and confirm a clean working tree (`git status`) and passing `npm run verify`.
2. **Deploy the RC commit to Staging (Integration + UAT):**
   ```bash
   npm run gas:deploy:staging -- --version v1.0.0-rc.1
   ```
   - Deploy the matching frontend build configured with the Staging `/exec` URL.
   - Run Staging Integration + UAT smoke checks (including browser CORS/redirect verification, leading-zero preservation, and error handling).
   - If fixes are needed, merge fixes via PR into `main` and repeat from Step 1 — **never** patch Production directly.
3. **Take a pre-deploy Production Google Sheet snapshot** (see [Section 9](#9-pre-deploy-google-sheet-snapshots--backups)).
4. **Promote the exact same Git commit to Production:**
   - Confirm `HEAD` equals the exact commit verified on Staging (Release Candidate commit parity).
   - Tag the release with SemVer and deploy Production (requires clean Git tree, Staging/Prod ID isolation, valid SemVer `--version`, and explicit confirmation):
     ```bash
     git tag -a v1.0.0 -m "Release v1.0.0"
     npm run gas:deploy:prod -- --version v1.0.0
     # Interactive prompt requires typing: DEPLOY PROD v1.0.0
     ```
   - Deploy the Production frontend built from the exact same tag `v1.0.0` with Production `VITE_GAS_API_URL`.
   - Push the tag (`git push origin v1.0.0`) and run post-deploy smoke verification.

---

## 5. Tag-Based Hotfix Flow (When `main` Holds Unreleased Features)

When Production requires an urgent fix while `main` already contains unreleased work:

1. **Branch directly from the latest Production release tag** (not `main`):
   ```bash
   git fetch --tags
   git checkout -b hotfix/v1.0.1 v1.0.0
   ```
2. **Implement the minimal fix** with regression tests and run `npm run verify`.
3. **Verify on Staging** using the exact hotfix commit:
   ```bash
   npm run gas:deploy:staging -- --version v1.0.1-rc.1
   ```
4. **Snapshot Production Sheet** (if writes or schema are touched), then tag and deploy Production from the hotfix commit:
   ```bash
   git tag -a v1.0.1 -m "Hotfix v1.0.1"
   npm run gas:deploy:prod -- --version v1.0.1
   ```
5. **Deploy matching Production frontend** from `v1.0.1`, verify health, and push the tag (`git push origin v1.0.1`).
6. **Merge the hotfix back into `main`** via a standard PR so future releases include the fix.

---

## 6. Immutable Versioned GAS Deployment (`clasp -P`)

`npm run gas:deploy:staging` and `npm run gas:deploy:prod` execute `scripts/gas-deploy.mjs`, which enforces:

1. CI auto-deploy block (Production only).
2. Strict config validation (`srcDir: "dist"`, non-placeholder IDs) and Staging vs. Production distinctness for `scriptId`, `deploymentId`, and `SPREADSHEET_ID`.
3. Clean Git working tree + valid SemVer `--version` + explicit confirmation (`DEPLOY PROD <version>`) for Production.
4. Full production build (`npm run build`) and offline GAS bundle verification (`verifyGasBundle` checking `Code.js`, `appsscript.json`, global `doGet`/`doPost`, and size budget).
5. Immutable versioned rollout via `clasp -P <env-config>`:
   - `clasp -P .clasp.<env>.json push -f`
   - `clasp -P .clasp.<env>.json --json create-version "<version> (<shortSha>)"`
   - `clasp -P .clasp.<env>.json update-deployment <deploymentId> -V <versionNumber> -d "<version> (<shortSha>)"`

Updating the existing `<deploymentId>` to an immutable `<versionNumber>` preserves the live `/exec` URL and leaves every prior GAS version intact for instant rollback.

---

## 7. Safe, Non-Destructive Rollback Procedure

### Instant Code Rollback (Zero `/exec` URL Change)

1. **Identify the last known-good GAS version number:**
   ```bash
   npx --workspace=backend clasp -P .clasp.prod.json list-versions
   ```
2. **Repoint the Production deployment to the previous immutable version:**
   ```bash
   npx --workspace=backend clasp -P .clasp.prod.json update-deployment <PROD_DEPLOYMENT_ID> -V <PREVIOUS_VERSION> -d "Rollback to v1.0.0"
   ```
3. **Roll back the Frontend** by redeploying the previous release tag (`v1.0.0`).
4. **Verify health** on Production and inspect Cloud Logging to confirm errors stop.

### Google Sheet Data Safety Rule (Never Auto-Restore)

- **NEVER automatically restore the Google Sheet from a backup snapshot during a rollback.** Restoring an older sheet overwrites legitimate user writes recorded after the deployment, causing irreversible data loss.
- **Required manual assessment before any Sheet recovery:**
  1. Inspect post-deploy rows and Google Sheets **File → Version history** to measure exact impact.
  2. Prefer a **forward-fix** or targeted row patch over full-sheet restoration whenever possible.
  3. Only restore or patch Sheet data after documenting data impact and receiving explicit human confirmation.

---

## 8. Expand–Contract Sheet Schema Migration

Live Google Sheet schema changes must remain backward-compatible across rollbacks using the 3-phase **Expand–Contract** pattern (test every phase in Staging first and update `GLOSSARY.md` / ADRs):

1. **Expand (Release N):**
   - Append new columns at the end of the header row (never rename, delete, or reorder existing columns in place).
   - Apply plain-text number format (`@`) to new text columns before writing.
   - Deploy code that tolerates missing/empty new columns on read and writes both old and new representations where needed.
2. **Migrate / Backfill (Between Release N and N+1):**
   - Take a Production Sheet snapshot first.
   - Backfill existing rows using batch `getValues()` / `setValues()` inside `LockService` (or verified scripted migration), then confirm zero blank/corrupted cells.
3. **Contract (Release N+1, after rollback window passes):**
   - Once Release N is stable and rollback to N-1 is no longer needed, remove legacy read/write fallback logic and optionally archive or retire obsolete columns.

---

## 9. Pre-Deploy Google Sheet Snapshots & Backups

Before every Production schema migration, backfill, or risky release:

1. Open the **Production** Google Sheet and choose **File → Make a copy**.
2. Name the snapshot `<Project>-PROD-backup-YYYY-MM-DD-vX.Y.Z` and save it into a restricted-access backup folder in Google Drive (never commit sheet exports or Spreadsheet IDs to Git).
3. Verify the copied sheet opens cleanly and preserves leading-zero string columns.
4. Retain recent release snapshots according to project retention needs and periodically prune obsolete copies.

---

## 10. Cloud Logging & Production Diagnostics

`backend/appsscript.json` sets `"exceptionLogging": "STACKDRIVER"` and `backend/src/logger.ts` emits structured JSON logs (`timestamp`, `level`, `event`, `action`, `code`, `durationMs`, etc.) while redacting secrets, tokens, PII, and raw `SPREADSHEET_ID` values.

### Inspecting Logs

- **Apps Script Executions UI:** Open with `npm run gas:open:prod` → **Executions**.
- **CLI Shortcuts:**
  ```bash
  npx --workspace=backend clasp -P .clasp.prod.json open-logs
  npx --workspace=backend clasp -P .clasp.prod.json tail-logs
  ```
- **GCP Cloud Logging (Logs Explorer):** Filter by `jsonPayload.level="ERROR"` or `jsonPayload.code="INTERNAL_ERROR"` or `jsonPayload.event="doPost.error"`.

### Quick Error-Code Triage

| Error Code          | Likely Cause                                                              | Immediate Action                                                                                              |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CONFIG_MISSING`    | `SPREADSHEET_ID` missing in Apps Script Project Properties                | Set `SPREADSHEET_ID` in Project Settings → Script Properties for that environment (ADR-0002).                 |
| `SCHEMA_ERROR`      | Sheet header row missing, renamed, or reordered                           | Inspect sheet header row against `GLOSSARY.md` / `sheetsLogic.ts`; fix header without overwriting data rows.  |
| `LOCK_TIMEOUT`      | Concurrent writes exceeded `LockService.tryLock()` window                 | Check Cloud Logging for slow executions or quota spikes; confirm batch I/O (`[GAS-1]`) and `finally` unlock.  |
| `NON_JSON_RESPONSE` | HTTP 200 HTML returned (usually Google Sign-In or Apps Script error page) | Verify Web App deployment access/auth policy (ADR-0003), `/exec` URL, and `302` redirect in browser.          |
| `TIMEOUT`           | Request exceeded frontend 20s timeout (`gasClient.ts`)                    | Check GAS cold start or execution duration in Executions / Cloud Logging; verify no per-row Sheet loops.      |
| `INTERNAL_ERROR`    | Unhandled server exception (generic message returned to client)           | Inspect structured JSON error entry in Cloud Logging using timestamp/action; roll back version if widespread. |
