# Two-workspace monorepo with zero-dependency core validators and optional Zod

Status: accepted

Keep the starter repository as a two-workspace monorepo (`frontend/` and `backend/`) without a shared contracts package, using zero-dependency strict TypeScript validators verified by cross-workspace API contract tests, while placing Zod v4 (`zod/mini` with `jitless: true` for GAS V8) in the Optional capability tier.

## Considered Options

- **Two workspaces + zero-dependency strict validators + contract tests; Zod Optional (Selected):** Keeps `backend/dist/Code.js` minimal for fast Google Apps Script V8 cold starts, avoids forcing `zod/mini` functional syntax on simple projects, and prevents DTO drift via automated contract tests.
- **Two workspaces + `zod/mini` in Core:** Adds runtime validation ergonomics upfront, but increases GAS bundle size and introduces `zod/mini` + `jitless: true` constraints to every starter project regardless of schema complexity.
- **Three workspaces (`packages/contracts`) + `zod/mini` in Core:** Eliminates DTO duplication, but introduces an extra workspace/build boundary that violates the template's lean, no-speculative-abstraction baseline.

## Consequences

- Small API DTO types remain intentionally duplicated between `frontend/` and `backend/` and must be protected by cross-workspace API contract tests.
- Downstream projects with complex forms or payloads may adopt Zod v4 as an Optional capability, using `zod/mini` and `config({ jitless: true })` in GAS backend code to minimize esbuild bundle size and avoid `new Function()` JIT debugger limitations in the Apps Script IDE.
