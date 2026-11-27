import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAgentsState } from './agents-check.mjs';
import { computeSkillDirHash, DEFAULT_ROOT_DIR } from './skills-sync.mjs';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'agents-check.mjs');
const tempDirs = [];

function createTempRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-check-test-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  return dir;
}

function makeSkillMarkdown(name, description = `Skill instructions for ${name}`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

function buildValidRepo() {
  const rootDir = createTempRepo({
    'AGENTS.md': '# Project Agent Guide\n',
    'CLAUDE.md': '@AGENTS.md\n',
    '.gitignore': 'node_modules/\n.claude/skills\n',
    '.mcp.json': JSON.stringify(
      {
        mcpServers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
          playwright: {
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest'],
          },
        },
      },
      null,
      2,
    ),
    '.codex/config.toml': [
      '# Secret-free Codex MCP config',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
      '[mcp_servers.playwright]',
      'command = "npx"',
      'args = ["-y", "@playwright/mcp@latest"]',
      '',
    ].join('\n'),
    '.agents/skills/tdd/SKILL.md': makeSkillMarkdown('tdd', 'Test-driven development.'),
  });

  const lockfile = {
    version: 3,
    targetDir: '.agents/skills',
    skills: {
      tdd: {
        source: 'mattpocock/skills',
        sourceType: 'github',
        commit: 'abeeaf95660ba9e8b7c753eb38f441ca707a8823',
        skillDir: 'skills/engineering/tdd',
        skillPath: 'skills/engineering/tdd/SKILL.md',
        computedHash: computeSkillDirHash(join(rootDir, '.agents/skills/tdd')),
      },
    },
  };

  writeFileSync(join(rootDir, 'skills-lock.json'), `${JSON.stringify(lockfile, null, 2)}\n`);
  return { rootDir, lockfile };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('checkAgentsState', () => {
  it('passes offline when instructions, pinned skills, MCP parity, and gitignore are clean', () => {
    const { rootDir } = buildValidRepo();

    const result = checkAgentsState({ rootDir });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary.skillsCount).toBe(1);
    expect(result.summary.mcpServers).toEqual(['context7', 'playwright']);
    expect(result.summary.claudeSkillsAdapter).toBe('missing');
  });

  it('fails when CLAUDE.md is a POSIX symlink or drifts from strictly @AGENTS.md', () => {
    const { rootDir } = buildValidRepo();
    unlinkSync(join(rootDir, 'CLAUDE.md'));
    symlinkSync('AGENTS.md', join(rootDir, 'CLAUDE.md'));

    const symlinkResult = checkAgentsState({ rootDir });
    expect(symlinkResult.ok).toBe(false);
    expect(symlinkResult.errors.join('\n')).toMatch(/CLAUDE\.md.*symlink/i);

    unlinkSync(join(rootDir, 'CLAUDE.md'));
    writeFileSync(join(rootDir, 'CLAUDE.md'), '@AGENTS.md\n\nExtra Claude-only rule\n', 'utf8');

    const driftResult = checkAgentsState({ rootDir });
    expect(driftResult.ok).toBe(false);
    expect(driftResult.errors.join('\n')).toMatch(/CLAUDE\.md.*@AGENTS\.md/i);
  });

  it('fails on unpinned skills, orphan skill directories, and invalid SKILL.md frontmatter', () => {
    const { rootDir, lockfile } = buildValidRepo();

    lockfile.skills.tdd.commit = 'main';
    writeFileSync(join(rootDir, 'skills-lock.json'), JSON.stringify(lockfile, null, 2));

    mkdirSync(join(rootDir, '.agents/skills/orphan-skill'), { recursive: true });
    writeFileSync(
      join(rootDir, '.agents/skills/orphan-skill/SKILL.md'),
      makeSkillMarkdown('orphan-skill'),
    );

    writeFileSync(join(rootDir, '.agents/skills/tdd/SKILL.md'), '# Missing frontmatter\n');

    const result = checkAgentsState({ rootDir });
    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toMatch(/tdd.*commit/i);
    expect(joined).toMatch(/orphan-skill/i);
    expect(joined).toMatch(/frontmatter.*tdd|tdd.*frontmatter/i);
  });

  it('fails when .codex/config.toml and .mcp.json MCP server definitions diverge', () => {
    const { rootDir } = buildValidRepo();
    writeFileSync(
      join(rootDir, '.codex/config.toml'),
      [
        '[mcp_servers.context7]',
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp"]',
        '',
        '[mcp_servers.playwright]',
        'command = "npx"',
        'args = ["-y", "@playwright/mcp@0.0.1"]',
        '',
      ].join('\n'),
      'utf8',
    );

    const argsMismatch = checkAgentsState({ rootDir });
    expect(argsMismatch.ok).toBe(false);
    expect(argsMismatch.errors.join('\n')).toMatch(/playwright.*args/i);

    writeFileSync(
      join(rootDir, '.codex/config.toml'),
      [
        '[mcp_servers.context7]',
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp"]',
        '',
      ].join('\n'),
      'utf8',
    );

    const missingServer = checkAgentsState({ rootDir });
    expect(missingServer.ok).toBe(false);
    expect(missingServer.errors.join('\n')).toMatch(/playwright/i);
  });

  it('fails when secrets or credentials leak into .mcp.json or .codex/config.toml', () => {
    const { rootDir } = buildValidRepo();
    writeFileSync(
      join(rootDir, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            context7: {
              command: 'npx',
              args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-example-secret'],
            },
            playwright: {
              command: 'npx',
              args: ['-y', '@playwright/mcp@latest'],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(rootDir, '.codex/config.toml'),
      [
        '[mcp_servers.context7]',
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk-example-secret"]',
        '',
        '[mcp_servers.context7.env]',
        'OPENAI_API_KEY = "sk-test1234567890abcdef"',
        '',
        '[mcp_servers.playwright]',
        'command = "npx"',
        'args = ["-y", "@playwright/mcp@latest"]',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = checkAgentsState({ rootDir });
    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toMatch(/\.mcp\.json.*secret|api-key/i);
    expect(joined).toMatch(/\.codex\/config\.toml.*secret|env/i);
  });

  it('validates local .claude/skills adapter when present and rejects non-managed directories or broken links', () => {
    const { rootDir } = buildValidRepo();

    mkdirSync(join(rootDir, '.claude'), { recursive: true });
    symlinkSync('../.agents/skills', join(rootDir, '.claude/skills'), 'dir');
    const validLink = checkAgentsState({ rootDir });
    expect(validLink.ok).toBe(true);
    expect(validLink.summary.claudeSkillsAdapter).toBe('valid-link');

    unlinkSync(join(rootDir, '.claude/skills'));
    symlinkSync('../non-existent-skills', join(rootDir, '.claude/skills'), 'dir');
    const brokenLink = checkAgentsState({ rootDir });
    expect(brokenLink.ok).toBe(false);
    expect(brokenLink.errors.join('\n')).toMatch(/\.claude\/skills/i);

    unlinkSync(join(rootDir, '.claude/skills'));
    mkdirSync(join(rootDir, '.claude/skills/duplicated'), { recursive: true });
    const nonManagedDir = checkAgentsState({ rootDir });
    expect(nonManagedDir.ok).toBe(false);
    expect(nonManagedDir.errors.join('\n')).toMatch(/\.claude\/skills.*non-managed|symlink/i);

    rmSync(join(rootDir, '.claude'), { recursive: true, force: true });
    writeFileSync(join(rootDir, '.claude'), 'blocking-file\n', 'utf8');
    const blockingFile = checkAgentsState({ rootDir });
    expect(blockingFile.ok).toBe(false);
    expect(blockingFile.errors.join('\n')).toMatch(/\.claude.*non-managed|blocking/i);
  });

  it('fails if .gitignore does not ignore .claude/skills', () => {
    const { rootDir } = buildValidRepo();
    writeFileSync(join(rootDir, '.gitignore'), 'node_modules/\n', 'utf8');

    const result = checkAgentsState({ rootDir });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/\.gitignore.*\.claude\/skills/i);
  });

  it('runs cleanly as an offline CLI against valid and drifted fixtures', () => {
    const { rootDir } = buildValidRepo();

    const pass = spawnSync(process.execPath, [scriptPath, '--root', rootDir], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(pass.status).toBe(0);
    expect(pass.stdout).toMatch(/agents:check passed/i);

    writeFileSync(join(rootDir, 'CLAUDE.md'), '# Drifted\n', 'utf8');
    const fail = spawnSync(process.execPath, [scriptPath, '--root', rootDir], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(fail.status).toBe(1);
    expect(fail.stderr).toMatch(/CLAUDE\.md/i);
  });

  it('passes against the actual repository state', () => {
    const result = checkAgentsState({ rootDir: DEFAULT_ROOT_DIR });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary.skillsCount).toBe(15);
    expect(result.summary.mcpServers).toEqual(['context7', 'playwright']);
  });
});
