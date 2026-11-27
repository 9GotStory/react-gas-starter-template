# Offline testing pyramid, shared mock fixtures, and WCAG 2.2 AA baseline

Status: accepted

Adopt a lightweight offline testing pyramid using Vitest (unit, component, backend integration with in-memory GAS doubles, and cross-workspace API contract tests), a dev-only Vite mock middleware, and Playwright `@playwright/test` E2E tests against `vite preview` (`frontend/dist/`) with shared plain test fixtures and WCAG 2.2 AA as the accessibility baseline.

## Considered Options

- **Vitest + dev-only Vite middleware + Playwright `@playwright/test` (`page.route()`) with shared plain fixtures (Selected):** Keeps the base template lean without adding a mock framework or service worker assets, verifies the real production frontend bundle in E2E, prevents frontend/backend DTO drift via in-memory contract tests, and reduces mock data drift via shared fixtures.
- **MSW (Mock Service Worker) across Vitest, dev server, and Playwright:** Provides a single interception layer, but adds dependency/service-worker overhead disproportionate to a minimal GAS starter template.

## Consequences

- `CODING_STANDARDS.md` `[TEST-3]` will be updated to separate automated regression E2E (`@playwright/test`, Core) from interactive Browser QA (`playwright-cli` or Playwright MCP, choosing one per session).
- Automated `@axe-core/playwright` scans in E2E serve as a minimum automated gate under WCAG 2.2 AA; passing Axe alone is never treated as full WCAG 2.2 AA compliance (manual keyboard, focus, and semantic checks remain required).
- The Vite dev mock middleware must remain strictly dev-only and never be bundled into `frontend/dist/`.
