import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_SKILLS_REL, inspectClaudeSkillsAdapter } from './agents-setup.mjs';
import { DEFAULT_ROOT_DIR, verifySkillsState } from './skills-sync.mjs';

const REQUIRED_MCP_SERVERS = ['context7', 'playwright'];

const SECRET_KEY_RE =
  /(?:^|[_-])(?:api[_-]?key|token|secret|password|passwd|credential|auth|authorization|private[_-]?key|cookie)(?:$|[_-])/i;

const SECRET_ARG_FLAG_RE =
  /^--?(?:api[-_]?key|token|secret|password|auth|authorization|bearer)(?:=|$)/i;

const SECRET_VALUE_PATTERNS = [
  { label: 'Bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{8,}/i },
  {
    label: 'API key assignment',
    pattern: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._-]{6,}/i,
  },
  { label: 'Context7 secret key', pattern: /\bctx7sk-[A-Za-z0-9_-]{6,}/ },
  { label: 'OpenAI/Anthropic secret key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}/ },
  { label: 'GitHub token', pattern: /\b(?:ghp_|gho_|ghu_|ghs_|github_pat_)[A-Za-z0-9_]{12,}/ },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{16,}/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scanToml(input, onUnquotedChar) {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  let brackets = 0;
  let braces = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else {
      if (ch === '[') brackets += 1;
      else if (ch === ']') brackets -= 1;
      else if (ch === '{') braces += 1;
      else if (ch === '}') braces -= 1;

      if (onUnquotedChar && onUnquotedChar(ch, i, brackets, braces) === true) {
        break;
      }
    }
  }

  return { inDouble, inSingle, brackets, braces };
}

function stripTomlComment(line) {
  let commentIndex = -1;
  scanToml(line, (ch, index) => {
    if (ch === '#') {
      commentIndex = index;
      return true;
    }
    return false;
  });
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function splitTopLevel(input, delimiter) {
  const parts = [];
  let start = 0;
  const state = scanToml(input, (ch, index, brackets, braces) => {
    if (ch === delimiter && brackets === 0 && braces === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
    return false;
  });

  if (state.inDouble || state.inSingle || state.brackets !== 0 || state.braces !== 0) {
    throw new Error(`Unterminated string, array, or inline table in TOML expression: ${input}`);
  }

  parts.push(input.slice(start));
  return parts;
}

function ensureTomlTablePath(startObj, segments, contextLabel) {
  let cursor = startObj;
  for (const segment of segments) {
    if (!(segment in cursor)) {
      cursor[segment] = {};
    }
    if (!isPlainObject(cursor[segment])) {
      throw new Error(`TOML path "${contextLabel}" conflicts with an existing non-table value`);
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function parseTomlKeySegment(segment) {
  const trimmed = segment.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error(`Invalid TOML key segment: ${JSON.stringify(trimmed)}`);
}

function parseTomlValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error('Empty TOML value');
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    const items = splitTopLevel(inner, ',');
    const parsed = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i].trim();
      if (!item && i === items.length - 1) continue;
      parsed.push(parseTomlValue(item));
    }
    return parsed;
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return {};
    const entries = splitTopLevel(inner, ',');
    const obj = {};
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i].trim();
      if (!entry && i === entries.length - 1) continue;
      const eqIndex = entry.indexOf('=');
      if (eqIndex === -1) {
        throw new Error(`Invalid inline table entry: ${entry}`);
      }
      const key = parseTomlKeySegment(entry.slice(0, eqIndex));
      obj[key] = parseTomlValue(entry.slice(eqIndex + 1));
    }
    return obj;
  }

  throw new Error(`Unsupported TOML value syntax: ${trimmed}`);
}

export function parseCodexMcpToml(tomlContent) {
  const root = {};
  let currentTarget = root;
  const lines = tomlContent.replace(/\r\n/g, '\n').split('\n');

  try {
    for (let i = 0; i < lines.length; i += 1) {
      const cleaned = stripTomlComment(lines[i]).trim();
      if (!cleaned) continue;

      if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
        if (cleaned.startsWith('[[')) {
          throw new Error(`Unsupported TOML array-of-tables syntax on line ${i + 1}`);
        }
        const header = cleaned.slice(1, -1).trim();
        const pathSegments = splitTopLevel(header, '.').map(parseTomlKeySegment);
        currentTarget = ensureTomlTablePath(root, pathSegments, header);
        continue;
      }

      const eqIndex = cleaned.indexOf('=');
      if (eqIndex === -1) {
        throw new Error(`Expected key = value on line ${i + 1}: ${cleaned}`);
      }

      const rawKey = cleaned.slice(0, eqIndex).trim();
      let rawValue = cleaned.slice(eqIndex + 1).trim();

      let balance = scanToml(rawValue);
      while (balance.brackets > 0 || balance.braces > 0) {
        i += 1;
        if (i >= lines.length) {
          throw new Error(`Unterminated multi-line TOML value for key "${rawKey}"`);
        }
        const continuation = stripTomlComment(lines[i]).trim();
        if (continuation) {
          rawValue = `${rawValue} ${continuation}`;
          balance = scanToml(rawValue);
        }
      }

      const keySegments = splitTopLevel(rawKey, '.').map(parseTomlKeySegment);
      const target = ensureTomlTablePath(currentTarget, keySegments.slice(0, -1), rawKey);
      target[keySegments[keySegments.length - 1]] = parseTomlValue(rawValue);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`.codex/config.toml parse error: ${message}`], data: null };
  }

  return { ok: true, errors: [], data: root };
}

function scanObjectForSecrets(value, fileLabel, pathPrefix, errors) {
  if (typeof value === 'string') {
    for (const { label, pattern } of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        errors.push(`${fileLabel} contains potential secret (${label}) at "${pathPrefix}"`);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      if (typeof item === 'string' && SECRET_ARG_FLAG_RE.test(item)) {
        errors.push(
          `${fileLabel} contains secret-bearing CLI argument "${item}" at "${pathPrefix}[${i}]"`,
        );
      }
      scanObjectForSecrets(item, fileLabel, `${pathPrefix}[${i}]`, errors);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, entryValue] of Object.entries(value)) {
      const entryPath = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (key === 'env' || key === 'headers' || key === 'http_headers') {
        const hasEntries = isPlainObject(entryValue) ? Object.keys(entryValue).length > 0 : true;
        if (hasEntries) {
          errors.push(
            `${fileLabel} must remain secret-free and must not define "${entryPath}" with environment/header credentials`,
          );
        }
      } else if (SECRET_KEY_RE.test(key)) {
        errors.push(`${fileLabel} contains forbidden sensitive key "${entryPath}"`);
      }

      scanObjectForSecrets(entryValue, fileLabel, entryPath, errors);
    }
  }
}

function scanRawTextForSecrets(rawText, fileLabel, errors) {
  for (const { label, pattern } of SECRET_VALUE_PATTERNS) {
    if (pattern.test(rawText)) {
      errors.push(`${fileLabel} contains potential secret (${label}) in file content`);
    }
  }
}

function checkInstructions(rootDir, errors) {
  const agentsPath = join(rootDir, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    errors.push('Missing canonical instruction file "AGENTS.md"');
  } else {
    const agentsStat = lstatSync(agentsPath);
    if (!agentsStat.isFile() || agentsStat.isSymbolicLink()) {
      errors.push('"AGENTS.md" must be a regular file (not a symlink or directory)');
    } else if (readFileSync(agentsPath, 'utf8').trim().length === 0) {
      errors.push('"AGENTS.md" must not be empty');
    }
  }

  const claudePath = join(rootDir, 'CLAUDE.md');
  if (!existsSync(claudePath)) {
    try {
      const brokenStat = lstatSync(claudePath);
      if (brokenStat.isSymbolicLink()) {
        errors.push(
          '"CLAUDE.md" must be a regular plain-text file containing "@AGENTS.md", not a symlink',
        );
        return;
      }
    } catch {
      // Truly missing
    }
    errors.push('Missing cross-platform adapter file "CLAUDE.md"');
    return;
  }

  const claudeStat = lstatSync(claudePath);
  if (claudeStat.isSymbolicLink()) {
    errors.push(
      '"CLAUDE.md" must be a regular plain-text file containing "@AGENTS.md", not a POSIX symlink',
    );
    return;
  }

  if (!claudeStat.isFile()) {
    errors.push('"CLAUDE.md" must be a regular file');
    return;
  }

  const normalized = readFileSync(claudePath, 'utf8').replace(/\r\n/g, '\n').trim();
  if (normalized !== '@AGENTS.md') {
    errors.push(
      `"CLAUDE.md" drifted from SSOT: expected strictly "@AGENTS.md", got ${JSON.stringify(normalized)}`,
    );
  }
}

function checkGitignore(rootDir, errors) {
  const gitignorePath = join(rootDir, '.gitignore');
  if (!existsSync(gitignorePath) || !lstatSync(gitignorePath).isFile()) {
    errors.push('Missing ".gitignore" (must ignore local ".claude/skills" adapter)');
    return;
  }

  const rules = readFileSync(gitignorePath, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const acceptedRules = new Set([
    '.claude/skills',
    '.claude/skills/',
    '/.claude/skills',
    '/.claude/skills/',
    '.claude/',
    '/.claude/',
    '.claude',
  ]);

  if (!rules.some((rule) => acceptedRules.has(rule))) {
    errors.push('".gitignore" must ignore ".claude/skills" so local adapters are never committed');
  }
}

function validateServerShape(serversObj, fileLabel, errors) {
  const normalized = {};

  for (const [name, config] of Object.entries(serversObj)) {
    if (!isPlainObject(config)) {
      errors.push(`${fileLabel} server "${name}" must be an object/table`);
      continue;
    }

    if (typeof config.command !== 'string' || config.command.trim().length === 0) {
      errors.push(`${fileLabel} server "${name}" must define a non-empty string "command"`);
      continue;
    }

    if (!Array.isArray(config.args) || !config.args.every((arg) => typeof arg === 'string')) {
      errors.push(`${fileLabel} server "${name}" must define "args" as an array of strings`);
      continue;
    }

    normalized[name] = {
      command: config.command,
      args: config.args,
    };
  }

  return normalized;
}

function checkMcpParityAndSecrets(rootDir, errors) {
  const mcpJsonPath = join(rootDir, '.mcp.json');
  const codexTomlPath = join(rootDir, '.codex/config.toml');

  let claudeServers = null;
  let codexServers = null;

  if (!existsSync(mcpJsonPath) || !lstatSync(mcpJsonPath).isFile()) {
    errors.push('Missing Claude Code project MCP config ".mcp.json"');
  } else {
    const rawMcp = readFileSync(mcpJsonPath, 'utf8');
    scanRawTextForSecrets(rawMcp, '.mcp.json', errors);
    try {
      const parsed = JSON.parse(rawMcp);
      if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) {
        errors.push('".mcp.json" must contain a top-level "mcpServers" object');
      } else {
        scanObjectForSecrets(parsed, '.mcp.json', '', errors);
        claudeServers = validateServerShape(parsed.mcpServers, '.mcp.json', errors);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Invalid JSON in ".mcp.json": ${message}`);
    }
  }

  if (!existsSync(codexTomlPath) || !lstatSync(codexTomlPath).isFile()) {
    errors.push('Missing Codex project MCP config ".codex/config.toml"');
  } else {
    const rawToml = readFileSync(codexTomlPath, 'utf8');
    scanRawTextForSecrets(rawToml, '.codex/config.toml', errors);
    const parsed = parseCodexMcpToml(rawToml);
    if (!parsed.ok) {
      errors.push(...parsed.errors);
    } else if (!isPlainObject(parsed.data.mcp_servers)) {
      errors.push('".codex/config.toml" must define "[mcp_servers.<name>]" tables');
    } else {
      scanObjectForSecrets(parsed.data, '.codex/config.toml', '', errors);
      codexServers = validateServerShape(parsed.data.mcp_servers, '.codex/config.toml', errors);
    }
  }

  if (!claudeServers || !codexServers) {
    return [];
  }

  for (const required of REQUIRED_MCP_SERVERS) {
    if (!(required in claudeServers)) {
      errors.push(`".mcp.json" is missing required MCP server "${required}"`);
    }
    if (!(required in codexServers)) {
      errors.push(`".codex/config.toml" is missing required MCP server "${required}"`);
    }
  }

  const allServerNames = [
    ...new Set([...Object.keys(claudeServers), ...Object.keys(codexServers)]),
  ].sort();

  for (const name of allServerNames) {
    const claude = claudeServers[name];
    const codex = codexServers[name];

    if (!claude) {
      errors.push(
        `MCP parity mismatch: server "${name}" exists in .codex/config.toml but not .mcp.json`,
      );
      continue;
    }
    if (!codex) {
      errors.push(
        `MCP parity mismatch: server "${name}" exists in .mcp.json but not .codex/config.toml`,
      );
      continue;
    }

    if (claude.command !== codex.command) {
      errors.push(
        `MCP parity mismatch for "${name}" command: .mcp.json=${JSON.stringify(claude.command)}, .codex/config.toml=${JSON.stringify(codex.command)}`,
      );
    }

    const argsMatch =
      claude.args.length === codex.args.length &&
      claude.args.every((arg, index) => arg === codex.args[index]);
    if (!argsMatch) {
      errors.push(
        `MCP parity mismatch for "${name}" args: .mcp.json=${JSON.stringify(claude.args)}, .codex/config.toml=${JSON.stringify(codex.args)}`,
      );
    }
  }

  return allServerNames;
}

export function checkAgentsState({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const errors = [];

  checkInstructions(rootDir, errors);
  checkGitignore(rootDir, errors);

  const skillsResult = verifySkillsState({ rootDir });
  if (!skillsResult.ok) {
    errors.push(...skillsResult.errors);
  }

  const mcpServers = checkMcpParityAndSecrets(rootDir, errors);

  const claudeAdapter = inspectClaudeSkillsAdapter(rootDir);
  if (claudeAdapter.status === 'non-managed') {
    errors.push(
      `Local "${CLAUDE_SKILLS_REL}" is a non-managed ${claudeAdapter.entryType}; expected a symlink/junction to ".agents/skills" (or absent).`,
    );
  } else if (claudeAdapter.status === 'wrong-link') {
    errors.push(
      `Local "${CLAUDE_SKILLS_REL}" symlink points to "${claudeAdapter.rawTarget}" instead of ".agents/skills".`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      skillsCount: skillsResult.skills.length,
      mcpServers,
      claudeSkillsAdapter: claudeAdapter.status,
    },
  };
}

function parseCliArgs(argv) {
  let rootDir = DEFAULT_ROOT_DIR;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --root');
      rootDir = resolve(next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { rootDir, help };
}

function runCli() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`agents:check failed:\n- ${message}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log('Usage: npm run agents:check [-- --root <dir>]');
    return;
  }

  const result = checkAgentsState({ rootDir: options.rootDir });
  if (!result.ok) {
    console.error(`agents:check failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `agents:check passed (${result.summary.skillsCount} pinned skills, MCP parity: ${result.summary.mcpServers.join(', ')}, .claude/skills: ${result.summary.claudeSkillsAdapter})`,
  );
}

const isMainModule =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runCli();
}
