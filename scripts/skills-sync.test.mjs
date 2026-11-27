import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeSkillDirHash,
  DEFAULT_ROOT_DIR,
  syncSkills,
  verifySkillsState,
} from './skills-sync.mjs';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'skills-sync.mjs');
const tempDirs = [];

function createTempRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'skills-sync-test-'));
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

function buildValidFixture() {
  const rootDir = createTempRepo({
    '.agents/skills/tdd/SKILL.md': makeSkillMarkdown('tdd', 'Test-driven development.'),
    '.agents/skills/ui-ux-pro-max/SKILL.md': makeSkillMarkdown(
      'ui-ux-pro-max',
      'UI/UX design intelligence.',
    ),
    '.agents/skills/ui-ux-pro-max/scripts/search.py': 'print("ok")\n',
    '.agents/skills/playwright-cli/SKILL.md': makeSkillMarkdown(
      'playwright-cli',
      'Browser automation with playwright-cli.',
    ),
    'node_modules/@playwright/cli/package.json': JSON.stringify({
      name: '@playwright/cli',
      version: '0.1.25',
    }),
    'node_modules/@playwright/cli/skills/playwright-cli/SKILL.md': makeSkillMarkdown(
      'playwright-cli',
      'Browser automation with playwright-cli.',
    ),
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
      'ui-ux-pro-max': {
        source: 'ui-ux-pro-max-cli',
        sourceType: 'npm-cli',
        version: '2.15.0',
        commit: 'a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5',
        aiTarget: 'universal',
        skillDir: '.agents/skills/ui-ux-pro-max',
        skillPath: '.agents/skills/ui-ux-pro-max/SKILL.md',
        computedHash: computeSkillDirHash(join(rootDir, '.agents/skills/ui-ux-pro-max')),
      },
      'playwright-cli': {
        source: '@playwright/cli',
        sourceType: 'local-package',
        version: '0.1.25',
        skillDir: 'skills/playwright-cli',
        skillPath: 'skills/playwright-cli/SKILL.md',
        computedHash: computeSkillDirHash(join(rootDir, '.agents/skills/playwright-cli')),
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

describe('verifySkillsState', () => {
  it('passes when every skill has an immutable pin, valid frontmatter, matching hash, and no orphans', () => {
    const { rootDir } = buildValidFixture();

    const result = verifySkillsState({ rootDir });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.skills).toEqual(['playwright-cli', 'tdd', 'ui-ux-pro-max']);
  });

  it('rejects floating versions, non-40-char commit refs, and non-universal agent targets', () => {
    const { rootDir, lockfile } = buildValidFixture();
    lockfile.skills.tdd.commit = 'main';
    lockfile.skills['ui-ux-pro-max'].version = 'latest';
    lockfile.skills['ui-ux-pro-max'].aiTarget = 'antigravity';
    lockfile.skills['playwright-cli'].version = '^0.1.25';
    writeFileSync(join(rootDir, 'skills-lock.json'), JSON.stringify(lockfile, null, 2));

    const result = verifySkillsState({ rootDir });

    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toMatch(/tdd.*commit/i);
    expect(joined).toMatch(/ui-ux-pro-max.*version/i);
    expect(joined).toMatch(/ui-ux-pro-max.*universal/i);
    expect(joined).toMatch(/playwright-cli.*version/i);
  });

  it('fails on orphan skill directories, invalid frontmatter, and hash drift', () => {
    const { rootDir } = buildValidFixture();

    mkdirSync(join(rootDir, '.agents/skills/banner-design'), { recursive: true });
    writeFileSync(
      join(rootDir, '.agents/skills/banner-design/SKILL.md'),
      makeSkillMarkdown('banner-design'),
    );

    writeFileSync(
      join(rootDir, '.agents/skills/tdd/SKILL.md'),
      makeSkillMarkdown('wrong-name', 'Still has description'),
    );

    const result = verifySkillsState({ rootDir });

    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toMatch(/banner-design/i);
    expect(joined).toMatch(/name.*tdd/i);
    expect(joined).toMatch(/hash.*tdd/i);
  });
});

describe('syncSkills', () => {
  it('produces an agent-neutral, pinned dry-run plan without floating latest references or disk writes', async () => {
    const { rootDir } = buildValidFixture();
    rmSync(join(rootDir, '.agents/skills'), { recursive: true, force: true });

    const result = await syncSkills({ rootDir, dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.plan).toHaveLength(3);
    expect(existsSync(join(rootDir, '.agents/skills'))).toBe(false);

    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toMatch(/latest/i);
    expect(serialized).not.toMatch(/antigravity/i);
    expect(serialized).toContain('abeeaf95660ba9e8b7c753eb38f441ca707a8823');
    expect(serialized).toContain('ui-ux-pro-max-cli@2.15.0');
    expect(serialized).toContain('--ai universal');
  });

  it('syncs all three source types cleanly into .agents/skills without copying unwanted bonus skills', async () => {
    const { rootDir } = buildValidFixture();
    rmSync(join(rootDir, '.agents/skills'), { recursive: true, force: true });

    const result = await syncSkills({
      rootDir,
      executors: {
        fetchGithubRepo: async ({ source, commit, destinationDir }) => {
          expect(source).toBe('mattpocock/skills');
          expect(commit).toBe('abeeaf95660ba9e8b7c753eb38f441ca707a8823');
          mkdirSync(join(destinationDir, 'skills/engineering/tdd'), { recursive: true });
          writeFileSync(
            join(destinationDir, 'skills/engineering/tdd/SKILL.md'),
            makeSkillMarkdown('tdd', 'Test-driven development.'),
            'utf8',
          );
        },
        runNpmCli: async ({ source, version, aiTarget, stagingDir }) => {
          expect(source).toBe('ui-ux-pro-max-cli');
          expect(version).toBe('2.15.0');
          expect(aiTarget).toBe('universal');
          // Simulate ui-ux-pro-max-cli generating ui-ux-pro-max PLUS unwanted bonus design skills
          mkdirSync(join(stagingDir, '.agents/skills/ui-ux-pro-max/scripts'), { recursive: true });
          writeFileSync(
            join(stagingDir, '.agents/skills/ui-ux-pro-max/SKILL.md'),
            makeSkillMarkdown('ui-ux-pro-max', 'UI/UX design intelligence.'),
            'utf8',
          );
          writeFileSync(
            join(stagingDir, '.agents/skills/ui-ux-pro-max/scripts/search.py'),
            'print("ok")\n',
            'utf8',
          );
          mkdirSync(join(stagingDir, '.agents/skills/banner-design'), { recursive: true });
          writeFileSync(
            join(stagingDir, '.agents/skills/banner-design/SKILL.md'),
            makeSkillMarkdown('banner-design'),
            'utf8',
          );
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.synced).toEqual(['playwright-cli', 'tdd', 'ui-ux-pro-max']);
    expect(existsSync(join(rootDir, '.agents/skills/banner-design'))).toBe(false);
    expect(readFileSync(join(rootDir, '.agents/skills/tdd/SKILL.md'), 'utf8')).toContain(
      'name: tdd',
    );
    expect(verifySkillsState({ rootDir }).ok).toBe(true);
  });

  it('fails local-package sync when installed package version differs from pinned lockfile version', async () => {
    const { rootDir } = buildValidFixture();
    writeFileSync(
      join(rootDir, 'node_modules/@playwright/cli/package.json'),
      JSON.stringify({ name: '@playwright/cli', version: '0.2.0' }),
    );

    const result = await syncSkills({ rootDir, skillFilter: ['playwright-cli'] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/0\.1\.25.*0\.2\.0|version mismatch/i);
  });

  it('leaves existing local skill intact when fetched content fails hash verification', async () => {
    const { rootDir } = buildValidFixture();
    const originalContent = readFileSync(join(rootDir, '.agents/skills/tdd/SKILL.md'), 'utf8');

    const result = await syncSkills({
      rootDir,
      skillFilter: ['tdd'],
      executors: {
        fetchGithubRepo: async ({ destinationDir }) => {
          mkdirSync(join(destinationDir, 'skills/engineering/tdd'), { recursive: true });
          writeFileSync(
            join(destinationDir, 'skills/engineering/tdd/SKILL.md'),
            makeSkillMarkdown('tdd', 'Tampered upstream content.'),
            'utf8',
          );
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/hash mismatch.*tdd/i);
    expect(readFileSync(join(rootDir, '.agents/skills/tdd/SKILL.md'), 'utf8')).toBe(
      originalContent,
    );
  });

  it('refuses to sync when the lockfile has floating pins or an unknown --skill filter', async () => {
    const { rootDir, lockfile } = buildValidFixture();
    let executorCalled = false;

    const unknownResult = await syncSkills({
      rootDir,
      skillFilter: ['does-not-exist'],
      executors: {
        fetchGithubRepo: async () => {
          executorCalled = true;
        },
      },
    });
    expect(unknownResult.ok).toBe(false);
    expect(unknownResult.errors.join('\n')).toMatch(/unknown skill/i);
    expect(executorCalled).toBe(false);

    lockfile.skills['ui-ux-pro-max'].version = 'latest';
    writeFileSync(join(rootDir, 'skills-lock.json'), JSON.stringify(lockfile, null, 2));

    const floatingResult = await syncSkills({
      rootDir,
      executors: {
        fetchGithubRepo: async () => {
          executorCalled = true;
        },
        runNpmCli: async () => {
          executorCalled = true;
        },
      },
    });
    expect(floatingResult.ok).toBe(false);
    expect(floatingResult.errors.join('\n')).toMatch(/ui-ux-pro-max.*version/i);
    expect(executorCalled).toBe(false);
  });

  it('runs as a CLI exiting 0 on valid fixtures and 1 on drifted fixtures', () => {
    const { rootDir } = buildValidFixture();

    const verifyPass = spawnSync(process.execPath, [scriptPath, '--verify', '--root', rootDir], {
      encoding: 'utf8',
    });
    expect(verifyPass.status).toBe(0);
    expect(verifyPass.stdout).toMatch(/verified/i);

    const dryRunPass = spawnSync(process.execPath, [scriptPath, '--dry-run', '--root', rootDir], {
      encoding: 'utf8',
    });
    expect(dryRunPass.status).toBe(0);
    expect(dryRunPass.stdout).not.toMatch(/antigravity/i);
    expect(dryRunPass.stdout).not.toMatch(/latest/i);

    mkdirSync(join(rootDir, '.agents/skills/slides'), { recursive: true });
    writeFileSync(join(rootDir, '.agents/skills/slides/SKILL.md'), makeSkillMarkdown('slides'));

    const verifyFail = spawnSync(process.execPath, [scriptPath, '--verify', '--root', rootDir], {
      encoding: 'utf8',
    });
    expect(verifyFail.status).toBe(1);
    expect(verifyFail.stderr).toMatch(/slides/i);
  });
});

describe('repository canonical skills state', () => {
  const EXPECTED_CANONICAL_SKILLS = [
    'code-review',
    'codebase-design',
    'diagnosing-bugs',
    'domain-modeling',
    'grill-me',
    'grill-with-docs',
    'grilling',
    'implement',
    'playwright-cli',
    'setup-matt-pocock-skills',
    'tdd',
    'to-spec',
    'to-tickets',
    'ui-ux-pro-max',
    'web-design-guidelines',
  ];

  it('tracks strictly the 15 canonical shared skills with immutable pins and valid frontmatter', () => {
    const result = verifySkillsState({ rootDir: DEFAULT_ROOT_DIR });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.skills).toEqual(EXPECTED_CANONICAL_SKILLS);
  });
});
