import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setupAgents } from './agents-setup.mjs';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'agents-setup.mjs');
const tempDirs = [];

function createTempRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-setup-test-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  return dir;
}

function buildMinimalRepo() {
  return createTempRepo({
    'AGENTS.md': '# Project Agent Guide\n',
    'CLAUDE.md': '@AGENTS.md\n',
    '.mcp.json': JSON.stringify(
      {
        mcpServers: {
          context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
          playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
        },
      },
      null,
      2,
    ),
    '.codex/config.toml': [
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
      '[mcp_servers.playwright]',
      'command = "npx"',
      'args = ["-y", "@playwright/mcp@latest"]',
      '',
    ].join('\n'),
    '.agents/skills/tdd/SKILL.md': '---\nname: tdd\ndescription: TDD\n---\n',
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('setupAgents', () => {
  it('creates .claude/skills symlink to .agents/skills and succeeds idempotently on rerun', () => {
    const rootDir = buildMinimalRepo();

    const first = setupAgents({ rootDir, agents: ['claude'] });
    expect(first.ok).toBe(true);
    expect(first.errors).toEqual([]);
    expect(first.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: 'claude',
          target: '.claude/skills',
          status: 'created',
        }),
      ]),
    );

    const linkPath = join(rootDir, '.claude/skills');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(join(rootDir, '.agents/skills')));

    const second = setupAgents({ rootDir, agents: ['claude'] });
    expect(second.ok).toBe(true);
    expect(second.errors).toEqual([]);
    expect(second.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: 'claude',
          target: '.claude/skills',
          status: 'unchanged',
        }),
      ]),
    );
  });

  it('refuses to overwrite or delete a pre-existing non-managed .claude/skills directory', () => {
    const rootDir = buildMinimalRepo();
    const userSkillFile = join(rootDir, '.claude/skills/my-private-skill/SKILL.md');
    mkdirSync(dirname(userSkillFile), { recursive: true });
    writeFileSync(userSkillFile, '# User private skill\n', 'utf8');

    const result = setupAgents({ rootDir, agents: ['claude'] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/non-managed directory.*\.claude\/skills/i);
    expect(lstatSync(join(rootDir, '.claude/skills')).isDirectory()).toBe(true);
    expect(lstatSync(join(rootDir, '.claude/skills')).isSymbolicLink()).toBe(false);
    expect(readFileSync(userSkillFile, 'utf8')).toBe('# User private skill\n');
  });

  it('refuses to overwrite a pre-existing .claude/skills symlink pointing to another directory', () => {
    const rootDir = buildMinimalRepo();
    const otherDir = join(rootDir, 'custom-skills');
    mkdirSync(otherDir, { recursive: true });
    mkdirSync(join(rootDir, '.claude'), { recursive: true });
    symlinkSync('../custom-skills', join(rootDir, '.claude/skills'), 'dir');

    const result = setupAgents({ rootDir, agents: ['claude'] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/existing symlink.*\.claude\/skills/i);
    expect(realpathSync(join(rootDir, '.claude/skills'))).toBe(realpathSync(otherDir));
  });

  it('preserves pre-existing CLAUDE.md, .mcp.json, and .codex/config.toml untouched', () => {
    const rootDir = buildMinimalRepo();
    writeFileSync(join(rootDir, 'CLAUDE.md'), '# User custom claude instructions\n', 'utf8');
    writeFileSync(join(rootDir, '.mcp.json'), '{"mcpServers":{"custom":{"command":"echo"}}}\n');
    writeFileSync(join(rootDir, '.codex/config.toml'), '[mcp_servers.custom]\ncommand = "echo"\n');

    const result = setupAgents({ rootDir, agents: ['claude', 'codex'] });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(rootDir, 'CLAUDE.md'), 'utf8')).toBe(
      '# User custom claude instructions\n',
    );
    expect(readFileSync(join(rootDir, '.mcp.json'), 'utf8')).toBe(
      '{"mcpServers":{"custom":{"command":"echo"}}}\n',
    );
    expect(readFileSync(join(rootDir, '.codex/config.toml'), 'utf8')).toBe(
      '[mcp_servers.custom]\ncommand = "echo"\n',
    );
  });

  it('refuses cleanly without throwing when .claude exists as a regular file', () => {
    const rootDir = buildMinimalRepo();
    const claudeFile = join(rootDir, '.claude');
    writeFileSync(claudeFile, 'user-custom-file\n', 'utf8');

    const result = setupAgents({ rootDir, agents: ['claude'] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/non-managed.*\.claude/i);
    expect(readFileSync(claudeFile, 'utf8')).toBe('user-custom-file\n');
  });

  it('supports opt-in per agent without mutating other agents or home directories', () => {
    const rootDir = buildMinimalRepo();
    const fakeHome = mkdtempSync(join(tmpdir(), 'agents-setup-home-'));
    tempDirs.push(fakeHome);

    const cliRun = spawnSync(
      process.execPath,
      [scriptPath, '--agent', 'antigravity', '--agent', 'codex', '--root', rootDir],
      {
        encoding: 'utf8',
        env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
      },
    );
    expect(cliRun.status).toBe(0);
    expect(cliRun.stdout).toContain('~/.gemini/config/mcp_config.json');
    expect(cliRun.stdout).toContain('@upstash/context7-mcp');
    expect(cliRun.stdout).toContain('@playwright/mcp@latest');
    expect(existsSync(join(rootDir, '.claude/skills'))).toBe(false);
    expect(existsSync(join(fakeHome, '.gemini'))).toBe(false);
    expect(existsSync(join(fakeHome, '.codex'))).toBe(false);
  });

  it('previews Windows junction and POSIX symlink targets in --dry-run without writing to disk', () => {
    const rootDir = buildMinimalRepo();

    const winPlan = setupAgents({
      rootDir,
      agents: ['claude'],
      dryRun: true,
      platform: 'win32',
    });
    expect(winPlan.ok).toBe(true);
    expect(winPlan.actions[0]).toMatchObject({
      status: 'would-create',
      linkType: 'junction',
      linkTarget: join(rootDir, '.agents/skills'),
    });
    expect(existsSync(join(rootDir, '.claude'))).toBe(false);

    const posixPlan = setupAgents({
      rootDir,
      agents: ['claude'],
      dryRun: true,
      platform: 'linux',
    });
    expect(posixPlan.ok).toBe(true);
    expect(posixPlan.actions[0]).toMatchObject({
      status: 'would-create',
      linkType: 'dir',
      linkTarget: '../.agents/skills',
    });
    expect(existsSync(join(rootDir, '.claude'))).toBe(false);
  });

  it('requires explicit opt-in via --agent and handles CLI execution cleanly', () => {
    const rootDir = buildMinimalRepo();

    const noAgent = spawnSync(process.execPath, [scriptPath, '--root', rootDir], {
      encoding: 'utf8',
    });
    expect(noAgent.status).toBe(1);
    expect(noAgent.stderr).toMatch(/--agent/i);
    expect(existsSync(join(rootDir, '.claude/skills'))).toBe(false);

    const help = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/agents:setup/);

    const claudeRun = spawnSync(
      process.execPath,
      [scriptPath, '--agent', 'claude', '--root', rootDir],
      { encoding: 'utf8' },
    );
    expect(claudeRun.status).toBe(0);
    expect(claudeRun.stdout).toMatch(/\[claude\] \(created\)/);
    expect(lstatSync(join(rootDir, '.claude/skills')).isSymbolicLink()).toBe(true);
  });
});
