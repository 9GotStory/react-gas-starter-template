# Project Agent Guide

## Overview

- **Status:** Base Template repository — **not connected to a live Google Apps Script project or Google Sheet**. Clearly distinguish **Base Template (Offline)** verification from **Downstream Project (Connected)** setup and deployment.
- **Architecture:** Lean two-workspace monorepo (ADR-0001) with a **React (Vite) + TypeScript + Tailwind CSS + TanStack Query** frontend consuming a **Google Apps Script (GAS) Web App API** (`TypeScript` + `esbuild` + `@google/clasp` v3) backed by Google Sheets, with **zero Optional libraries pre-installed**.
- **Key Directories:**
  - `frontend/` — React + Vite + TypeScript + Tailwind CSS + TanStack Query application
  - `backend/` — TypeScript GAS Web App (`src/main.ts`, pure logic in `src/`, built to `dist/` and deployed via `@google/clasp`)
  - `.agents/skills/` — Canonical shared skills (15 skills pinned via `skills-lock.json`: 12 Matt Pocock workflow skills, `ui-ux-pro-max`, Vercel `web-design-guidelines`, and `playwright-cli`)
  - `CLAUDE.md` — Cross-platform plain-text Claude Code instruction adapter containing strictly `@AGENTS.md` (never a POSIX symlink; ADR-0007)
  - `.mcp.json` & `.codex/config.toml` — Secret-free project MCP server definitions kept in exact parity (`context7`, `playwright`); Antigravity global MCP (`~/.gemini/config/mcp_config.json`) is configured manually via `agents:setup` guidance and never mutated silently
  - `scripts/` — Offline verification, deployment safety guard, and pinned tooling scripts (`skills-sync.mjs`, `agents-setup.mjs`, `agents-check.mjs`, `gas-deploy.mjs`)
  - `.claude/skills` — Gitignored local Claude Code skills adapter created non-destructively on demand via `npm run agents:setup -- --agent claude`
  - `.github/` — Offline GitHub Actions CI merge gates (`workflows/ci.yml`), weekly grouped Dependabot (`dependabot.yml`), and lean PR/Issue templates (`pull_request_template.md`, `ISSUE_TEMPLATE/`)
  - `docs/` — Architecture Decision Records (`docs/adr/0000-template.md`, `0001`–`0007`), GitHub Issues/domain agent config (`docs/agents/`), and operational runbook (`docs/runbooks/deployment-and-operations.md`)
  - `CHANGELOG.md` — Keep a Changelog release history (see `package.json` for current version)

## Verification Commands

Run these exact commands from the repository root (do not guess scripts). Runtime is pinned to **Node.js 26 Active LTS** (`.nvmrc`) and **npm 11** (`engines` / `packageManager`):

- **Base Template Verification (Offline):** `npm ci` and `npm run verify` (chains `npm run check`, `npm run build`, `npm run verify:gas-bundle`, and `npm run test:e2e`). First-time browser setup uses `npx playwright install chromium`.
- **Full check (fast loop):** `npm run check` (runs `typecheck`, `lint`, `format:check`, `test`, and `agents:check`)
- **Test (single):** `npm --workspace=frontend run test -- path/to/file.test.ts` (or `--workspace=backend`, `npm run test:contract` for cross-workspace API contract tests, or `npm run test:tooling` for root tooling tests)
- **Test (full Vitest):** `npm run test` (runs frontend, backend, cross-workspace API contract, and tooling tests)
- **Skills Pinning & Sync:** `npm run skills:sync` reproduces pinned canonical skills into `.agents/skills/` using agent-neutral targets from `skills-lock.json` without floating `latest` auto-upgrades (pass `-- --verify` for offline manifest/frontmatter/hash verification or `-- --dry-run` to preview the sync plan).
- **Multi-Agent Local Setup:** `npm run agents:setup -- --agent <claude|codex|antigravity|all>` (offline, idempotent, opt-in per agent, strictly non-destructive; creates/verifies `.claude/skills` as a Windows junction or POSIX symlink without overwriting existing user directories/configs, verifies Codex native config, and prints manual Antigravity `~/.gemini/config/mcp_config.json` setup guidance without mutating home configs; supports `-- --dry-run`).
- **Multi-Agent Drift Check:** `npm run agents:check` runs fully offline inside `npm run check` with zero AI agent binaries, credentials, or internet access, failing on instruction drift (`AGENTS.md`/`CLAUDE.md`), `.gitignore` drift, unpinned/orphan skills, invalid `SKILL.md` frontmatter, MCP parity mismatch or secret leakage (`.mcp.json` vs `.codex/config.toml`), or broken/non-managed local `.claude/skills` links. Passing `agents:check` is an automated drift gate only and does not replace real verification in Antigravity, Claude Code, and Codex.
- **Automated E2E & Accessibility:** `npm run test:e2e` (runs `@playwright/test` + `@axe-core/playwright` WCAG 2.2 AA scans offline against the built production frontend bundle via `vite preview` using `page.route()` and shared plain fixtures in `tests/fixtures/items.ts`; set `PLAYWRIGHT_SKIP_BUILD=1` to serve a prebuilt `frontend/dist/` artifact without rebuilding; note that Axe alone is a minimum gate and does not equal full WCAG 2.2 AA compliance)
- **GitHub Actions Offline CI & Dependency Policy (ADR-0005):** `.github/workflows/ci.yml` runs on `push` to `main` and all `pull_request`s with `contents: read` permissions and PR concurrency cancellation on Node 26 LTS / npm 11 (`.nvmrc`), enforcing two required offline merge-gate jobs with zero GAS secrets or live network calls: `quality` (`npm ci`, `npm run check`, `VITE_GAS_API_URL=/api/gas npm run build`, `npm run verify:gas-bundle`, upload `frontend-dist` artifact) → `e2e` (download `frontend-dist`, cached Chromium install, `PLAYWRIGHT_SKIP_BUILD=1 npm run test:e2e`). Vulnerabilities are managed via Dependabot Alerts, Dependabot Security Updates, and weekly grouped PRs (`.github/dependabot.yml`) instead of a brittle `npm audit` CI hard blocker.
- **Offline Dev Mock API:** `npm run dev` mounts a strictly dev-only Vite middleware (`frontend/dev/mockGasMiddleware.ts`, `apply: 'serve'`, never bundled into `frontend/dist/`) at `/api/gas` backed by `tests/fixtures/items.ts` when `VITE_GAS_API_URL` is unset or `/api/gas`.
- **Typecheck:** `npm run typecheck`
- **Lint & Format:** `npm run lint && npm run format:check`
- **Production Build:** `npm run build` (builds both `frontend/dist/` and `backend/dist/`)
- **GAS Bundle Verification:** `npm run verify:gas-bundle` (offline check of `backend/dist/` file list, global `doGet`/`doPost` entrypoints, valid manifest JSON, and size budget)
- **Guarded Staging/Production GAS Deployment (Connected Projects Only, ADR-0006):** `npm run gas:push:staging`, `npm run gas:deploy:staging`, `npm run gas:push:prod`, `npm run gas:deploy:prod` (and `gas:status:staging`/`prod`, `gas:open:staging`/`prod`) wrap `clasp -P` via `scripts/gas-deploy.mjs`, enforcing build + `verifyGasBundle`, strict `scriptId`/`deploymentId`/`SPREADSHEET_ID` distinctness between Staging and Production, clean Git tree + SemVer + explicit confirmation + CI auto-deploy block for Production, and immutable versioned deployment (`push` → `create-version` → `update-deployment`); supports `-- --dry-run`. Never execute against live GAS inside the unconnected Base Template.
- **Interactive Browser QA:** Separate from automated `npm run test:e2e`, use **Playwright CLI** (`npx playwright-cli`, preferred for token efficiency) or **Playwright MCP** (`.mcp.json` / `.codex/config.toml` / Antigravity MCP config) — choose one per session (never both). In this Base Template, use the offline dev mock API (`npm run dev`) to verify UI, responsive layouts, and manual WCAG 2.2 AA keyboard/focus interactions without live GAS. Verify live GAS CORS, `script.googleusercontent.com` redirect, and JSON response reading in a real browser **only** in projects connected to a real GAS deployment.

## Source of Truth (Read on Demand)

Do NOT read all docs upfront. Load only when relevant to the current task:

- `CODING_STANDARDS.md` — Read before writing code, refactoring, or running `/code-review` (defines Capability Tiers — Core, Optional with adoption criteria, Project-Specific — plus `[ARCH]`, `[FE]`, `[GAS]`, `[SEC]`, `[TEST]`, `[OPS]`, and `[EXC]` rules).
- `GLOSSARY.md` — Read before `/grill-with-docs`, domain modeling, or writing specs to keep Sheet/UI terminology aligned.
- `docs/adr/` — Check Architecture Decision Records (`0001`–`0007` and `0000-template.md`) before changing API contracts, Sheet schemas, auth defaults, CI/tooling, deployment workflows, or multi-agent structure.
- `docs/runbooks/deployment-and-operations.md` — Read before Staging/Production environment setup, Security Review for `ANYONE_ANONYMOUS`, releases, tag-based hotfixes, rollbacks, Expand–Contract schema migrations, backups, or Cloud Logging diagnostics.
- `design-system/` — Read `design-system/<project>/MASTER.md` and relevant `design-system/<project>/pages/` files (generated via `/ui-ux-pro-max`) before designing or building UI pages.
- **Core vs. Optional UI/UX Skills (Non-Overlapping Roles):**
  - Core (pre-installed in `.agents/skills/`): `ui-ux-pro-max` generates design systems (`python3` is required **solely** for `ui-ux-pro-max/scripts/search.py` — never for application runtime, builds, or CI); Vercel `web-design-guidelines` audits UI code and accessibility against bundled offline rules; `playwright-cli` / Playwright MCP handles interactive Browser QA (choose one per session).
  - Optional (not pre-installed in Base Template): **Anthropic `frontend-design`** (bespoke visual art direction) and **Impeccable** (visual polish/critique workflows) may be added on demand in downstream projects without overlapping Core skills.
- **GitHub Issues (`docs/agents/issue-tracker.md`):** Specs and tickets live in GitHub Issues (`gh issue view` / `gh issue list`). Fetch the active spec or ticket before starting `/implement` or `/code-review`.
- **Context7 MCP:** Use Context7 (`resolve-library-id` → `query-docs`) to fetch up-to-date docs for libraries/frameworks (React, TanStack Query, React Router, Tailwind CSS, Vite, Vitest, `@google/clasp`) instead of guessing APIs.

## Workflow & Routing Conventions

- Follow the active skill loop: `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` → `/code-review` (all tracked in GitHub Issues via `docs/agents/issue-tracker.md`).
- Keep `/implement` strictly scoped to the approved spec/ticket; do not expand scope or rename Sheet columns without approval.
- Commit changes (or create a WIP commit) before running `/code-review`, as it inspects `git diff`.
- **Routing:** `react-router` is Optional and not pre-installed. Keep single-page apps simple; when a spec requires multiple pages/routes, install and use `react-router`.

## Hard Guardrails

- Never read, print, or commit `.env*`, `.clasp*.json`, `.clasprc.json`, Spreadsheet IDs, or API secrets.
- **Base Template boundary:** Never create a GAS project, bind Google Sheets, run `clasp push`/`deploy` (`npm run gas:push*`, `npm run gas:deploy*`), or request Google credentials to test this Base Template.
- Never run destructive Sheet operations, `npm run gas:push*`, or `npm run gas:deploy*` in connected projects without explicit user confirmation.
- Do not manually edit generated or dependency directories (`node_modules/`, `dist/`, `build/`).
- No `useEffect` + `fetch` in `frontend/` — use `gasClient` + TanStack Query hooks only; enforce configurable 20s timeout (`TIMEOUT`) distinct from caller cancellation (`ABORTED`), support absolute and relative URLs, classify HTTP 200 HTML/non-JSON responses as `NON_JSON_RESPONSE`, retry queries at most once strictly on transient errors (`TIMEOUT`, `NETWORK_ERROR`, `LOCK_TIMEOUT`, HTTP `429`/`5xx`) with `mutations.retry = 0`, and send GAS `POST` as `text/plain;charset=utf-8` or `application/x-www-form-urlencoded` without unnecessary custom headers (avoid CORS preflight).
- Keep `backend/appsscript.json` fail-closed (`executeAs: "USER_DEPLOYING"`, `access: "MYSELF"`, explicit least-privilege `oauthScopes`; ADR-0003). Never switch a downstream project to `ANYONE_ANONYMOUS` without a pre-deploy Security Review and real backend token verification (signature, `iss`, `aud`, `exp`, tokens sent strictly in `POST` body). For transactional downstream writes, enforce server-side `requestId` idempotency inside `LockService` backed by a durable Sheet key (never `CacheService` alone).
- Require explicit `SPREADSHEET_ID` from Script Properties (`CONFIG_MISSING` when unset; no `getActiveSpreadsheet()` fallback — ADR-0002), keep `doGet` strictly read-only, use batch Sheets I/O only, apply `.setNumberFormat("@")` to all `Item` text columns (`id`, `code`, `name`, `createdAt`) before `.setValues()`, filter blank rows and normalize `Date` cells to ISO-8601 on read, wrap writes + `SpreadsheetApp.flush()` in `LockService.getScriptLock()` (`finally` release), sanitize formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`), emit structured JSON logs without secrets/PII/Spreadsheet IDs with generic `INTERNAL_ERROR` responses, and respect official GAS quotas without premature quota-management frameworks.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.
