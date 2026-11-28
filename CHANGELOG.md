# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-28

First production-ready release of the **React + GAS Standard Starter Template** — a lean, security-by-default, offline-verifiable two-workspace monorepo (`frontend/` and `backend/`) with full multi-agent support (**Antigravity**, **Claude Code**, and **OpenAI Codex CLI**) and zero Optional libraries pre-installed.

### Added

- **Architecture Decision Records & Domain Docs:** Added `docs/adr/0001` through `docs/adr/0007`, aligned `docs/adr/0000-template.md` with the 3-criteria ADR format, added starter `Item` domain definitions in `GLOSSARY.md`, and configured GitHub Issues tracker, triage labels, and domain pointers in `docs/agents/`.
- **Frontend API Client & Resilience (ADR-0001):** Added configurable request timeout (`20_000` ms default) with `AbortController` and `AbortSignal` forwarding (`TIMEOUT` vs `ABORTED`), relative and absolute URL support, HTTP 200 HTML/non-JSON detection (`NON_JSON_RESPONSE`), canonical error code classification, and selective TanStack Query retries (max 1 retry on transient query errors only; `mutations.retry: 0`).
- **Backend Concurrency, Integrity & Structured Logging (ADR-0002):** Added strict `SPREADSHEET_ID` Script Properties enforcement (`CONFIG_MISSING`), strictly read-only `doGet` (`[]` on missing sheet/rows, `SCHEMA_ERROR` on invalid headers), `LockService` + `SpreadsheetApp.flush()` + `finally` unlock in `doPost`, strict string/length/payload validation, extended formula injection neutralization (`=`, `+`, `-`, `@`, `\t`, `\r`), `@` plain-text formatting across all `Item` text columns, blank-row filtering and `Date` → ISO-8601 read normalization, structured JSON Cloud Logging (`backend/src/logger.ts`) redacting secrets/PII/Spreadsheet IDs, generic `INTERNAL_ERROR` responses, and offline GAS entrypoint integration tests with in-memory GAS service doubles (`backend/test/mockGasHarness.ts`).
- **Offline Testing Pyramid & WCAG 2.2 AA Baseline (ADR-0004):** Added cross-workspace API contract tests (`tests/contract/api.contract.test.ts`), dev-only Vite offline mock middleware (`frontend/dev/mockGasMiddleware.ts`) sharing plain `Item` fixtures (`tests/fixtures/items.ts`), automated Playwright E2E + responsive + `@axe-core/playwright` WCAG 2.2 AA suite (`tests/e2e/app.spec.ts`), and accessible starter UI controls (explicit `<label>`s, visible focus styles, `role="status"` / `aria-busy`, `role="alert"`, and in-flight submit disabling).
- **Runtime Pinning, GAS Bundle Guard & Offline CI (ADR-0005):** Pinned Node.js 26 Active LTS and npm 11 across `.nvmrc`, `package.json`, and CI; split `backend/eslint.config.js` between GAS runtime sources and Node.js scripts; added offline GAS bundle verifier (`backend/verify-gas-bundle.mjs`, `npm run verify:gas-bundle`) and unified `npm run verify`; added GitHub Actions offline merge-gate workflow (`.github/workflows/ci.yml`: `quality` → `e2e`), weekly grouped `.github/dependabot.yml`, and PR/Issue templates.
- **Isolated Environments, Deployment Safety Guard & Runbook (ADR-0006):** Added `scripts/gas-deploy.mjs` wrapping `clasp -P` for isolated Staging and Production immutable versioned deployments (`push` → `create-version` → `update-deployment`) with `scriptId`/`deploymentId`/`SPREADSHEET_ID` collision checks, clean Git tree + SemVer + confirmation + CI auto-deploy block for Production, `backend/.env.example`, and `docs/runbooks/deployment-and-operations.md`.
- **Multi-Agent SSOT & Offline Governance (ADR-0007):** Added pinned `skills-lock.json` covering all 15 canonical skills (12 Matt Pocock workflow skills, `ui-ux-pro-max`, Vercel `web-design-guidelines`, and `playwright-cli`), cross-platform `CLAUDE.md` (`@AGENTS.md`), secret-free MCP parity between `.mcp.json` and `.codex/config.toml` plus manual Antigravity guidance, `scripts/skills-sync.mjs`, non-destructive `scripts/agents-setup.mjs`, and offline CI drift checker `scripts/agents-check.mjs` (`npm run agents:check`).

### Changed

- **Fail-Closed GAS Manifest (ADR-0003):** Updated `backend/appsscript.json` default access from `ANYONE_ANONYMOUS` to `MYSELF` with explicit least-privilege `oauthScopes` (`https://www.googleapis.com/auth/spreadsheets`).
- **Consolidated Coding Standards & Documentation:** Updated `CODING_STANDARDS.md` with the finalized Core / Optional (with adoption criteria) / Project-Specific Capability Tiers matrix, `[TEST-3]`, security/idempotency/vulnerability policies (`[SEC-4]`–`[SEC-6]`), and operational/multi-agent governance (`[OPS-1]`–`[OPS-2]`); aligned `AGENTS.md`, `README.md`, `GLOSSARY.md`, ADR template, agent docs, and operational runbook around GitHub Issues and the offline Base Template boundary.
- **Package Versions:** Bumped root and workspace (`frontend`, `backend`) package versions from `0.1.0` to `1.0.0`.

### Removed

- Removed six unused design skills (`banner-design`, `brand`, `design`, `design-system`, `slides`, `ui-styling`) after confirming zero cross-skill dependencies.
- Removed `SpreadsheetApp.getActiveSpreadsheet()` fallback in `backend/src/main.ts` (ADR-0002).
- Replaced POSIX `CLAUDE.md` symlink with a cross-platform plain-text `@AGENTS.md` import file (ADR-0007).

### Security

- Enforced fail-closed GAS Web App defaults (`MYSELF` + explicit `spreadsheets` scope) and documented mandatory pre-deploy Security Review and server-side token verification (`iss`, `aud`, `exp`, signature, `POST` body transport) before enabling `ANYONE_ANONYMOUS` in downstream projects.
- Neutralized spreadsheet formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`), redacted sensitive fields in structured backend logs, enforced secret-free MCP configs in `agents:check`, and adopted Dependabot Alerts + Security Updates + documented vulnerability triage SLAs.
