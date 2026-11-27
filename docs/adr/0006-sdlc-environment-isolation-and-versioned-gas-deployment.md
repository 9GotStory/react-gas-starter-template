# Solo-dev GitHub Flow, isolated Staging/Production environments, and versioned GAS deployment

Status: accepted

Adopt GitHub Flow with GitHub Issues and manual SemVer releases (`CHANGELOG.md`), isolate Development (offline mock), Staging (integration + UAT), and Production across separate clasp configs and spreadsheets using `clasp -P` immutable versioned deployments, and require explicit confirmation and release-candidate commit parity before Production promotion.

## Considered Options

- **GitHub Flow + `clasp -P` file-isolated environments + immutable versioned deployments + manual Production promotion (Selected):** Eliminates manual `.clasp.json` swapping, guarantees Merge does not auto-deploy to Production, enables instant version rollback without changing `/exec` URLs, and avoids storing Google OAuth credentials in GitHub Actions.
- **Single `.clasp.json` with manual swapping or CI-driven auto-deploy to Production:** High risk of deploying to the wrong environment or exposing Google OAuth credentials in CI secrets while adding unnecessary deployment infrastructure for a solo developer.

## Consequences

- Merging to `main` never auto-deploys Production; Production deployments must promote the exact same Git commit/Release Candidate that passed CI and Staging/UAT with an explicit SemVer version.
- If `main` contains unreleased features, urgent Production hotfixes branch from the latest Production release tag, release as a patch tag, and merge back into `main`.
- Pre-deployment safety checks verify that `scriptId`, `deploymentId`, and `SPREADSHEET_ID` are strictly distinct between Staging and Production; `.gitignore` ignores `.clasp*.json` (except `.clasp.json.example`).
- Code rollback (`clasp update-deployment -V <previousVersion>` + frontend tag rollback) never automatically restores the Google Sheet; any spreadsheet restore requires explicit impact assessment and confirmation to avoid losing post-backup user data.
- Live Google Sheet schema changes must follow the Expand–Contract migration pattern with a pre-deploy Production snapshot backup documented in `docs/runbooks/deployment-and-operations.md`.
