# Project Agent Guide

## Overview

- **Status:** Base Template repository — **not connected to a live Google Apps Script project or Google Sheet**.
- **Architecture:** Monorepo with a **React (Vite) + TypeScript + Tailwind CSS + TanStack Query** frontend consuming a **Google Apps Script (GAS) Web App API** (`TypeScript` + `esbuild` + `@google/clasp` v3) backed by Google Sheets.
- **Key Directories:**
  - `frontend/` — React + Vite + TypeScript + Tailwind CSS + TanStack Query application
  - `backend/` — TypeScript GAS Web App (`src/main.ts`, pure logic in `src/`, built to `dist/` and deployed via `@google/clasp`)
  - `.scratch/` — Local workspace for specs and tickets (`/to-spec`, `/to-tickets`, gitignored)

## Verification Commands

Run these exact commands from the repository root (do not guess scripts). Runtime is pinned to **Node.js 26 Active LTS** (`.nvmrc`) and **npm 11** (`engines` / `packageManager`):

- **Base Template Verification (Offline):** `npm ci`, `npm run check`, `npm run build`, and `npm run verify:gas-bundle` (verifies `backend/dist/` contains strictly `Code.js` and `appsscript.json`, exposes top-level `doGet`/`doPost` globals, and stays within the bundle size budget).
- **Full check:** `npm run check` (runs `typecheck`, `lint`, `format:check`, and `test`)
- **Test (single):** `npm --workspace=frontend run test -- path/to/file.test.ts` (or `--workspace=backend`, or `npm run test:contract` for cross-workspace API contract tests)
- **Test (full):** `npm run test` (runs frontend, backend, and cross-workspace API contract tests)
- **Typecheck:** `npm run typecheck`
- **Lint & Format:** `npm run lint && npm run format:check`
- **Production Build:** `npm run build` (builds both `frontend/dist/` and `backend/dist/`)
- **GAS Bundle Verification:** `npm run verify:gas-bundle` (offline check of `backend/dist/` file list, global `doGet`/`doPost` entrypoints, valid manifest JSON, and size budget)
- **Browser QA:** Use **Playwright CLI** (`npx playwright-cli`, preferred for token efficiency) or **Playwright MCP** (`.mcp.json`) — choose one per session (never both). In this Base Template, use a **Mock API** to verify UI, responsive layouts, and interactions without live GAS. Verify live GAS CORS, `script.googleusercontent.com` redirect, and JSON response reading in a real browser **only** in projects connected to a real GAS deployment.

## Source of Truth (Read on Demand)

Do NOT read all docs upfront. Load only when relevant to the current task:

- `CODING_STANDARDS.md` — Read before writing code, refactoring, or running `/code-review`.
- `GLOSSARY.md` — Read before `/grill-with-docs`, domain modeling, or writing specs to keep Sheet/UI terminology aligned.
- `docs/adr/` — Check Architecture Decision Records (`0000-template.md`) before changing API contracts, Sheet schemas, or structural patterns.
- `design-system/` — Read `design-system/<project>/MASTER.md` and relevant `design-system/<project>/pages/` files (generated via `/ui-ux-pro-max`) before designing or building UI pages.
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
