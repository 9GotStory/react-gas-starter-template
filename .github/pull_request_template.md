## Summary

<!-- Briefly describe what changed and why. -->

-

## Linked Issue

<!-- Use `Closes #<number>` for standalone issues or `Part of #<number>` for sub-tickets. -->

Closes #

## Verification

- [ ] `npm run verify` passes locally offline (`check` including `agents:check`, `build`, `verify:gas-bundle`, `test:e2e`)
- [ ] `/code-review` completed against `CODING_STANDARDS.md` and the linked issue/spec
- [ ] Both required CI merge gates (`quality` and `e2e`) are green (merging to `main` never auto-deploys Production)

## Security & Schema Checklist

- [ ] No secrets, `.env*`, `.clasp*.json`, `.clasprc.json`, Spreadsheet IDs, or tokens are committed
- [ ] Backend changes (if any): explicit `SPREADSHEET_ID` (`CONFIG_MISSING`), read-only `doGet`, `LockService` + `SpreadsheetApp.flush()` + `finally` unlock, `@` plain-text formatting, and formula injection sanitization preserved
- [ ] Manifest / auth changes (if any): fail-closed defaults preserved or pre-deploy Security Review completed before `ANYONE_ANONYMOUS`
- [ ] Sheet schema changes (if any): Expand–Contract migration plan documented and `GLOSSARY.md` / ADRs updated
- [ ] UI changes (if any): explicit labels, visible focus, live regions, responsive checks, and manual keyboard/accessibility checks verified
