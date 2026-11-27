# Multi-agent single source of truth with non-destructive local adapters

Status: accepted

Maintain `AGENTS.md` and `.agents/skills/` as the single canonical source of truth across Antigravity, Claude Code, and OpenAI Codex CLI, bridge Claude Code via a cross-platform `CLAUDE.md` (`@AGENTS.md` import) and a gitignored `.claude/skills` adapter generated non-destructively by `agents:setup`, keep MCP definitions synchronized between `.mcp.json` and `.codex/config.toml` without secrets, and enforce drift checks offline via `agents:check`.

## Considered Options

- **`AGENTS.md` + `@AGENTS.md` import + `.agents/skills/` SSOT + gitignored local `.claude/skills` adapter + 3 separated scripts (Selected):** Works identically across Windows, Linux, and macOS without broken Git POSIX symlinks, avoids duplicating skill files in Git, never forces installing all three agents, and enables offline CI drift detection.
- **Commit `.claude/skills -> ../.agents/skills` and `CLAUDE.md -> AGENTS.md` symlinks in Git:** Zero setup on POSIX systems, but produces broken text files on Windows environments without `core.symlinks` / Developer Mode enabled.

## Consequences

- `AGENTS.md` is the only edited instruction file; `CLAUDE.md` remains a plain text adapter containing `@AGENTS.md`.
- `npm run agents:setup` is offline, idempotent, opt-in per agent, and strictly non-destructive (never overwrites or deletes existing user skills/configs without explicit permission).
- `npm run skills:sync` pins explicit versions/commit hashes for every tracked skill in a manifest/lockfile and never auto-upgrades to floating `latest` versions.
- `npm run agents:check` runs fully offline inside `npm run check` and CI without requiring any AI agent binaries, credentials, or internet access; passing `agents:check` serves as an automated drift gate only and does not replace real verification of skills discovery, instruction loading, and context continuity across Antigravity, Claude Code, and Codex.
- Antigravity MCP configuration (`~/.gemini/config/mcp_config.json`) is documented and guided without silently mutating user home-directory configs.
