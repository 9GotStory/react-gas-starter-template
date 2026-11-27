# Project Agent Guide

## Overview

- **Status:** Base Template repository — **not connected to a live Google Apps Script project or Google Sheet**.
- **Architecture:** Monorepo with a **React (Vite) + TypeScript + Tailwind CSS + TanStack Query** frontend consuming a **Google Apps Script (GAS) Web App API** (`TypeScript` + `esbuild` + `@google/clasp` v3) backed by Google Sheets.
- **Key Directories:**
  - `frontend/` — React + Vite + TypeScript + Tailwind CSS + TanStack Query application
  - `backend/` — TypeScript GAS Web App (`src/main.ts`, pure logic in `src/`, built to `dist/` and deployed via `@google/clasp`)
  - `.agents/skills/` — Canonical shared skills (15 skills pinned via `skills-lock.json`: 12 Matt Pocock workflow skills, `ui-ux-pro-max`, Vercel `web-design-guidelines`, and `playwright-cli`)
  - `scripts/` — Offline verification and pinned tooling scripts (`skills-sync.mjs`)
  - `.scratch/` — Local workspace for specs and tickets (`/to-spec`, `/to-tickets`, gitignored)

## Verification Commands

Run these exact commands from the repository root (do not guess scripts). Runtime is pinned to **Node.js 26 Active LTS** (`.nvmrc`) and **npm 11** (`engines` / `packageManager`):

- **Base Template Verification (Offline):** `npm ci` and `npm run verify` (chains `npm run check`, `npm run build`, `npm run verify:gas-bundle`, and `npm run test:e2e`). First-time browser setup uses `npx playwright install chromium`.
- **Full check (fast loop):** `npm run check` (runs `typecheck`, `lint`, `format:check`, and `test`)
- **Test (single):** `npm --workspace=frontend run test -- path/to/file.test.ts` (or `--workspace=backend`, `npm run test:contract` for cross-workspace API contract tests, or `npm run test:tooling` for root tooling tests)
- **Test (full Vitest):** `npm run test` (runs frontend, backend, cross-workspace API contract, and tooling tests)
- **Skills Pinning & Sync:** `npm run skills:sync` reproduces pinned canonical skills into `.agents/skills/` using agent-neutral targets from `skills-lock.json` without floating `latest` auto-upgrades (pass `-- --verify` for offline manifest/frontmatter/hash verification or `-- --dry-run` to preview the sync plan).
- **Automated E2E & Accessibility:** `npm run test:e2e` (runs `@playwright/test` + `@axe-core/playwright` WCAG 2.2 AA scans offline against the built production frontend bundle via `vite preview` using `page.route()` and shared plain fixtures in `tests/fixtures/items.ts`; note that Axe alone is a minimum gate and does not equal full WCAG 2.2 AA compliance)
- **Offline Dev Mock API:** `npm run dev` mounts a strictly dev-only Vite middleware (`frontend/dev/mockGasMiddleware.ts`, `apply: 'serve'`, never bundled into `frontend/dist/`) at `/api/gas` backed by `tests/fixtures/items.ts` when `VITE_GAS_API_URL` is unset or `/api/gas`.
- **Typecheck:** `npm run typecheck`
- **Lint & Format:** `npm run lint && npm run format:check`
- **Production Build:** `npm run build` (builds both `frontend/dist/` and `backend/dist/`)
- **GAS Bundle Verification:** `npm run verify:gas-bundle` (offline check of `backend/dist/` file list, global `doGet`/`doPost` entrypoints, valid manifest JSON, and size budget)
- **Interactive Browser QA:** Separate from automated `npm run test:e2e`, use **Playwright CLI** (`npx playwright-cli`, preferred for token efficiency) or **Playwright MCP** (`.mcp.json`) — choose one per session (never both). In this Base Template, use the offline dev mock API (`npm run dev`) to verify UI, responsive layouts, and manual WCAG 2.2 AA keyboard/focus interactions without live GAS. Verify live GAS CORS, `script.googleusercontent.com` redirect, and JSON response reading in a real browser **only** in projects connected to a real GAS deployment.

## Source of Truth (Read on Demand)

Do NOT read all docs upfront. Load only when relevant to the current task:

- `CODING_STANDARDS.md` — Read before writing code, refactoring, or running `/code-review`.
- `GLOSSARY.md` — Read before `/grill-with-docs`, domain modeling, or writing specs to keep Sheet/UI terminology aligned.
- `docs/adr/` — Check Architecture Decision Records (`0000-template.md`) before changing API contracts, Sheet schemas, or structural patterns.
- `design-system/` — Read `design-system/<project>/MASTER.md` and relevant `design-system/<project>/pages/` files (generated via `/ui-ux-pro-max`) before designing or building UI pages.
- **Core vs. Optional UI/UX Skills (Non-Overlapping Roles):**
  - Core (pre-installed in `.agents/skills/`): `ui-ux-pro-max` generates design systems (`python3` is required **solely** for `ui-ux-pro-max/scripts/search.py` — never for application runtime, builds, or CI); Vercel `web-design-guidelines` audits UI code and accessibility against bundled offline rules; `playwright-cli` / Playwright MCP handles interactive Browser QA (choose one per session).
  - Optional (not pre-installed in Base Template): **Anthropic `frontend-design`** (bespoke visual art direction) and **Impeccable** (visual polish/critique workflows) may be added on demand in downstream projects without overlapping Core skills.
- `.scratch/` — Check active specs and tickets before starting `/implement`.
- **Context7 MCP:** Use Context7 (`resolve-library-id` -> `query-docs`) to fetch up-to-date docs for libraries/frameworks (React, TanStack Query, React Router, Tailwind CSS, Vite, Vitest, `@google/clasp`) instead of guessing APIs.

## Workflow & Routing Conventions

- Follow the active skill loop: `/grill-with-docs` -> `/to-spec` -> `/to-tickets` -> `/implement` -> `/code-review`.
- Keep `/implement` strictly scoped to the approved spec/ticket; do not expand scope or rename Sheet columns without approval.
- Commit changes (or create a WIP commit) before running `/code-review`, as it inspects `git diff`.
- **Routing:** `react-router` is not pre-installed. Keep single-page apps simple; when a spec requires multiple pages/routes, install and use `react-router`.

## Hard Guardrails

- Never read, print, or commit `.env*`, `.clasp.json`, `.clasprc.json`, Spreadsheet IDs, or API secrets.
- **Base Template boundary:** Never create a GAS project, bind Google Sheets, run `clasp push`/`deploy` (`npm run gas:push`, `npm run gas:deploy`), or request Google credentials to test this Base Template.
- Never run destructive Sheet operations, `npm run gas:push`, or `npm run gas:deploy` in connected projects without explicit user confirmation.
- Do not manually edit generated or dependency directories (`node_modules/`, `dist/`, `build/`).
- No `useEffect` + `fetch` in `frontend/` — use `gasClient` + TanStack Query hooks only; enforce configurable 20s timeout (`TIMEOUT`) distinct from caller cancellation (`ABORTED`), support absolute and relative URLs, classify HTTP 200 HTML/non-JSON responses as `NON_JSON_RESPONSE`, retry queries at most once strictly on transient errors (`TIMEOUT`, `NETWORK_ERROR`, `LOCK_TIMEOUT`, HTTP `429`/`5xx`) with `mutations.retry = 0`, and send GAS `POST` as `text/plain;charset=utf-8` or `application/x-www-form-urlencoded` without unnecessary custom headers (avoid CORS preflight).
- Require explicit `SPREADSHEET_ID` from Script Properties (`CONFIG_MISSING` when unset; no `getActiveSpreadsheet()` fallback — ADR-0002), keep `doGet` strictly read-only, use batch Sheets I/O only, apply `.setNumberFormat("@")` to all `Item` text columns (`id`, `code`, `name`, `createdAt`) before `.setValues()`, filter blank rows and normalize `Date` cells to ISO-8601 on read, wrap writes + `SpreadsheetApp.flush()` in `LockService.getScriptLock()` (`finally` release), sanitize formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`), emit structured JSON logs without secrets/PII/Spreadsheet IDs with generic `INTERNAL_ERROR` responses, and respect official GAS quotas without premature quota-management frameworks.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.
