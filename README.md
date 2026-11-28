# react-gas-starter-template

GitHub Base Template Repository แบบ Monorepo สำหรับสร้างเว็บแอปด้วย **React (Vite + TypeScript + Tailwind CSS + TanStack Query)** คู่กับ **Google Apps Script (GAS) Web App + Google Sheets** ที่เขียนด้วย TypeScript, bundle ด้วย **esbuild** และ deploy ผ่าน **`@google/clasp` v3** พร้อมวางระบบเอกสารและสกิลสำหรับ AI-Assisted Development ครบชุด

> **หมายเหตุ (Base Template Offline vs. Downstream Connected Project):** Repository นี้เป็น **Base Template ที่ยังไม่ได้เชื่อมต่อ Google Apps Script หรือ Google Sheets จริง** และมี **zero Optional libraries pre-installed**
>
> - **ใน Base Template (Offline Verification เท่านั้น):** ตรวจสอบด้วย `npm ci` และ `npm run verify` (`check` → `build` → `verify:gas-bundle` → Playwright E2E) พร้อม dev-only Mock API (`npm run dev`) — AI Agent ต้องไม่สร้าง GAS Project, ผูก Google Sheets, รัน `clasp push`/`deploy` หรือร้องขอ Credentials เพื่อทดสอบตัว Template นี้
> - **ใน Downstream Project (Connected):** เมื่อกด **Use this template** สร้างโปรเจกต์จริงแล้ว จึงผูก `clasp -P` แยก Staging/Production, ตั้งค่า `SPREADSHEET_ID` ใน Script Properties, ผ่าน Security Review ก่อนเปิด `ANYONE_ANONYMOUS` และทดสอบ Live GAS CORS/redirect ในเบราว์เซอร์จริงตาม `docs/runbooks/deployment-and-operations.md`

---

## Tech Stack & Tooling

- **Runtime:**
  - **Node.js 26 Active LTS + npm 11** ตรึงเวอร์ชันตรงกันทุกจุดผ่าน `.nvmrc`, `engines` และ `packageManager` ใน `package.json` (ADR-0005)

- **Frontend (`frontend/`):**
  - **React 19 + Vite 7 + TypeScript + Tailwind CSS v4**
  - **TanStack Query v5** ตั้งค่า default ให้เหมาะกับโควตาและ cold-start ของ GAS (`refetchOnWindowFocus: false`, `staleTime: 5 * 60 * 1000`, retry queries ได้สูงสุด 1 ครั้งเฉพาะ transient errors: `TIMEOUT`, `NETWORK_ERROR`, `LOCK_TIMEOUT`, HTTP `429`/`5xx`, ไม่ retry `ABORTED` หรือ validation/config/contract errors และตั้ง `mutations.retry: 0`) ใน `frontend/src/lib/queryClient.ts`
  - **Single GAS API Client** (`frontend/src/api/gasClient.ts`) รองรับทั้ง absolute GAS URL และ relative path (`/api/gas`), บังคับ request timeout (ค่าเริ่มต้น `20_000` ms) ด้วย `AbortController` พร้อมส่งต่อ `AbortSignal` และแยก `TIMEOUT` ออกจาก `ABORTED`, แปลง HTTP 200 HTML/non-JSON เป็น typed `NON_JSON_RESPONSE` error, ส่ง `POST` แบบ simple request (`Content-Type: text/plain;charset=utf-8` หรือ `application/x-www-form-urlencoded`) โดยไม่ใส่ Custom Headers เกินจำเป็นเพื่อเลี่ยง CORS preflight ของ GAS และ validate response JSON จาก `unknown` ทุกครั้ง
  - **Starter `Item` UI (WCAG 2.2 AA Baseline)** (`frontend/src/App.tsx`) มี explicit `<label>` สำหรับอินพุต `Item code` / `Item name`, visible focus indicators, live regions (`role="status"` / `aria-busy` และ `role="alert"`), validation error feedback และปิดปุ่มขณะส่งข้อมูลเพื่อกัน double-submit
  - **Dev-Only Offline Mock API** (`frontend/dev/mockGasMiddleware.ts`, `apply: 'serve'`) เปิด endpoint `/api/gas` จาก plain `Item` fixtures ที่ใช้ร่วมกับ Playwright E2E (`tests/fixtures/items.ts`) โดยไม่ใช้ mock framework และไม่ถูก bundle ลง `frontend/dist/` เมื่อรัน `npm run dev` โดยยังไม่ตั้งค่า `VITE_GAS_API_URL` จะทำงาน offline ได้ทันที
  - **นโยบาย Routing:** ยังไม่ติดตั้ง `react-router` ล่วงหน้าเพื่อให้ Single-Page App เบาที่สุด หาก Spec ต้องการหลายหน้า/หลาย URL ให้ติดตั้งและใช้ `react-router` เป็นมาตรฐาน
- **Backend (`backend/`):**
  - **TypeScript + `@types/google-apps-script`** แยก entrypoint (`backend/src/main.ts` รองรับ `doGet`/`doPost` ตามความเหมาะสม) และ pure logic (`backend/src/sheetsLogic.ts`) ออกจากกันชัดเจน ไม่ต้องเขียน logic ซ้ำสองที่
  - **Bundle ด้วย `esbuild`** (`backend/build.mjs`) ออกเป็น `backend/dist/Code.js` (พร้อม global footer `doGet(e)` / `doPost(e)` สำหรับ Apps Script V8) และคัดลอก `backend/appsscript.json` (ค่าเริ่มต้นแบบ fail-closed: `executeAs: "USER_DEPLOYING"`, `access: "MYSELF"`, explicit scope `https://www.googleapis.com/auth/spreadsheets` ตาม ADR-0003) ลง `backend/dist/appsscript.json`
  - **แยกขอบเขต ESLint ฝั่ง Backend** (`backend/eslint.config.js`) ให้ไฟล์ GAS runtime (`src/**/*.ts`) ไม่อนุญาต Node.js-only globals หรือ `node:*` imports ขณะที่สคริปต์ฝั่ง Node.js (`build.mjs`, `verify-gas-bundle.mjs`) ยังใช้ Node.js globals ได้ตามปกติ
  - **ตรวจสอบ GAS Bundle แบบ Offline** (`npm run verify:gas-bundle` / `backend/verify-gas-bundle.mjs`) ยืนยันว่า `backend/dist/` มีเฉพาะ `Code.js` กับ `appsscript.json`, `appsscript.json` เป็น JSON object ที่ถูกต้อง, `Code.js` expose global `doGet`/`doPost` และมีขนาดไม่เกินงบประมาณ (`100 KiB`)
  - **Deploy ด้วย `@google/clasp` v3** (ติดตั้งเป็น devDependency ใน `backend/` พร้อมใช้งานทันที) ชี้ `srcDir: "dist"` / `rootDir: "dist"` ทำให้ `clasp` track เฉพาะไฟล์ที่ build แล้ว ไม่หลุดไฟล์เทสหรือ config ขึ้น GAS
- **Quality & Verification:**
  - **Vitest** (ครอบคลุม `frontend/` แบบ `jsdom` + Testing Library, `backend/` แบบ `node` offline และ Cross-Workspace API Contract Tests ใน `tests/contract/api.contract.test.ts` ที่เชื่อม `gasClient` เข้ากับ `doGet`/`doPost` โดยตรงในหน่วยความจำตาม ADR-0001) + **ESLint** + **Prettier** + **TypeScript (`tsc --noEmit`)** + **Vite build + esbuild GAS bundle**
  - **Automated Playwright E2E & Accessibility (`npm run test:e2e`, Core — ADR-0004):** รัน `@playwright/test` + `@axe-core/playwright` แบบ offline กับ production bundle จริง (`frontend/dist/`) ผ่าน `vite preview` โดย intercept เฉพาะ HTTP boundary (`page.route()`) ด้วย shared plain `Item` fixtures (`tests/fixtures/items.ts`) เพื่อทดสอบ list/create, การคงเลขศูนย์นำหน้า (`00123`), client/server validation, HTTP 200 HTML (`NON_JSON_RESPONSE`), responsive desktop/mobile, การไม่หลุดของ dev mock middleware ใน production bundle และการสแกน WCAG 2.2 AA ด้วย Axe (รองรับ `PLAYWRIGHT_SKIP_BUILD=1` สำหรับรันกับ artifact `frontend/dist/` ที่ build มาแล้วใน CI) _(หมายเหตุ: ผลผ่านจาก Axe เป็น minimum automated gate เท่านั้น ไม่เท่ากับการผ่าน WCAG 2.2 AA ครบถ้วน ยังต้องตรวจ keyboard/focus/semantic ด้วยมือเพิ่มเติม)_
  - **GitHub Actions Offline CI & Dependabot (ADR-0005, ADR-0006):** `.github/workflows/ci.yml` รันอัตโนมัติบน `push` เข้า `main` และทุก `pull_request` ด้วยสิทธิ์ขั้นต่ำ `contents: read`, ยกเลิกรันค้างของ PR เดิมอัตโนมัติ (`concurrency`), ตรึง Node.js 26 Active LTS / npm 11 จาก `.nvmrc` และบังคับ 2 merge-gate jobs แบบ offline 100% (ไม่ใช้ GAS secrets หรือ live network calls): `quality` (`npm ci`, `npm run check` รวม `agents:check`, production builds, `verify:gas-bundle` และ upload `frontend-dist`) ส่งต่อให้ `e2e` (download `frontend-dist`, cache Chromium และรัน Playwright E2E + responsive + WCAG 2.2 AA Axe) พร้อม `.github/dependabot.yml` แยกกลุ่มอัปเดตรายสัปดาห์และ PR/Issue templates ที่สอดคล้องกับ GitHub Flow และ GitHub Issues
  - **Interactive Browser QA ด้วย Playwright CLI / MCP (แยกจาก Automated E2E):** ใช้ `npx playwright-cli` (ประหยัด token) หรือ **Playwright MCP** ใน `.mcp.json` เลือกใช้อย่างใดอย่างหนึ่งต่อ session (ไม่ใช้พร้อมกัน)
    - **ใน Base Template (Offline):** ใช้ Dev-Only Mock API (`npm run dev`) ทดสอบ UI, Responsive และ manual WCAG 2.2 AA keyboard/focus interactions โดยไม่ต้องเชื่อมต่อ GAS จริง
    - **ในโปรเจกต์ที่เชื่อมต่อ GAS จริงแล้วเท่านั้น:** ทดสอบ CORS, HTTP `302` redirect ไป `script.googleusercontent.com` และการอ่าน JSON Response ผ่าน Browser จริงก่อนสรุปว่าใช้งานได้
  - การันตีพฤติกรรม GAS runtime ตามเอกสารทางการ: บังคับอ่าน `SPREADSHEET_ID` จาก Script Properties โดยไม่ fallback ไป `getActiveSpreadsheet()` (`CONFIG_MISSING`, ADR-0002), `doGet` เป็น read-only ล้วน (คืน `[]` เมื่อยังไม่มีชีต/ข้อมูล และคืน `SCHEMA_ERROR` เมื่อ header ผิด), ใช้ Batch Read/Write และล็อกการสร้างชีต/เขียนพร้อมกันใน `doPost` ด้วย `LockService.getScriptLock().tryLock()` + `SpreadsheetApp.flush()` + ปลดล็อกใน `finally` เสมอ, คงทุกคอลัมน์ข้อความของ `Item` (`id`, `code`, `name`, `createdAt`) ด้วย `.setNumberFormat("@")` ก่อน `.setValues()` พร้อมกรองแถวว่างและแปลง `Date` เป็น ISO-8601 ตอนอ่าน, ตรวจชนิด string/ความยาว/ขนาด payload และกัน Formula Injection (`=`, `+`, `-`, `@`, `\t`, `\r`), บันทึก log แบบ Structured JSON ผ่าน `console` โดยไม่หลุด secrets/PII/Spreadsheet ID และคืน canonical error envelope (`CONFIG_MISSING`, `SCHEMA_ERROR`, `INVALID_JSON`, `INVALID_ACTION`, `VALIDATION_ERROR`, `LOCK_TIMEOUT`, `INTERNAL_ERROR` แบบ generic message) เพราะ `ContentService` ตั้ง HTTP status code หรือ custom response headers เองไม่ได้ และคำนึงถึง [GAS Quotas](https://developers.google.com/apps-script/guides/services/quotas) (6 นาที/execution, 30 concurrent/user, 1,000/script) โดยไม่สร้างระบบจัดการโควตาซับซ้อนล่วงหน้า
- **AI Tooling & Docs (Multi-Agent SSOT — Antigravity, Claude Code, Codex CLI, ADR-0007):**
  - `AGENTS.md` เป็น Single Source of Truth สำหรับคำสั่งโครงการแบบ Read on Demand, `CLAUDE.md` เป็นไฟล์ข้อความธรรมดาที่มีเฉพาะ `@AGENTS.md` (ไม่ใช้ POSIX symlink เพื่อให้ใช้งานเหมือนกันทั้ง Windows, Linux และ macOS), `CODING_STANDARDS.md` (แบ่ง Capabilities เป็น Core / Optional / Project-Specific), `GLOSSARY.md`, `docs/adr/`
  - `.mcp.json` (Claude Code) และ `.codex/config.toml` (OpenAI Codex CLI) กำหนด **Context7 MCP** (`@upstash/context7-mcp`) และ **Playwright MCP** (`@playwright/mcp@latest`) ตรงกันทุกตัวแบบ **zero secrets** ส่วน **Antigravity** (`~/.gemini/config/mcp_config.json`) มีคู่มือและ snippet ให้ตั้งค่าด้วยตนเองโดยไม่แก้ไฟล์ใน home directory อัตโนมัติ
  - `.agents/skills/` เป็นโฟลเดอร์สกิลกลางเพียงจุดเดียวที่ commit ใน Git ติดตั้งเฉพาะชุด **Canonical Shared Skills 15 ตัว** ที่ตรึงเวอร์ชัน/commit hash ชัดเจนใน `skills-lock.json` (ไม่ auto-upgrade เป็น `latest` และไม่ผูกกับเอเจนต์ใดเอเจนต์หนึ่ง): **Matt Pocock Workflow 12 ตัว**, **UI/UX Pro Max** (ออกแบบ Design System — `python3` จำเป็น**เฉพาะ**สำหรับสคริปต์ `search.py` ของสกิลนี้เท่านั้น ไม่จำเป็นสำหรับ Application Runtime, Build หรือ CI), **Vercel `web-design-guidelines`** (ตรวจสอบคุณภาพ UI และ Accessibility แบบ offline จาก ruleset ที่แนบมา) และ **Playwright CLI Skill** (`.agents/skills/playwright-cli/` สำหรับ Interactive Browser QA) ส่วน **Anthropic `frontend-design`** และ **Impeccable** ถูกจัดอยู่ในระดับ **Optional** (ไม่ได้ติดตั้งล่วงหน้าใน Base Template) เพื่อไม่ให้บทบาทซ้ำซ้อนกัน
  - `.claude/skills` ถูก gitignore ไว้และสร้างเฉพาะเครื่องเมื่อผู้ใช้ opt-in ผ่าน `npm run agents:setup -- --agent claude` (offline, idempotent, non-destructive ไม่ทับโฟลเดอร์/คอนฟิกเดิมของผู้ใช้) และตรวจ drift แบบ offline ใน `npm run check` ด้วย `npm run agents:check` โดยไม่ต้องติดตั้ง binary ของ AI agent, credentials หรืออินเทอร์เน็ต

### Capability Tiers & Manual Release Gates (`CODING_STANDARDS.md`)

Base Template ตั้งใจคงเฉพาะ **Core** เท่านั้นและ **ไม่ติดตั้งไลบรารีระดับ Optional ล่วงหน้า** เพื่อให้ GAS bundle เล็กและ cold-start เร็ว (ดูตารางเกณฑ์การเลือกใช้ฉบับเต็มใน [`CODING_STANDARDS.md`](CODING_STANDARDS.md)):

- **Core (ติดตั้งพร้อมใช้):** Stack หลัก (`React 19`, `Vite 7`, `Tailwind v4`, `TanStack Query v5`, `TypeScript + esbuild + @google/clasp v3`), Runtime Pinning (`Node.js 26 Active LTS + npm 11`), Engineering Quality Baseline, Security & Data Integrity Baseline และ Core AI Tooling (15 pinned skills + Context7/Playwright MCP)
- **Optional (ไม่ได้ติดตั้งล่วงหน้าใน Base Template — เพิ่มเฉพาะเมื่อ Spec ต้องการ):** Zod v4 (`zod/mini` + `config({ jitless: true })` สำหรับ GAS V8), React Router, shadcn/ui, Lucide React, React Hook Form, TanStack Table, Recharts (ค่าเริ่มต้นสำหรับงานกราฟทั่วไป) / Apache ECharts (ชุดข้อมูลขนาดใหญ่), **Server-Side Idempotency** _(Optional ใน Base Template แต่ **บังคับใช้** ในโปรเจกต์ปลายทางที่มี transactional/non-duplicable writes ด้วย `requestId` ภายใน `LockService` และเก็บ durable key ใน Google Sheet โดยไม่พึ่ง `CacheService` อย่างเดียว)_, Pagination / Batch Chunking และ Optional UI/UX Skills (Anthropic `frontend-design`, `Impeccable`)
- **Project-Specific:** Authentication / Authorization (ไม่มี placeholder auth ใน Base Template; ADR-0003) และ domain/external integrations ตามความต้องการธุรกิจ
- **Manual Release Acceptance Gates (นอกเหนือจาก automated gate):** ผลผ่านของ `@axe-core/playwright` และ `npm run agents:check` เป็นเพียง minimum automated gates — ก่อนปล่อย release จริงต้องตรวจ keyboard/focus/semantic accessibility ด้วยมือตาม WCAG 2.2 AA และยืนยัน Skills Discovery, Instructions loading และ Context Continuity จริงใน **Antigravity**, **Claude Code** และ **OpenAI Codex CLI**

---

## โครงสร้างโปรเจกต์

```text
.
├── AGENTS.md                        # คู่มือหลักแบบ Read on Demand สำหรับ AI Agent (SSOT)
├── CHANGELOG.md                     # ประวัติการเปลี่ยนแปลงตามมาตรฐาน Keep a Changelog
├── CLAUDE.md                        # ไฟล์ข้อความธรรมดา (@AGENTS.md) รองรับ Windows/Linux/macOS ไม่ใช้ POSIX symlink
├── CODING_STANDARDS.md              # กฎสถาปัตยกรรม FE/GAS, Capability Tiers, ความปลอดภัย, การเทส และข้อยกเว้น
├── GLOSSARY.md                      # คำศัพท์โดเมนตัวอย่างเริ่มต้น (Item / Items) — แทนที่ด้วยโดเมนจริงในโปรเจกต์ปลายทาง
├── .mcp.json                        # การตั้งค่า Context7 MCP + Playwright MCP สำหรับ Claude Code (zero secrets)
├── .codex/
│   └── config.toml                  # การตั้งค่า Context7 MCP + Playwright MCP สำหรับ Codex CLI (parity กับ .mcp.json)
├── .github/
│   ├── dependabot.yml               # อัปเดตรายสัปดาห์แบบจัดกลุ่มสำหรับ npm (prod/dev minor/patch) และ GitHub Actions
│   ├── pull_request_template.md     # เทมเพลต PR แบบกระชับ (GitHub Flow, Verification, Security & Schema checklist)
│   ├── ISSUE_TEMPLATE/
│   │   ├── config.yml               # เปิด blank_issues_enabled: true เพื่อให้ /to-spec และ /to-tickets ใช้งานได้ลื่นไหล
│   │   ├── bug_report.md            # เทมเพลตแจ้งบั๊ก (ติดป้าย needs-triage อัตโนมัติ)
│   │   └── feature_request.md       # เทมเพลตเสนอฟีเจอร์ (เสริมไม่ซ้ำกับ /to-spec และ /to-tickets)
│   └── workflows/
│       └── ci.yml                   # Offline CI merge gates: quality -> e2e (Node 26 LTS / npm 11, artifact handoff)
├── .gitignore                       # ดัก .env*, .clasp*.json (คง .clasp.json.example), .clasprc.json, .scratch/, .claude/skills, .playwright-cli/, dist/
├── .nvmrc                           # ตรึง Node.js 26 Active LTS
├── package.json                     # Root workspaces, engines/packageManager (Node 26 / npm 11) & scripts
├── skills-lock.json                 # Unified skills manifest/lockfile ตรึง commit/version และ hash ครบทั้ง 15 สกิล
├── playwright.config.ts             # Playwright E2E config รันกับ production bundle (vite preview)
├── vitest.config.ts                 # Root Vitest projects config (frontend + backend + contract + tooling)
├── scripts/
│   ├── eslint.config.mjs            # ESLint config สำหรับ Node.js tooling scripts
│   ├── skills-sync.mjs              # สคริปต์ซิงก์และตรวจสกิลแบบ agent-neutral ตาม pin ใน skills-lock.json
│   ├── skills-sync.test.mjs         # Offline tests ตรวจ pin, frontmatter, hash และ dry-run/sync ของ skills-sync
│   ├── agents-setup.mjs             # สคริปต์ตั้งค่า local adapter แบบ offline, opt-in และ non-destructive (Claude/Codex/Antigravity)
│   ├── agents-setup.test.mjs        # Offline tests ยืนยัน idempotency และไม่ทับโฟลเดอร์/คอนฟิกเดิมของผู้ใช้
│   ├── agents-check.mjs             # สคริปต์ตรวจ multi-agent drift แบบ offline ใน npm run check (ไม่ใช้ binary/network/credentials)
│   ├── agents-check.test.mjs        # Offline tests ตรวจ instruction drift, skills pin/frontmatter, MCP parity และ secret leakage
│   ├── gas-deploy.mjs               # Deployment safety guard สำหรับ clasp -P Staging/Production (build/bundle, ID isolation, clean Git, Prod confirm)
│   └── gas-deploy.test.mjs          # Offline tests ของ deployment safety guard และกฎ .gitignore ด้วย temp fixtures
├── tests/
│   ├── fixtures/
│   │   └── items.ts                 # Shared plain Item fixtures + pure mock controller (dev mock & E2E)
│   ├── e2e/
│   │   ├── app.spec.ts              # Automated Playwright E2E, responsive & WCAG 2.2 AA Axe suite
│   │   ├── eslint.config.mjs        # ESLint config สำหรับชุด E2E และ shared fixtures
│   │   └── tsconfig.json            # TypeScript strict config สำหรับชุด E2E และ shared fixtures
│   └── contract/
│       ├── api.contract.test.ts     # Cross-workspace API contract tests (gasClient <-> doGet/doPost)
│       ├── eslint.config.mjs        # ESLint config สำหรับชุด contract tests
│       └── tsconfig.json            # TypeScript strict config สำหรับชุด contract tests
├── docs/
│   ├── adr/
│   │   ├── 0000-template.md         # เทมเพลต ADR (บันทึกเฉพาะเมื่อครบทั้ง 3 เกณฑ์)
│   │   └── 0001..0007-*.md          # บันทึกการตัดสินใจสถาปัตยกรรมหลักของ Template (ADR-0001 ถึง ADR-0007)
│   ├── agents/
│   │   ├── domain.md                # การอ้างอิง GLOSSARY.md และ docs/adr/ (Single-context)
│   │   ├── issue-tracker.md         # ข้อกำหนดการใช้ GitHub Issues ผ่าน gh CLI สำหรับ Spec และ Tickets
│   │   └── triage-labels.md         # ตารางป้ายกำกับ 5 บทบาทมาตรฐาน (needs-triage .. wontfix)
│   └── runbooks/
│       └── deployment-and-operations.md # คู่มือปฏิบัติการ Staging/Production, Security Review, Release/Hotfix, Rollback, Migration & Cloud Logging
├── .agents/
│   └── skills/                      # Canonical skills 15 ตัว: Matt Pocock 12 ตัว + UI/UX Pro Max + Vercel web-design-guidelines + Playwright CLI
├── frontend/
│   ├── .env.example                 # ตัวอย่าง VITE_GAS_API_URL (ไม่ตั้งค่าตอน dev จะใช้ offline mock API)
│   ├── dev/
│   │   ├── mockGasMiddleware.ts     # Dev-only Vite middleware (apply: 'serve') ใช้ shared fixtures
│   │   └── mockGasMiddleware.test.ts # Unit tests ยืนยันพฤติกรรม dev-only mock middleware
│   ├── package.json                 # Dependencies & scripts ฝั่ง frontend
│   ├── vite.config.ts               # Vite + React + Tailwind v4 + dev-only mock plugin + Vitest (jsdom)
│   └── src/
│       ├── api/
│       │   ├── gasClient.ts         # API client จุดเดียว (20s timeout, ABORTED/TIMEOUT, relative URL, NON_JSON_RESPONSE)
│       │   └── gasClient.test.ts    # Unit tests ของ gasClient ที่ fetch seam
│       ├── hooks/
│       │   └── useItems.ts          # ตัวอย่าง TanStack Query hooks (ส่งต่อ AbortSignal ใน useQuery)
│       ├── lib/
│       │   ├── queryClient.ts       # QueryClient ค่าเริ่มต้น (selective query retry + mutations.retry = 0)
│       │   └── queryClient.test.ts  # Tests นโยบาย selective retry และ zero mutation retry
│       ├── App.tsx                  # หน้าตัวอย่าง WCAG 2.2 AA baseline (loading / empty / error / data / validation)
│       └── App.test.tsx             # Component tests ด้วย Testing Library (GET/POST/validation/accessible queries)
└── backend/
    ├── .clasp.json.example          # ตัวอย่าง clasp config (srcDir: "dist") สำหรับคัดลอกเป็น .clasp.staging.json / .clasp.prod.json
    ├── .env.example                 # ตัวอย่าง metadata สำหรับ guard ตรวจชน ID (.env.staging / .env.prod ถูก gitignore)
    ├── appsscript.json              # Apps Script V8 Web App manifest (fail-closed: MYSELF + spreadsheets scope)
    ├── build.mjs                    # esbuild bundler -> dist/Code.js + dist/appsscript.json
    ├── eslint.config.js             # ESLint แยก GAS runtime source ออกจาก Node.js scripts
    ├── eslint.config.test.mjs       # Offline tests ยืนยันขอบเขต GAS vs Node.js globals ของ ESLint
    ├── verify-gas-bundle.mjs        # ตัวตรวจ GAS bundle แบบ offline (ไฟล์, global doGet/doPost, size budget)
    ├── verify-gas-bundle.test.mjs   # Offline tests ของ verify-gas-bundle ด้วย temp fixtures
    ├── package.json                 # Dependencies (@google/clasp v3, esbuild) & gas:* / verify:gas-bundle scripts
    ├── tsconfig.json                # TypeScript config พร้อม @types/google-apps-script
    ├── dist/                        # โฟลเดอร์ผลลัพธ์จากการ build (gitignored, ใช้ push ขึ้น GAS)
    │   ├── Code.js                  # ไฟล์ที่ bundle พร้อม global doGet / doPost
    │   └── appsscript.json          # Manifest ที่คัดลอกมาเพื่อ push
    ├── test/
    │   └── mockGasHarness.ts        # In-memory GAS service doubles ใช้ร่วมกันระหว่าง backend และ contract tests
    └── src/
        ├── logger.ts                # Structured JSON logger (Cloud Logging, ตัด secrets/PII/Spreadsheet ID)
        ├── logger.test.ts           # Unit tests ของ structured logger และการกรอง sensitive keys
        ├── main.ts                  # Typed doGet (read-only) / doPost, LockService + flush, batch Sheets I/O
        ├── main.test.ts             # Offline integration tests ของ doGet/doPost ด้วย in-memory GAS doubles
        ├── sheetsLogic.ts           # Pure logic: schema mapping, strict validation, formula neutralization
        └── sheetsLogic.test.ts      # Offline Vitest unit tests
```

---

## Quick Start (หลังกด Use this template)

### ขั้นที่ 1: ติดตั้งและเช็กโปรเจกต์

1. กด **Use this template → Create a new repository** บน GitHub แล้ว clone ลงเครื่อง
2. ติดตั้ง dependencies ทั้ง monorepo (รวม `@google/clasp` v3 และ `esbuild` ใน `backend/`):
   ```bash
   npm install
   ```
3. _(พัฒนาแบบ Offline ทันที)_ รัน `npm run dev` ได้เลยโดยยังไม่ต้องสร้าง `frontend/.env` ระบบจะเปิด dev-only mock API ที่ `/api/gas` อัตโนมัติ หรือเมื่อพร้อมเชื่อม GAS จริงให้คัดลอกไฟล์ตัวอย่าง (ถูกดักใน `.gitignore` แล้ว — ส่วน `backend/.clasp.json` ให้จัดการในขั้นที่ 2):
   ```bash
   cp frontend/.env.example frontend/.env
   ```
4. ติดตั้ง Chromium สำหรับชุดทดสอบ Playwright E2E ครั้งแรกในเครื่อง:
   ```bash
   npx playwright install chromium
   ```
5. _(ทางเลือก)_ ซิงก์สกิลใน `.agents/skills/` ให้ตรงกับ commit hash / version ที่ตรึงไว้ใน `skills-lock.json` (ไม่ auto-upgrade เป็น `latest` โดยอัตโนมัติ) หรือตรวจสอบความถูกต้องแบบ offline ด้วย `npm run skills:sync -- --verify`:
   ```bash
   npm run skills:sync
   ```
6. _(ทางเลือก — Multi-Agent Local Setup)_ เลือกตั้งค่าเฉพาะ AI Agent ที่คุณใช้งานจริงแบบ opt-in, offline และ non-destructive (ไม่ทับโฟลเดอร์สกิลเดิมและไม่แก้ไฟล์ใน home directory อัตโนมัติ; เพิ่ม `-- --dry-run` เพื่อดูแผนก่อนได้):
   ```bash
   # สำหรับ Claude Code: สร้าง gitignored adapter .claude/skills -> ../.agents/skills (Windows junction / POSIX symlink)
   npm run agents:setup -- --agent claude

   # สำหรับ OpenAI Codex CLI: ยืนยัน AGENTS.md, .agents/skills/ และ .codex/config.toml โดยไม่ทับไฟล์เดิม
   npm run agents:setup -- --agent codex

   # สำหรับ Antigravity: พิมพ์ JSON snippet สำหรับนำไปเพิ่มเองใน ~/.gemini/config/mcp_config.json (ไม่แก้ไฟล์ home อัตโนมัติ)
   npm run agents:setup -- --agent antigravity
   ```
   > **Antigravity Global MCP Setup (Manual):** คัดลอก `mcpServers` (`context7` และ `playwright`, zero secrets) ที่ได้จากคำสั่งด้านบนหรือจาก `.mcp.json` ไปรวมไว้ใน `~/.gemini/config/mcp_config.json` ด้วยตนเอง เพื่อไม่ให้สคริปต์แตะคอนฟิกส่วนตัวของคุณโดยพลการ
7. ตรวจสอบทุกอย่างครบจบในคำสั่งเดียวแบบ Offline (`check` ซึ่งรวม `agents:check` + `build` + `verify:gas-bundle` + Playwright E2E & Axe):
   ```bash
   npm run verify
   ```
   > **หมายเหตุ (`agents:check`):** `npm run agents:check` รันแบบ offline เต็มรูปแบบ (ไม่ต้องติดตั้ง binary ของ AI agent, credentials หรืออินเทอร์เน็ต) เพื่อตรวจ drift ของคำสั่ง (`AGENTS.md`/`CLAUDE.md`), สกิลที่ตรึงไว้, MCP parity และ secret leakage โดยทำหน้าที่เป็น automated drift gate เท่านั้น และไม่แทนที่การทดสอบใช้งานจริงใน Antigravity, Claude Code และ Codex CLI

### ขั้นที่ 2: ผูก Google Apps Script ด้วย `@google/clasp` v3 _(เฉพาะโปรเจกต์จริงที่สร้างจาก Template แล้วเท่านั้น)_

1. เปิดใช้งาน **Google Apps Script API** ที่ [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
2. ล็อกอิน `clasp` ครั้งแรกในเครื่อง:
   ```bash
   npm run gas:login
   ```
3. ผูกโปรเจกต์ Google Apps Script โดยเลือกทำ **อย่างใดอย่างหนึ่ง**:
   - **กรณี A — สร้างโปรเจกต์ Apps Script ใหม่ (ไม่ต้องสร้าง `backend/.clasp.json` ล่วงหน้า):**
     ```bash
     npx --workspace=backend clasp create-script --type sheets --title "My App" --rootDir dist
     ```
     _(คำสั่งนี้จะสร้าง `backend/.clasp.json` ให้อัตโนมัติและดึงไฟล์เริ่มต้นลง `backend/dist/` หากมี `backend/.clasp.json` อยู่ก่อนคำสั่งจะ error)_
   - **กรณี B — เชื่อมต่อโปรเจกต์ Apps Script เดิมที่มี `scriptId` อยู่แล้ว:**
     ```bash
     cp backend/.clasp.json.example backend/.clasp.json
     ```
     จากนั้นแก้ค่า `scriptId` ใน `backend/.clasp.json` โดยคง `"srcDir": "dist"` ไว้
4. Build ฝั่ง backend (สคริปต์ `backend/build.mjs` จะล้างเฉพาะโฟลเดอร์ `backend/dist/` ก่อน build เพื่อกำจัดไฟล์ตกค้าง) แล้วตรวจรายการไฟล์ที่ `clasp` จะอัปโหลด:
   ```bash
   npm run build
   npm run gas:status
   ```
   > ผลลัพธ์จาก `npm run gas:status` (`clasp show-file-status`) ต้องแสดง **Tracked files** เฉพาะ `dist/Code.js` และ `dist/appsscript.json` เท่านั้น (ไม่รวมไฟล์เทสหรือ config)
5. **แยก Environment ระหว่าง Staging (Integration + UAT) และ Production ด้วย `clasp -P` และ Safety Guard (แนะนำตาม ADR-0006):**
   - คัดลอกไฟล์ตัวอย่างเป็นไฟล์เฉพาะเครื่อง (ทั้งหมดถูกดักใน `.gitignore` ด้วย `.clasp*.json` และ `.env*`):
     ```bash
     cp backend/.clasp.json.example backend/.clasp.staging.json
     cp backend/.clasp.json.example backend/.clasp.prod.json
     cp backend/.env.example backend/.env.staging
     cp backend/.env.example backend/.env.prod
     ```
   - ตั้งค่า `scriptId`, `GAS_DEPLOYMENT_ID` และ `SPREADSHEET_ID` ให้ **ไม่ซ้ำกันเด็ดขาด** ระหว่าง Staging และ Production (หลัง bootstrap `create-deployment` ครั้งแรก) แล้วใช้คำสั่งแบบ immutable versioned deployment (`build` → `verify:gas-bundle` → `clasp -P ... push` → `create-version` → `update-deployment` เพื่อคง `/exec` URL เดิม):
     ```bash
     # ทดสอบ pre-flight guard ก่อน push จริง (--dry-run)
     npm run gas:deploy:staging -- --version v1.0.0-rc.1 --dry-run

     # Deploy ขึ้น Staging (Integration + UAT)
     npm run gas:deploy:staging -- --version v1.0.0-rc.1

     # Promote commit เดียวกันขึ้น Production (บังคับ clean Git tree, SemVer, ไม่ให้รันใน CI และต้องยืนยันชัดเจน)
     npm run gas:deploy:prod -- --version v1.0.0
     ```
   - อ่านขั้นตอนเต็มสำหรับ Security Review (`ANYONE_ANONYMOUS`), Release Candidate parity, Tag-based Hotfix, Safe Rollback (ห้าม auto-restore Google Sheet), Expand–Contract Schema Migration, Pre-deploy Snapshot และ Cloud Logging ได้ที่ [`docs/runbooks/deployment-and-operations.md`](docs/runbooks/deployment-and-operations.md)
   - _(สำหรับโปรเจกต์ทดลองเดี่ยวแบบเร็ว คำสั่ง `npm run gas:deploy` / `npm run gas:push` แบบ `.clasp.json` เดี่ยวยังคงใช้งานได้ตามเดิม)_
6. เปิด Apps Script Editor เพื่อตรวจสอบสิทธิ์ Deployment, **ตั้งค่า `SPREADSHEET_ID` ใน Project Settings → Script Properties (บังคับสำหรับทุก Deployment ตาม ADR-0002 — ไม่มี `getActiveSpreadsheet()` fallback และจะคืน `CONFIG_MISSING` หากไม่ตั้งค่า)** และคัดลอก Web App `/exec` URL ไปใส่ใน `frontend/.env` (`VITE_GAS_API_URL`):
   ```bash
   npm run gas:open
   ```
   > **นโยบายความปลอดภัยเริ่มต้นของ Web App Manifest และ CORS (`backend/appsscript.json`, ADR-0003):** ค่าเริ่มต้นของ Template ตั้งเป็น **fail-closed** (`executeAs: "USER_DEPLOYING"`, `access: "MYSELF"`) พร้อมระบุ OAuth scope แบบ least-privilege (`oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"]`) เพื่อป้องกันการเปิดเผย Google Sheet สู่สาธารณะโดยไม่ตั้งใจ หากโปรเจกต์ปลายทางจำเป็นต้องเปลี่ยนเป็น `access: "ANYONE_ANONYMOUS"` เพื่อให้ Cross-Origin React SPA เรียกได้โดยไม่ติดหน้า Google Sign-In HTML **ต้องผ่าน Security Review ก่อน deploy และต้องตรวจสอบ Token ฝั่ง Backend จริง (signature, `iss`, `aud`, `exp`) พร้อมเช็กสิทธิ์ก่อนอ่าน/เขียน Sheet** โดยส่ง Token ใน `POST` body เท่านั้น (ห้ามส่งใน URL query parameters หรือฝัง secret ใน `VITE_*`) และยังคงต้องทดสอบยืนยัน CORS, HTTP `302` redirect ไป `script.googleusercontent.com` และการอ่าน JSON Response จาก Deployment จริงใน Browser ด้วย Playwright CLI/MCP ก่อนสรุปว่าใช้งานได้ ทุกครั้งที่แก้โค้ดหรือแก้ OAuth scopes ต้องอัปเดต Deployment จึงจะมีผลกับ `/exec` URL ([Google Web Apps Docs](https://developers.google.com/apps-script/guides/web) · [ContentService Docs](https://developers.google.com/apps-script/guides/content))
7. รันหน้าเว็บทดสอบในเครื่อง:
   ```bash
   npm run dev
   ```

### ขั้นที่ 3: ตรวจสอบหรือปรับแต่งการตั้งค่าสกิลสำหรับ AI Agent (ทำเฉพาะเมื่อเปลี่ยน Issue Tracker / Layout — Antigravity / Claude Code / Codex CLI)

Template นี้ตั้งค่าชุดสกิล Matt Pocock ไว้พร้อมใช้งานแล้วสำหรับ **GitHub Issues (`gh` CLI)**, ป้ายกำกับ 5 บทบาทมาตรฐาน และ Single-context domain docs ใน `docs/agents/` (`issue-tracker.md`, `triage-labels.md`, `domain.md`) — ในโปรเจกต์ปลายทางสามารถใช้งาน `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` → `/code-review` ได้ทันที หรือรันคำสั่งด้านล่างใน **แชทใหม่** เฉพาะเมื่อต้องการเปลี่ยนระบบ Issue Tracker หรือโครงสร้างโดเมน:

```text
/setup-matt-pocock-skills
```

---

## เวิร์กโฟลว์ตั้งแต่เปิดโปรเจกต์จนจบฟีเจอร์ (7 ขั้นตอน)

### ภาพรวม 7 ขั้นตอนและการจัดการแชท/Context

|  ขั้น   | เป้าหมาย                                              | คำสั่ง / สกิล                                                                         | การจัดการแชท / Context                              |
| :---: | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| **1** | ตรวจ Offline Baseline _(และผูก GAS เมื่อเป็นโปรเจกต์จริง)_ | `npm ci && npm run verify` _(Downstream: `gas:login`, `clasp -P` Staging/Prod)_    | **Terminal**                                       |
| **2** | ตรวจ/ปรับตั้งค่าสกิลกับ GitHub Issues                      | ตรวจสอบ `docs/agents/` _(หรือรัน `/setup-matt-pocock-skills` เฉพาะเมื่อเปลี่ยน Tracker)_ | **แชทใหม่ (ทำครั้งเดียวต่อโปรเจกต์ถ้าต้องการเปลี่ยน)**       |
| **3** | ตกลงขอบเขต, คำศัพท์ และ Sheet Schema                   | `/grill-with-docs`                                                                 | **แชท A (ปิด Plan Mode)**                           |
| **4** | ออกแบบ UI & สร้าง Design System                       | `/ui-ux-pro-max`                                                                   | **แชท B (แยกแชทใหม่)**                              |
| **5** | แปลงเป็น Spec และแตก Tickets บน GitHub Issues         | `/to-spec` → `/to-tickets`                                                         | **กลับไปแชท A** _(แนะนำ commit เอกสารก่อนโค้ด)_       |
| **6** | ลงมือพัฒนาโค้ด + เทสทีละงาน                              | `/implement #<ticket-number>`                                                      | **แชทใหม่ทุก Ticket (ทีละ 1 Ticket)**                 |
| **7** | รีวิวมาตรฐาน & สเปกก่อนปิดงาน                            | `/code-review` + `npm run verify`                                                  | **แชทใหม่หรือท้าย Ticket (commit/WIP commit ก่อนรีวิว)** |

### ตัวอย่าง Prompt พร้อมก๊อปในแต่ละขั้น

#### ขั้นที่ 3 — `/grill-with-docs` (แชท A — ปิด Plan Mode)

```text
/grill-with-docs
ช่วยซักถามเพื่อวางขอบเขตระบบ [ชื่อระบบ/ฟีเจอร์] ที่เชื่อมต่อ Google Sheets
- อัปเดตคำศัพท์และ Sheet-to-entity mapping ลง GLOSSARY.md
- หากมีการตัดสินใจทางสถาปัตยกรรมที่เข้าครบทั้ง 3 เกณฑ์ ให้บันทึก ADR ใน docs/adr/
```

#### ขั้นที่ 4 — `/ui-ux-pro-max` (แชท B — แยกแชทใหม่)

> **หมายเหตุ (ขอบเขต `python3` และบทบาทสกิล UI/UX):** `python3` จำเป็น**เฉพาะ**สำหรับเรียกใช้ `.agents/skills/ui-ux-pro-max/scripts/search.py` ของสกิล `ui-ux-pro-max` เท่านั้น (`python3 --version`) — **ไม่จำเป็น**สำหรับ Application Runtime, การ build หรือ CI ของโปรเจกต์
>
> - **Core UI/UX Skills (ติดตั้งพร้อมใช้ ไม่ทับซ้อนกัน):** `ui-ux-pro-max` ใช้สร้าง Design System (`MASTER.md` / page overrides), Vercel `web-design-guidelines` ใช้ตรวจ/audit โค้ด UI และ Accessibility กับ Web Interface Guidelines แบบ offline, และ `playwright-cli` / Playwright MCP ใช้ทำ Interactive Browser QA (เลือกอย่างใดอย่างหนึ่งต่อ session)
> - **Optional UI/UX Skills (ไม่ได้ติดตั้งล่วงหน้าใน Base Template):** **Anthropic `frontend-design`** (งานออกแบบ visual art direction เฉพาะทาง) และ **Impeccable** (เวิร์กโฟลว์รีวิวและขัดเกลาความประณีตของ UI) ให้เพิ่มเฉพาะเมื่อโปรเจกต์ปลายทางต้องการจริงเท่านั้น

```text
/ui-ux-pro-max
อ่าน GLOSSARY.md เพื่อเข้าใจบริบทของระบบ แล้วช่วยออกแบบ Design System สำหรับโปรเจกต์นี้
โดยบันทึกผลลง design-system/<project>/MASTER.md (และไฟล์หน้าย่อยใน design-system/<project>/pages/ ถ้าจำเป็น)
```

#### ขั้นที่ 5 — `/to-spec` → `/to-tickets` (กลับไปแชท A)

```text
/to-spec
สรุปข้อตกลงทั้งหมดจากแชทนี้ร่วมกับ GLOSSARY.md และ design-system/ เป็น Spec แล้ว publish ลง GitHub Issues ตาม docs/agents/issue-tracker.md
```

เมื่อตรวจ Spec Issue เรียบร้อยแล้ว ให้รันต่อในแชท A:

```text
/to-tickets
แตก Spec จาก GitHub Issue #<spec-number> ออกเป็น Tickets ย่อยที่จบได้ใน 1 แชทต่อ 1 Ticket บน GitHub Issues
```

> **แนะนำ:** ก่อนเริ่มลงมือเขียนโค้ด ให้ `git commit` เอกสารตั้งต้น (`GLOSSARY.md`, `docs/adr/`, `design-system/`) เก็บไว้ก่อน เพื่อให้ `git diff` ตอน `/code-review` สะอาดและเห็นเฉพาะโค้ดของฟีเจอร์

#### ขั้นที่ 6 — `/implement` (แชทใหม่ — ทีละ 1 Ticket)

```text
/implement #<ticket-number>
อ้างอิง CODING_STANDARDS.md, GLOSSARY.md และ design-system/ อย่างเคร่งครัด และรัน npm run verify ให้ผ่าน
```

#### ขั้นที่ 7 — `/code-review` (commit ก่อนรีวิว)

1. ทำ commit (หรือ WIP commit) ก่อน เพื่อให้ `/code-review` ตรวจจาก `git diff` ได้แม่นยำ:
   ```bash
   git add . && git commit -m "wip: implement #<ticket-number>"
   ```
2. รันสกิลรีวิว 2 แกน (Standards เทียบ `CODING_STANDARDS.md` และ Spec เทียบ GitHub Issue `#<ticket-number>`):
   ```text
   /code-review
   รีวิวการเปลี่ยนแปลงเทียบกับ CODING_STANDARDS.md และ GitHub Issue #<ticket-number>
   ```
3. หลังแก้ครบทุกคอมเมนต์ ให้ปิดท้ายด้วย:
   ```bash
   npm run verify
   ```

---

## ลูปประจำวัน (ตั้งแต่ฟีเจอร์ที่ 2 เป็นต้นไป)

- **พัฒนาฟีเจอร์ใหม่:**
  `/grill-with-docs` → `/to-spec` → (`/to-tickets`) → `/implement` → `/code-review`
  - เรียก `/ui-ux-pro-max` **เฉพาะเมื่อมีหน้าใหม่** ที่ต้องสร้าง override เพิ่มใน `design-system/<project>/pages/`
- **แก้บั๊กยากหรือปัญหา Performance:**
  เปิด **แชทใหม่** แล้วใช้ `/diagnosing-bugs` เพื่อไล่หาสาเหตุเชิงระบบก่อนลงมือแก้
- **ดูแล Base Template ระยะยาว:**
  เมื่อเจอกฎหรือบทเรียนที่เป็นกลางและใช้ได้กับทุกโปรเจกต์ ให้นำกลับไปอัปเดตใน `CODING_STANDARDS.md` ของ Base Template Repository

---

## ตารางคำสั่งทั้งหมด

### 1. Root Scripts (`package.json`)

| คำสั่ง                                                        | คำสั่งจริง / คำอธิบาย                                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                               | เปิด Vite dev server ของ `frontend/` พร้อม dev-only offline mock API ที่ `/api/gas` เมื่อยังไม่ตั้ง `VITE_GAS_API_URL`                                                                        |
| `npm run build`                                             | Build ทั้ง `frontend/dist/` (Vite, ไม่มี dev mock) และ `backend/dist/` (`esbuild` สำหรับ GAS)                                                                                            |
| `npm run check`                                             | รันชุดตรวจสอบครบ `typecheck` + `lint` + `format:check` + `test` + `agents:check` ทั้ง `frontend`, `backend`, `contract` และ `tooling`                                                   |
| `npm run verify:gas-bundle`                                 | ตรวจ `backend/dist/` แบบ offline (เฉพาะ `Code.js` + `appsscript.json`, global `doGet`/`doPost`, size budget)                                                                        |
| `npm run test:e2e`                                          | รัน Playwright E2E + responsive + `@axe-core/playwright` WCAG 2.2 AA กับ production bundle (`vite preview`)                                                                           |
| `npm run verify`                                            | รัน offline quality gate ครบชุด (`check` → `build` → `verify:gas-bundle` → `test:e2e`)                                                                                                |
| `npm run typecheck`                                         | รัน `tsc --noEmit` ทั้ง `frontend`, `backend`, `tests/contract` และ `tests/e2e`                                                                                                        |
| `npm run lint`                                              | รัน `eslint` ทั้ง `frontend`, `backend`, `tests/contract`, `tests/e2e`, `tests/fixtures`, `playwright.config.ts` และ `scripts`                                                         |
| `npm run format:check`                                      | ตรวจฟอร์แมตทั้ง repo ด้วย `prettier --check .`                                                                                                                                          |
| `npm run test`                                              | รัน Vitest tests แบบ offline ครบทั้ง `frontend`, `backend`, `contract` และ `tooling`                                                                                                   |
| `npm run test:contract`                                     | รันเฉพาะ cross-workspace API contract tests (`tests/contract/api.contract.test.ts`)                                                                                                  |
| `npm run test:tooling`                                      | รันเฉพาะ offline tooling tests (`scripts/**/*.test.mjs`)                                                                                                                             |
| `npm run test:watch`                                        | รัน Vitest โหมด watch ครอบคลุม `frontend`, `backend`, `contract` และ `tooling` ผ่าน `vitest.config.ts`                                                                                 |
| `npm --workspace=frontend run test -- path/to/file.test.ts` | รันเทสทีละไฟล์ฝั่ง `frontend` (เปลี่ยนเป็น `--workspace=backend` สำหรับฝั่ง backend)                                                                                                           |
| `npm run skills:sync`                                       | ซิงก์ canonical skills ทั้ง 15 ตัวลง `.agents/skills/` แบบ agent-neutral ตาม commit/version ที่ตรึงไว้ใน `skills-lock.json` (รองรับ `-- --verify` และ `-- --dry-run`, ไม่ใช้ floating `latest`) |
| `npm run agents:setup`                                      | ตั้งค่า local multi-agent adapter แบบ offline, idempotent, opt-in ต่อ agent (`-- --agent claude\|codex\|antigravity\|all`, รองรับ `-- --dry-run`) และไม่ทับโฟลเดอร์/คอนฟิกเดิมของผู้ใช้          |
| `npm run agents:check`                                      | ตรวจ multi-agent drift แบบ offline ใน `npm run check` (instruction SSOT, `.gitignore`, pinned skills/frontmatter/hash, MCP parity, zero secrets, `.claude/skills` link หากมี)        |

### 2. Backend & `@google/clasp` v3 Scripts (`backend/package.json`)

สามารถเรียกผ่าน root (`npm run gas:*`) หรือระบุ `--workspace=backend` ได้โดยตรง:

| คำสั่งจาก Root                            | คำสั่งจริงใน `backend/package.json`                            | คำอธิบาย                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm --workspace=backend run build`     | `tsc --noEmit && node build.mjs`                            | Typecheck และ bundle `src/main.ts` → `dist/Code.js` + คัดลอก `dist/appsscript.json`                                         |
| `npm --workspace=backend run typecheck` | `tsc --noEmit`                                              | ตรวจ TypeScript ฝั่ง backend พร้อม `@types/google-apps-script`                                                                |
| `npm --workspace=backend run lint`      | `eslint .`                                                  | รัน ESLint แยกขอบเขต GAS runtime (`src/**/*.ts`) และ Node.js scripts (`*.mjs`)                                              |
| `npm --workspace=backend run test`      | `vitest run`                                                | รัน offline tests ใน `backend/` (pure logic, `doGet`/`doPost` integration, logger, ESLint boundary, GAS bundle verifier)    |
| `npm run verify:gas-bundle`             | `node verify-gas-bundle.mjs`                                | ตรวจ `backend/dist/` แบบ offline (ไฟล์, global `doGet`/`doPost`, manifest, size budget)                                     |
| `npm run gas:login`                     | `clasp login`                                               | ล็อกอินบัญชี Google สำหรับ `@google/clasp`                                                                                      |
| `npm run gas:status`                    | `clasp show-file-status`                                    | แสดงรายการไฟล์ใน `dist/` ที่ `clasp` track สำหรับการ push (single-env)                                                         |
| `npm run gas:status:staging`            | `clasp -P .clasp.staging.json show-file-status`             | แสดงรายการไฟล์ที่ `clasp -P` track สำหรับ Staging                                                                              |
| `npm run gas:status:prod`               | `clasp -P .clasp.prod.json show-file-status`                | แสดงรายการไฟล์ที่ `clasp -P` track สำหรับ Production                                                                           |
| `npm run gas:push`                      | `npm run build && clasp push`                               | Build `backend/dist/` แล้วอัปโหลดขึ้น Google Apps Script (single-env)                                                          |
| `npm run gas:push:staging`              | `node scripts/gas-deploy.mjs --env staging --action push`   | Guarded `clasp -P` push ขึ้น Staging (บังคับ build + `verify:gas-bundle` + ตรวจชน ID กับ Prod; รองรับ `-- --dry-run`)            |
| `npm run gas:push:prod`                 | `node scripts/gas-deploy.mjs --env prod --action push`      | Guarded `clasp -P` push ขึ้น Production (เพิ่ม clean Git tree + block CI + ยืนยัน `PUSH PROD`)                                   |
| `npm run gas:pull`                      | `clasp pull`                                                | ดึงไฟล์ล่าสุดจาก Google Apps Script                                                                                            |
| `npm run gas:open`                      | `clasp open-script`                                         | เปิดโปรเจกต์ใน Apps Script Editor บนเบราว์เซอร์ (single-env)                                                                   |
| `npm run gas:open:staging`              | `clasp -P .clasp.staging.json open-script`                  | เปิดโปรเจกต์ Staging ใน Apps Script Editor                                                                                   |
| `npm run gas:open:prod`                 | `clasp -P .clasp.prod.json open-script`                     | เปิดโปรเจกต์ Production ใน Apps Script Editor                                                                                |
| `npm run gas:deploy`                    | `npm run build && clasp push && clasp create-deployment`    | Build, push และสร้าง Web App deployment ใหม่ (single-env)                                                                    |
| `npm run gas:deploy:staging`            | `node scripts/gas-deploy.mjs --env staging --action deploy` | Guarded immutable versioned deploy ขึ้น Staging (`push` → `create-version` → `update-deployment` ด้วย `clasp -P`)             |
| `npm run gas:deploy:prod`               | `node scripts/gas-deploy.mjs --env prod --action deploy`    | Guarded immutable versioned deploy ขึ้น Production (บังคับ distinct IDs, clean Git, SemVer `--version`, block CI และยืนยันชัดเจน) |

---

## CI, Dependency Updates & Vulnerability Triage Policy

### 1. Offline CI Merge Gates (`.github/workflows/ci.yml`, ADR-0005 & ADR-0006)

- **Triggers & Safety:** รันอัตโนมัติบน `push` ไปยัง `main` และทุก `pull_request` โดยจำกัดสิทธิ์ไว้ที่ `permissions: contents: read`, ยกเลิกรันเก่าที่ซ้ำซ้อนเฉพาะใน `pull_request` (ไม่ยกเลิกรันบน `main`) และตรึง runtime ที่ **Node.js 26 Active LTS + npm 11** จาก `.nvmrc`
- **Two Required Merge-Gate Jobs (100% Offline, Zero GAS Secrets):**
  1. `quality`: รัน `npm ci`, `npm run check` (รวม `typecheck`, `lint`, `format:check`, `test` และ `agents:check`), `VITE_GAS_API_URL=/api/gas npm run build`, `npm run verify:gas-bundle` แล้ว upload production bundle เป็น artifact `frontend-dist`
  2. `e2e` (`needs: quality`): รัน `npm ci`, download artifact `frontend-dist`, cache และติดตั้ง Chromium (`~/.cache/ms-playwright`) แล้วรัน `PLAYWRIGHT_SKIP_BUILD=1 npm run test:e2e` เพื่อตรวจ E2E, responsive และ WCAG 2.2 AA Axe กับ production bundle จริงโดยไม่ build ซ้ำและไม่เรียก live GAS
- **Branch Protection & GitHub Flow:** ตั้งค่า Branch Protection บน `main` ให้บังคับผ่านทั้ง status checks `quality` และ `e2e` ก่อน merge และจำไว้ว่า **การ merge เข้า `main` จะไม่ auto-deploy ขึ้น Production** (ADR-0006)
- **PR & Issue Templates:** `.github/pull_request_template.md` ครอบคลุมสรุปงาน, ลิงก์ GitHub Issue (`Closes #` / `Part of #`), Verification และ Security/Schema Checklist ส่วน `.github/ISSUE_TEMPLATE/` (`bug_report.md`, `feature_request.md`, `config.yml` พร้อม `blank_issues_enabled: true`) ช่วยเปิด issue แบบติดป้าย `needs-triage` โดยไม่ซ้ำซ้อนกับเทมเพลตของ `/to-spec` และ `/to-tickets`

### 2. Dependabot & Vulnerability Triage Policy (ADR-0005)

- **Grouped Weekly Updates (`.github/dependabot.yml`):**
  - **npm (`directory: "/"` ครอบคลุม root + workspaces):** จัดกลุ่มรายสัปดาห์แยก `production-minor-patch` ออกจาก `development-minor-patch` ส่วน major updates แยกเป็น PR เดี่ยวเพื่อตรวจ breaking changes อย่างรอบคอบ
  - **GitHub Actions (`github-actions`):** จัดกลุ่มอัปเดตรายสัปดาห์เพื่อให้ action versions ทันสมัยอยู่เสมอ
- **Repository Security Settings (ต้องเปิดใช้งานใน GitHub หลังสร้างโปรเจกต์):**
  - เปิด **Dependabot alerts** และ **Dependabot security updates** ใน **Settings → Code security** (หรือ **Security & analysis**) ของ Repository
- **ทำไมจึงไม่ใช้ `npm audit` เป็น Hard Blocker ใน CI:** ตาม ADR-0005 การตั้ง `npm audit` ให้ fail CI โดยตรงมักทำให้ PR ที่ถูกต้องถูกบล็อกจาก transitive `devDependencies` ที่ยังไม่มี upstream patch ระบบจึงใช้ **Dependabot Alerts + Dependabot Security Updates + การคัดกรอง (Triage)** แทน:
  - **Critical / High (Production dependencies):** คัดกรองและอัปเดต/แก้ทันทีภายใน **48 ชั่วโมง** (ทดสอบด้วย `npm run verify` และปล่อย release ตามขั้นตอน)
  - **Critical / High (Development / CI tooling only):** ประเมินความเสี่ยงจริงภายใน **7 วัน** และอัปเดตผ่าน Dependabot PR หรืออัปเกรดตรงหากกระทบสภาพแวดล้อมพัฒนา/CI
  - **Moderate / Low:** รวบรวมจัดการในรอบบำรุงรักษารายสัปดาห์ผ่าน grouped Dependabot PRs หากยังไม่มี upstream patch ให้เปิด GitHub Issue บันทึกขอบเขตผลกระทบและแผนติดตาม

---

## Security & Gitignore Guardrails

ไฟล์ความลับและไฟล์ทำงานเฉพาะเครื่องต่อไปนี้ถูกดักใน `.gitignore` และห้าม commit ขึ้น Git โดยเด็ดขาด:

- `.env*` (ยกเว้น `.env.example` เช่น `frontend/.env.example`, `backend/.env.example`)
- `.clasp*.json` และ `.clasprc.json` (track เฉพาะ `backend/.clasp.json.example`)
- `.scratch/` (local scratchpad เฉพาะเครื่อง — Specs และ Tickets หลักใช้ GitHub Issues ตาม `docs/agents/issue-tracker.md`)
- `.claude/skills` (local skills adapter สำหรับ Claude Code ที่สร้างจาก `npm run agents:setup -- --agent claude`)
- `.playwright-cli/`, `playwright-report/`, `test-results/` (snapshots, reports และ artifacts จาก Playwright)
- `node_modules/`, `dist/`, `build/`
