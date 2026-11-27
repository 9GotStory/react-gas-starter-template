# react-gas-starter-template

GitHub Base Template Repository แบบ Monorepo สำหรับสร้างเว็บแอปด้วย **React (Vite + TypeScript + Tailwind CSS + TanStack Query)** คู่กับ **Google Apps Script (GAS) Web App + Google Sheets** ที่เขียนด้วย TypeScript, bundle ด้วย **esbuild** และ deploy ผ่าน **`@google/clasp` v3** พร้อมวางระบบเอกสารและสกิลสำหรับ AI-Assisted Development ครบชุด

> **หมายเหตุ (Base Template Scope):** Repository นี้เป็น **Base Template ที่ยังไม่ได้เชื่อมต่อ Google Apps Script หรือ Google Sheets จริง** การตรวจสอบตัว Template ให้ทำแบบ **Offline Verification เท่านั้น** (`npm ci` และ `npm run verify` ซึ่งรัน `check`, `build`, `verify:gas-bundle` และ Playwright E2E พร้อม dev-only Mock API) — AI Agent ต้องไม่สร้าง GAS Project, ผูก Google Sheets, รัน `clasp push`/`deploy` หรือร้องขอ Credentials เพื่อทดสอบ Base Template นี้

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
  - **Automated Playwright E2E & Accessibility (`npm run test:e2e`, Core — ADR-0004):** รัน `@playwright/test` + `@axe-core/playwright` แบบ offline กับ production bundle จริง (`frontend/dist/`) ผ่าน `vite preview` โดย intercept เฉพาะ HTTP boundary (`page.route()`) ด้วย shared plain `Item` fixtures (`tests/fixtures/items.ts`) เพื่อทดสอบ list/create, การคงเลขศูนย์นำหน้า (`00123`), client/server validation, HTTP 200 HTML (`NON_JSON_RESPONSE`), responsive desktop/mobile, การไม่หลุดของ dev mock middleware ใน production bundle และการสแกน WCAG 2.2 AA ด้วย Axe _(หมายเหตุ: ผลผ่านจาก Axe เป็น minimum automated gate เท่านั้น ไม่เท่ากับการผ่าน WCAG 2.2 AA ครบถ้วน ยังต้องตรวจ keyboard/focus/semantic ด้วยมือเพิ่มเติม)_
  - **Interactive Browser QA ด้วย Playwright CLI / MCP (แยกจาก Automated E2E):** ใช้ `npx playwright-cli` (ประหยัด token) หรือ **Playwright MCP** ใน `.mcp.json` เลือกใช้อย่างใดอย่างหนึ่งต่อ session (ไม่ใช้พร้อมกัน)
    - **ใน Base Template (Offline):** ใช้ Dev-Only Mock API (`npm run dev`) ทดสอบ UI, Responsive และ manual WCAG 2.2 AA keyboard/focus interactions โดยไม่ต้องเชื่อมต่อ GAS จริง
    - **ในโปรเจกต์ที่เชื่อมต่อ GAS จริงแล้วเท่านั้น:** ทดสอบ CORS, HTTP `302` redirect ไป `script.googleusercontent.com` และการอ่าน JSON Response ผ่าน Browser จริงก่อนสรุปว่าใช้งานได้
  - การันตีพฤติกรรม GAS runtime ตามเอกสารทางการ: บังคับอ่าน `SPREADSHEET_ID` จาก Script Properties โดยไม่ fallback ไป `getActiveSpreadsheet()` (`CONFIG_MISSING`, ADR-0002), `doGet` เป็น read-only ล้วน (คืน `[]` เมื่อยังไม่มีชีต/ข้อมูล และคืน `SCHEMA_ERROR` เมื่อ header ผิด), ใช้ Batch Read/Write และล็อกการสร้างชีต/เขียนพร้อมกันใน `doPost` ด้วย `LockService.getScriptLock().tryLock()` + `SpreadsheetApp.flush()` + ปลดล็อกใน `finally` เสมอ, คงทุกคอลัมน์ข้อความของ `Item` (`id`, `code`, `name`, `createdAt`) ด้วย `.setNumberFormat("@")` ก่อน `.setValues()` พร้อมกรองแถวว่างและแปลง `Date` เป็น ISO-8601 ตอนอ่าน, ตรวจชนิด string/ความยาว/ขนาด payload และกัน Formula Injection (`=`, `+`, `-`, `@`, `\t`, `\r`), บันทึก log แบบ Structured JSON ผ่าน `console` โดยไม่หลุด secrets/PII/Spreadsheet ID และคืน canonical error envelope (`CONFIG_MISSING`, `SCHEMA_ERROR`, `INVALID_JSON`, `INVALID_ACTION`, `VALIDATION_ERROR`, `LOCK_TIMEOUT`, `INTERNAL_ERROR` แบบ generic message) เพราะ `ContentService` ตั้ง HTTP status code หรือ custom response headers เองไม่ได้ และคำนึงถึง [GAS Quotas](https://developers.google.com/apps-script/guides/services/quotas) (6 นาที/execution, 30 concurrent/user, 1,000/script) โดยไม่สร้างระบบจัดการโควตาซับซ้อนล่วงหน้า
- **AI Tooling & Docs (Multi-Agent SSOT — Antigravity, Claude Code, Codex CLI, ADR-0007):**
  - `AGENTS.md` เป็น Single Source of Truth สำหรับคำสั่งโครงการแบบ Read on Demand, `CLAUDE.md` เป็นไฟล์ข้อความธรรมดาที่มีเฉพาะ `@AGENTS.md` (ไม่ใช้ POSIX symlink เพื่อให้ใช้งานเหมือนกันทั้ง Windows, Linux และ macOS), `CODING_STANDARDS.md` (แบ่ง Capabilities เป็น Core / Optional / Project-Specific), `GLOSSARY.md`, `docs/adr/`
  - `.mcp.json` (Claude Code) และ `.codex/config.toml` (OpenAI Codex CLI) กำหนด **Context7 MCP** (`@upstash/context7-mcp`) และ **Playwright MCP** (`@playwright/mcp@latest`) ตรงกันทุกตัวแบบ **zero secrets** ส่วน **Antigravity** (`~/.gemini/config/mcp_config.json`) มีคู่มือและ snippet ให้ตั้งค่าด้วยตนเองโดยไม่แก้ไฟล์ใน home directory อัตโนมัติ
  - `.agents/skills/` เป็นโฟลเดอร์สกิลกลางเพียงจุดเดียวที่ commit ใน Git ติดตั้งเฉพาะชุด **Canonical Shared Skills 15 ตัว** ที่ตรึงเวอร์ชัน/commit hash ชัดเจนใน `skills-lock.json` (ไม่ auto-upgrade เป็น `latest` และไม่ผูกกับเอเจนต์ใดเอเจนต์หนึ่ง): **Matt Pocock Workflow 12 ตัว**, **UI/UX Pro Max** (ออกแบบ Design System — `python3` จำเป็น**เฉพาะ**สำหรับสคริปต์ `search.py` ของสกิลนี้เท่านั้น ไม่จำเป็นสำหรับ Application Runtime, Build หรือ CI), **Vercel `web-design-guidelines`** (ตรวจสอบคุณภาพ UI และ Accessibility แบบ offline จาก ruleset ที่แนบมา) และ **Playwright CLI Skill** (`.agents/skills/playwright-cli/` สำหรับ Interactive Browser QA) ส่วน **Anthropic `frontend-design`** และ **Impeccable** ถูกจัดอยู่ในระดับ **Optional** (ไม่ได้ติดตั้งล่วงหน้าใน Base Template) เพื่อไม่ให้บทบาทซ้ำซ้อนกัน
  - `.claude/skills` ถูก gitignore ไว้และสร้างเฉพาะเครื่องเมื่อผู้ใช้ opt-in ผ่าน `npm run agents:setup -- --agent claude` (offline, idempotent, non-destructive ไม่ทับโฟลเดอร์/คอนฟิกเดิมของผู้ใช้) และตรวจ drift แบบ offline ใน `npm run check` ด้วย `npm run agents:check` โดยไม่ต้องติดตั้ง binary ของ AI agent, credentials หรืออินเทอร์เน็ต

---

## โครงสร้างโปรเจกต์

```text
.
├── AGENTS.md                        # คู่มือหลักแบบ Read on Demand สำหรับ AI Agent (SSOT)
├── CLAUDE.md                        # ไฟล์ข้อความธรรมดา (@AGENTS.md) รองรับ Windows/Linux/macOS ไม่ใช้ POSIX symlink
├── CODING_STANDARDS.md              # กฎสถาปัตยกรรม FE/GAS ความปลอดภัย การเทส และข้อยกเว้น
├── GLOSSARY.md                      # โครงเปล่าสำหรับคำศัพท์โดเมนและ Sheet-to-entity mapping
├── .mcp.json                        # การตั้งค่า Context7 MCP + Playwright MCP สำหรับ Claude Code (zero secrets)
├── .codex/
│   └── config.toml                  # การตั้งค่า Context7 MCP + Playwright MCP สำหรับ Codex CLI (parity กับ .mcp.json)
├── .gitignore                       # ดัก .env*, .clasp.json, .clasprc.json, .scratch/, .claude/skills, .playwright-cli/, dist/
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
│   └── agents-check.test.mjs        # Offline tests ตรวจ instruction drift, skills pin/frontmatter, MCP parity และ secret leakage
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
│   └── adr/
│       └── 0000-template.md         # เทมเพลต ADR พร้อมเกณฑ์กรอง 3 ข้อ
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
    ├── .clasp.json.example          # ตัวอย่าง clasp config (srcDir: "dist")
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
5. Deploy Web App ครั้งแรก (`gas:deploy` จะรัน `build && clasp push && clasp create-deployment` ให้อัตโนมัติ):
   ```bash
   npm run gas:deploy
   ```
   - หากแก้ไขโค้ดภายหลังและต้องการ **อัปเดต Deployment เดิมโดยไม่เปลี่ยน `/exec` URL** ให้ push โค้ดแล้วอัปเดตด้วย `deploymentId` เดิม:
     ```bash
     npm run gas:push
     npx --workspace=backend clasp list-deployments
     npx --workspace=backend clasp update-deployment <deploymentId>
     ```
6. เปิด Apps Script Editor เพื่อตรวจสอบสิทธิ์ Deployment, **ตั้งค่า `SPREADSHEET_ID` ใน Project Settings → Script Properties (บังคับสำหรับทุก Deployment ตาม ADR-0002 — ไม่มี `getActiveSpreadsheet()` fallback และจะคืน `CONFIG_MISSING` หากไม่ตั้งค่า)** และคัดลอก Web App `/exec` URL ไปใส่ใน `frontend/.env` (`VITE_GAS_API_URL`):
   ```bash
   npm run gas:open
   ```
   > **นโยบายความปลอดภัยเริ่มต้นของ Web App Manifest และ CORS (`backend/appsscript.json`, ADR-0003):** ค่าเริ่มต้นของ Template ตั้งเป็น **fail-closed** (`executeAs: "USER_DEPLOYING"`, `access: "MYSELF"`) พร้อมระบุ OAuth scope แบบ least-privilege (`oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"]`) เพื่อป้องกันการเปิดเผย Google Sheet สู่สาธารณะโดยไม่ตั้งใจ หากโปรเจกต์ปลายทางจำเป็นต้องเปลี่ยนเป็น `access: "ANYONE_ANONYMOUS"` เพื่อให้ Cross-Origin React SPA เรียกได้โดยไม่ติดหน้า Google Sign-In HTML **ต้องผ่าน Security Review ก่อน deploy และต้องตรวจสอบ Token ฝั่ง Backend จริง (signature, `iss`, `aud`, `exp`) พร้อมเช็กสิทธิ์ก่อนอ่าน/เขียน Sheet** โดยส่ง Token ใน `POST` body เท่านั้น (ห้ามส่งใน URL query parameters หรือฝัง secret ใน `VITE_*`) และยังคงต้องทดสอบยืนยัน CORS, HTTP `302` redirect ไป `script.googleusercontent.com` และการอ่าน JSON Response จาก Deployment จริงใน Browser ด้วย Playwright CLI/MCP ก่อนสรุปว่าใช้งานได้ ทุกครั้งที่แก้โค้ดหรือแก้ OAuth scopes ต้องอัปเดต Deployment จึงจะมีผลกับ `/exec` URL ([Google Web Apps Docs](https://developers.google.com/apps-script/guides/web) · [ContentService Docs](https://developers.google.com/apps-script/guides/content))
7. รันหน้าเว็บทดสอบในเครื่อง:
   ```bash
   npm run dev
   ```

### ขั้นที่ 3: ตั้งค่าสกิลสำหรับ AI Agent (ทำครั้งเดียวต่อโปรเจกต์ — Antigravity / Claude Code / Codex CLI)

เปิด **แชทใหม่** ใน Antigravity, Claude Code หรือ Codex CLI (ใช้ `.agents/skills/` และ `AGENTS.md` ชุดเดียวกัน) แล้วรันคำสั่ง:

```text
/setup-matt-pocock-skills
```

เพื่อผูกการทำงานของชุดสกิล Matt Pocock เข้ากับ Issue Tracker (ค่าเริ่มต้นของ Template นี้ตั้งค่าไว้ที่ GitHub Issues ใน `docs/agents/issue-tracker.md` หรือปรับใช้ `.scratch/` สำหรับงาน local ตามต้องการ)

---

## เวิร์กโฟลว์ตั้งแต่เปิดโปรเจกต์จนจบฟีเจอร์ (7 ขั้นตอน)

### ภาพรวม 7 ขั้นตอนและการจัดการแชท/Context

|  ขั้น   | เป้าหมาย                            | คำสั่ง / สกิล                                                   | การจัดการแชท / Context                              |
| :---: | ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| **1** | ติดตั้ง & ผูก GAS ด้วย `clasp`          | `npm install`, `gas:login`, `npm run check && npm run build` | **Terminal**                                       |
| **2** | ผูกชุดสกิลกับ `.scratch/`              | `/setup-matt-pocock-skills`                                  | **แชทใหม่ (ทำครั้งเดียวต่อโปรเจกต์)**                    |
| **3** | ตกลงขอบเขต, คำศัพท์ และ Sheet Schema | `/grill-with-docs`                                           | **แชท A (ปิด Plan Mode)**                           |
| **4** | ออกแบบ UI & สร้าง Design System     | `/ui-ux-pro-max`                                             | **แชท B (แยกแชทใหม่)**                              |
| **5** | แปลงเป็น Spec และแตก Tickets        | `/to-spec` → `/to-tickets`                                   | **กลับไปแชท A** _(แนะนำ commit เอกสารก่อนโค้ด)_       |
| **6** | ลงมือพัฒนาโค้ด + เทสทีละงาน            | `/implement`                                                 | **แชทใหม่ทุก Ticket (ทีละ 1 Ticket)**                 |
| **7** | รีวิวมาตรฐาน & สเปกก่อนปิดงาน          | `/code-review` + `npm run check && npm run build`            | **แชทใหม่หรือท้าย Ticket (commit/WIP commit ก่อนรีวิว)** |

### ตัวอย่าง Prompt พร้อมก๊อปในแต่ละขั้น

#### ขั้นที่ 3 — `/grill-with-docs` (แชท A — ปิด Plan Mode)

```text
/grill-with-docs
ช่วยซักถามเพื่อวางขอบเขตระบบ [ชื่อระบบ/ฟีเจอร์] ที่เชื่อมต่อ Google Sheets
- อัปเดตคำศัพท์และ Sheet-to-entity mapping ลง GLOSSARY.md
- หากมีการตัดสินใจทางสถาปัตยกรรมที่เข้าเกณฑ์ 3 ข้อ ให้บันทึก ADR ใน docs/adr/
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
สรุปข้อตกลงทั้งหมดจากแชทนี้ร่วมกับ GLOSSARY.md และ design-system/ เป็น Spec ไว้ใน .scratch/
```

เมื่อตรวจ Spec เรียบร้อยแล้ว ให้รันต่อในแชท A:

```text
/to-tickets
แตก Spec ล่าสุดใน .scratch/ ออกเป็น Tickets ย่อยที่จบได้ใน 1 แชทต่อ 1 Ticket
```

> **แนะนำ:** ก่อนเริ่มลงมือเขียนโค้ด ให้ `git commit` เอกสารตั้งต้น (`GLOSSARY.md`, `docs/adr/`, `design-system/`) เก็บไว้ก่อน เพื่อให้ `git diff` ตอน `/code-review` สะอาดและเห็นเฉพาะโค้ดของฟีเจอร์

#### ขั้นที่ 6 — `/implement` (แชทใหม่ — ทีละ 1 Ticket)

```text
/implement
ทำเฉพาะ Ticket [ชื่อไฟล์หรือหมายเลข Ticket ใน .scratch/]
อ้างอิง CODING_STANDARDS.md, GLOSSARY.md และ design-system/ อย่างเคร่งครัด และรัน npm run check && npm run build ให้ผ่าน
```

#### ขั้นที่ 7 — `/code-review` (commit ก่อนรีวิว)

1. ทำ commit (หรือ WIP commit) ก่อน เพื่อให้ `/code-review` ตรวจจาก `git diff` ได้แม่นยำ:
   ```bash
   git add . && git commit -m "wip: implement <ticket-name>"
   ```
2. รันสกิลรีวิว 2 แกน (Standards เทียบ `CODING_STANDARDS.md` และ Spec เทียบ `.scratch/`):
   ```text
   /code-review
   รีวิวการเปลี่ยนแปลงเทียบกับ CODING_STANDARDS.md และ Spec/Ticket ใน .scratch/
   ```
3. หลังแก้ครบทุกคอมเมนต์ ให้ปิดท้ายด้วย:
   ```bash
   npm run check && npm run build
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

| คำสั่งจาก Root                            | คำสั่งจริงใน `backend/package.json`                         | คำอธิบาย                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm --workspace=backend run build`     | `tsc --noEmit && node build.mjs`                         | Typecheck และ bundle `src/main.ts` → `dist/Code.js` + คัดลอก `dist/appsscript.json`                                      |
| `npm --workspace=backend run typecheck` | `tsc --noEmit`                                           | ตรวจ TypeScript ฝั่ง backend พร้อม `@types/google-apps-script`                                                             |
| `npm --workspace=backend run lint`      | `eslint .`                                               | รัน ESLint แยกขอบเขต GAS runtime (`src/**/*.ts`) และ Node.js scripts (`*.mjs`)                                           |
| `npm --workspace=backend run test`      | `vitest run`                                             | รัน offline tests ใน `backend/` (pure logic, `doGet`/`doPost` integration, logger, ESLint boundary, GAS bundle verifier) |
| `npm run verify:gas-bundle`             | `node verify-gas-bundle.mjs`                             | ตรวจ `backend/dist/` แบบ offline (ไฟล์, global `doGet`/`doPost`, manifest, size budget)                                  |
| `npm run gas:login`                     | `clasp login`                                            | ล็อกอินบัญชี Google สำหรับ `@google/clasp`                                                                                   |
| `npm run gas:status`                    | `clasp show-file-status`                                 | แสดงรายการไฟล์ใน `dist/` ที่ `clasp` track สำหรับการ push                                                                   |
| `npm run gas:push`                      | `npm run build && clasp push`                            | Build `backend/dist/` แล้วอัปโหลดขึ้น Google Apps Script                                                                    |
| `npm run gas:pull`                      | `clasp pull`                                             | ดึงไฟล์ล่าสุดจาก Google Apps Script                                                                                         |
| `npm run gas:open`                      | `clasp open-script`                                      | เปิดโปรเจกต์ใน Apps Script Editor บนเบราว์เซอร์                                                                             |
| `npm run gas:deploy`                    | `npm run build && clasp push && clasp create-deployment` | Build, push และสร้าง Web App deployment ใหม่                                                                              |

---

## Security & Gitignore Guardrails

ไฟล์ความลับและไฟล์ทำงานเฉพาะเครื่องต่อไปนี้ถูกดักใน `.gitignore` และห้าม commit ขึ้น Git โดยเด็ดขาด:

- `.env*` (ยกเว้น `.env.example`)
- `.clasp.json` และ `.clasprc.json` (track เฉพาะ `backend/.clasp.json.example`)
- `.scratch/` (ที่พัก Specs และ Tickets แบบ local)
- `.claude/skills` (local skills adapter สำหรับ Claude Code ที่สร้างจาก `npm run agents:setup -- --agent claude`)
- `.playwright-cli/`, `playwright-report/`, `test-results/` (snapshots, reports และ artifacts จาก Playwright)
- `node_modules/`, `dist/`, `build/`
