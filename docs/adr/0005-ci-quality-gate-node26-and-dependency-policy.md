# Node 26 LTS + npm 11 pinning, dual-job CI gate, and Dependabot security policy

Status: accepted

Standardize runtime tooling strictly on Node.js 26 Active LTS and npm 11 across `.nvmrc`, `engines`, `packageManager`, and GitHub Actions CI, enforce both `quality` and `e2e` CI jobs as merge gates into `main`, and manage dependency vulnerabilities via Dependabot Alerts, Security Updates, and grouped weekly PRs instead of a brittle `npm audit` CI blocker.

## Considered Options

- **Strict Node 26 LTS + npm 11 pinning + required `quality` & `e2e` CI jobs + Dependabot Alerts/Security Updates (Selected):** Ensures documented runtime support matches what is actually tested in CI, prevents unverified code or broken production bundles from merging into `main`, and avoids flaky CI outages from unpatchable transitive devDependency advisories while maintaining clear vulnerability triage.
- **Broad `engines` range (`>=24`) without CI matrix + `npm audit` CI hard fail:** Claims untested runtime compatibility and risks blocking legitimate PRs on non-actionable transitive devDependency advisories.

## Consequences

- `.nvmrc`, `package.json` (`engines` and `packageManager`), and `.github/workflows/ci.yml` must remain synchronized on Node 26 LTS and npm 11.
- The `e2e` CI job must depend on the `quality` build artifact (or explicitly build `frontend/dist/`) before running Playwright against `vite preview`; both jobs must pass before merging to `main`.
- Repository settings must enable Dependabot Alerts and Dependabot Security Updates alongside `.github/dependabot.yml` grouped updates, supported by a documented vulnerability triage policy.
- `backend/eslint.config.js` separates Node.js globals (`build.mjs`) from GAS runtime source files (`src/**/*.ts`).
