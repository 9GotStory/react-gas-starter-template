import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT_DIR = resolve(scriptsDir, '..');
export const CANONICAL_SKILLS_REL = '.agents/skills';
export const CLAUDE_SKILLS_REL = '.claude/skills';
export const SUPPORTED_AGENTS = ['antigravity', 'claude', 'codex'];

export function inspectClaudeSkillsAdapter(rootDir = DEFAULT_ROOT_DIR) {
  const canonicalPath = join(rootDir, CANONICAL_SKILLS_REL);
  const linkPath = join(rootDir, CLAUDE_SKILLS_REL);

  const canonicalExists = existsSync(canonicalPath) && statSync(canonicalPath).isDirectory();
  if (!canonicalExists) {
    return { status: 'missing-canonical', path: linkPath, canonicalPath };
  }

  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      if (err.code === 'ENOENT') {
        return { status: 'missing', path: linkPath, canonicalPath };
      }
      if (err.code === 'ENOTDIR') {
        return {
          status: 'non-managed',
          path: dirname(linkPath),
          canonicalPath,
          entryType: 'file at ".claude" blocking ".claude/skills"',
        };
      }
    }
    throw err;
  }

  if (!stat.isSymbolicLink()) {
    return {
      status: 'non-managed',
      path: linkPath,
      canonicalPath,
      entryType: stat.isDirectory() ? 'directory' : 'file',
    };
  }

  const rawTarget = readlinkSync(linkPath);
  try {
    const resolvedTarget = realpathSync(linkPath);
    const resolvedCanonical = realpathSync(canonicalPath);
    if (resolvedTarget === resolvedCanonical) {
      return {
        status: 'valid-link',
        path: linkPath,
        canonicalPath,
        rawTarget,
        resolvedTarget,
      };
    }
    return {
      status: 'wrong-link',
      path: linkPath,
      canonicalPath,
      rawTarget,
      resolvedTarget,
    };
  } catch {
    return {
      status: 'wrong-link',
      path: linkPath,
      canonicalPath,
      rawTarget,
      resolvedTarget: null,
    };
  }
}

function setupClaude({ rootDir, dryRun, platform, actions, errors, notes }) {
  const inspection = inspectClaudeSkillsAdapter(rootDir);

  if (inspection.status === 'missing-canonical') {
    errors.push(
      `Cannot configure Claude Code: canonical skills directory "${CANONICAL_SKILLS_REL}" does not exist.`,
    );
    return;
  }

  if (inspection.status === 'non-managed') {
    errors.push(
      `Refusing to overwrite existing non-managed ${inspection.entryType} at "${CLAUDE_SKILLS_REL}". Back up or remove it manually before re-running agents:setup.`,
    );
    return;
  }

  if (inspection.status === 'wrong-link') {
    errors.push(
      `Refusing to overwrite existing symlink at "${CLAUDE_SKILLS_REL}" pointing to "${inspection.rawTarget}" instead of "${CANONICAL_SKILLS_REL}". Update or remove it manually before re-running agents:setup.`,
    );
    return;
  }

  if (inspection.status === 'valid-link') {
    actions.push({
      agent: 'claude',
      target: CLAUDE_SKILLS_REL,
      status: 'unchanged',
      message: `${CLAUDE_SKILLS_REL} already links to ${CANONICAL_SKILLS_REL}`,
    });
  } else {
    const isWindows = platform === 'win32';
    const linkType = isWindows ? 'junction' : 'dir';
    const linkTarget = isWindows ? inspection.canonicalPath : '../.agents/skills';

    if (dryRun) {
      actions.push({
        agent: 'claude',
        target: CLAUDE_SKILLS_REL,
        status: 'would-create',
        linkType,
        linkTarget,
        message: `Would link ${CLAUDE_SKILLS_REL} -> ${linkTarget} (${linkType})`,
      });
    } else {
      mkdirSync(dirname(inspection.path), { recursive: true });
      symlinkSync(linkTarget, inspection.path, linkType);
      actions.push({
        agent: 'claude',
        target: CLAUDE_SKILLS_REL,
        status: 'created',
        linkType,
        linkTarget,
        message: `Linked ${CLAUDE_SKILLS_REL} -> ${linkTarget} (${linkType})`,
      });
    }
  }

  const claudeMdPath = join(rootDir, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    notes.push('Preserved existing CLAUDE.md untouched (run npm run agents:check to verify).');
  } else {
    notes.push('CLAUDE.md was not found; expected a plain-text file containing "@AGENTS.md".');
  }

  const mcpPath = join(rootDir, '.mcp.json');
  if (existsSync(mcpPath)) {
    notes.push('Preserved existing .mcp.json untouched (run npm run agents:check to verify).');
  } else {
    notes.push('.mcp.json was not found; Claude Code project MCP servers are not configured.');
  }
}

function verifyCanonicalBase(rootDir, agentLabel, errors) {
  const canonicalPath = join(rootDir, CANONICAL_SKILLS_REL);
  if (!existsSync(canonicalPath) || !statSync(canonicalPath).isDirectory()) {
    errors.push(
      `Cannot configure ${agentLabel}: canonical skills directory "${CANONICAL_SKILLS_REL}" does not exist.`,
    );
    return false;
  }

  const agentsMdPath = join(rootDir, 'AGENTS.md');
  if (!existsSync(agentsMdPath)) {
    errors.push(`Cannot configure ${agentLabel}: "AGENTS.md" does not exist.`);
    return false;
  }

  return true;
}

function setupCodex({ rootDir, actions, errors, notes }) {
  if (!verifyCanonicalBase(rootDir, 'Codex CLI', errors)) {
    return;
  }

  const codexConfigPath = join(rootDir, '.codex/config.toml');
  if (!existsSync(codexConfigPath)) {
    errors.push('Cannot configure Codex CLI: project config ".codex/config.toml" does not exist.');
    return;
  }

  actions.push({
    agent: 'codex',
    target: '.codex/config.toml',
    status: 'unchanged',
    message:
      'Codex CLI natively discovers AGENTS.md, .agents/skills/, and .codex/config.toml (existing config preserved untouched).',
  });
  notes.push('No user home-directory ~/.codex/config.toml files were modified.');
}

function formatAntigravityMcpGuidance(rootDir) {
  const mcpPath = join(rootDir, '.mcp.json');
  let serversSnippet = JSON.stringify(
    {
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      },
    },
    null,
    2,
  );

  if (existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
        serversSnippet = JSON.stringify({ mcpServers: parsed.mcpServers }, null, 2);
      }
    } catch {
      // Fall back to default secret-free snippet when .mcp.json is unreadable
    }
  }

  return [
    'Antigravity MCP setup (manual — ~/.gemini/config/mcp_config.json is never modified automatically):',
    'Merge the following secret-free servers into ~/.gemini/config/mcp_config.json:',
    serversSnippet,
  ].join('\n');
}

function setupAntigravity({ rootDir, actions, errors, notes }) {
  if (!verifyCanonicalBase(rootDir, 'Antigravity', errors)) {
    return;
  }

  actions.push({
    agent: 'antigravity',
    target: '~/.gemini/config/mcp_config.json',
    status: 'guidance',
    message:
      'Antigravity natively discovers AGENTS.md and .agents/skills/; manual global MCP snippet printed without modifying ~/.gemini/config/mcp_config.json.',
  });
  notes.push(formatAntigravityMcpGuidance(rootDir));
}

export function setupAgents({
  rootDir = DEFAULT_ROOT_DIR,
  agents = [],
  dryRun = false,
  platform = process.platform,
} = {}) {
  const normalized = [
    ...new Set(agents.map((a) => String(a).trim().toLowerCase()).filter(Boolean)),
  ];
  const errors = [];
  const actions = [];
  const notes = [];

  if (normalized.length === 0) {
    return {
      ok: false,
      errors: [
        `No agents selected. Pass --agent <${SUPPORTED_AGENTS.join('|')}> (repeatable) or --agent all to opt in explicitly.`,
      ],
      actions,
      notes,
    };
  }

  const unknown = normalized.filter((a) => !SUPPORTED_AGENTS.includes(a));
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: [
        `Unsupported agent(s): ${unknown.join(', ')}. Supported: ${SUPPORTED_AGENTS.join(', ')}.`,
      ],
      actions,
      notes,
    };
  }

  for (const agent of normalized) {
    if (agent === 'claude') {
      setupClaude({ rootDir, dryRun, platform, actions, errors, notes });
    } else if (agent === 'codex') {
      setupCodex({ rootDir, actions, errors, notes });
    } else if (agent === 'antigravity') {
      setupAntigravity({ rootDir, actions, errors, notes });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    actions,
    notes,
  };
}

function parseCliArgs(argv) {
  let rootDir = DEFAULT_ROOT_DIR;
  let dryRun = false;
  let help = false;
  const agents = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --root');
      rootDir = resolve(next);
      i += 1;
    } else if (arg === '--agent') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --agent');
      const parts = next
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      for (const part of parts) {
        if (part === 'all') {
          agents.push(...SUPPORTED_AGENTS);
        } else {
          agents.push(part);
        }
      }
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { rootDir, dryRun, help, agents };
}

function printUsage() {
  console.log(
    [
      'Usage: npm run agents:setup -- --agent <claude|codex|antigravity|all> [--dry-run] [--root <dir>]',
      '',
      'Offline, idempotent, strictly non-destructive multi-agent setup:',
      '  --agent claude       Link .claude/skills -> ../.agents/skills (Windows junction / POSIX symlink)',
      '  --agent codex        Verify native AGENTS.md, .agents/skills/, and .codex/config.toml without overwriting',
      '  --agent antigravity  Verify native AGENTS.md / .agents/skills/ and print manual ~/.gemini/config/mcp_config.json snippet',
      '  --dry-run            Preview planned actions without modifying files',
    ].join('\n'),
  );
}

function runCli() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`agents:setup failed:\n- ${message}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const result = setupAgents({
    rootDir: options.rootDir,
    agents: options.agents,
    dryRun: options.dryRun,
  });

  for (const action of result.actions) {
    console.log(`[${action.agent}] (${action.status}) ${action.message}`);
  }
  for (const note of result.notes) {
    console.log(note);
  }

  if (!result.ok) {
    console.error(`agents:setup failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
    process.exitCode = 1;
  }
}

const isMainModule =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runCli();
}
