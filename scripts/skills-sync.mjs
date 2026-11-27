import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT_DIR = resolve(scriptsDir, '..');
export const CANONICAL_TARGET_DIR = '.agents/skills';

const GIT_COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function formatError(err) {
  return err instanceof Error ? err.message : String(err);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeRelativeSubpath(value) {
  if (!isNonEmptyString(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const parts = value.split(/[\\/]+/);
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

function validateExactSemver(skillName, version, errors) {
  if (typeof version !== 'string' || !EXACT_SEMVER_RE.test(version)) {
    errors.push(
      `Skill "${skillName}" must pin an exact semver "version" without ranges or "latest" (got ${JSON.stringify(version)})`,
    );
  }
}

function walkFilesSorted(rootDir, currentDir = rootDir, acc = []) {
  const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFilesSorted(rootDir, fullPath, acc);
    } else if (entry.isFile()) {
      acc.push(fullPath);
    }
  }

  return acc;
}

export function computeSkillDirHash(dirPath) {
  const hash = createHash('sha256');
  const files = walkFilesSorted(dirPath);

  for (const filePath of files) {
    const relPosix = relative(dirPath, filePath).split('\\').join('/');
    const raw = readFileSync(filePath);
    const isBinary = raw.includes(0);
    const normalized = isBinary
      ? raw
      : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

    hash.update(relPosix, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(normalized);
    hash.update('\0', 'utf8');
  }

  return hash.digest('hex');
}

export function parseSkillFrontmatter(markdown) {
  if (typeof markdown !== 'string') {
    return { ok: false, error: 'SKILL.md content must be a string' };
  }

  const normalized = markdown.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return { ok: false, error: 'Missing YAML frontmatter block delimited by ---' };
  }

  const frontmatter = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) continue;

    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!fieldMatch) continue;

    const [, key, rawValue] = fieldMatch;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  if (!isNonEmptyString(frontmatter.name)) {
    return { ok: false, error: 'Frontmatter missing non-empty "name"' };
  }
  if (!isNonEmptyString(frontmatter.description)) {
    return { ok: false, error: 'Frontmatter missing non-empty "description"' };
  }

  return { ok: true, frontmatter };
}

function validateSkillMarkdown(skillDir, skillName) {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath) || !statSync(skillMdPath).isFile()) {
    return { ok: false, error: `Missing SKILL.md for skill "${skillName}"` };
  }

  const parsed = parseSkillFrontmatter(readFileSync(skillMdPath, 'utf8'));
  if (!parsed.ok) {
    return { ok: false, error: `Invalid SKILL.md frontmatter for "${skillName}": ${parsed.error}` };
  }

  if (parsed.frontmatter.name !== skillName) {
    return {
      ok: false,
      error: `Frontmatter "name" mismatch for "${skillName}": expected "${skillName}", got "${parsed.frontmatter.name}"`,
    };
  }

  return { ok: true, frontmatter: parsed.frontmatter };
}

const SOURCE_HANDLERS = {
  github: {
    validate(skillName, entry, errors) {
      if (typeof entry.source !== 'string' || !GITHUB_REPO_RE.test(entry.source)) {
        errors.push(`Skill "${skillName}" github source must be "owner/repo"`);
      }
      if (typeof entry.commit !== 'string' || !GIT_COMMIT_RE.test(entry.commit)) {
        errors.push(
          `Skill "${skillName}" must pin an explicit 40-char git "commit" SHA (got ${JSON.stringify(entry.commit)})`,
        );
      }
    },
    plan(skillName, entry, target) {
      return {
        skill: skillName,
        sourceType: entry.sourceType,
        pin: `${entry.source}@${entry.commit}`,
        command: `fetch https://codeload.github.com/${entry.source}/tar.gz/${entry.commit} -> ${entry.skillDir} -> ${target}`,
        target,
      };
    },
    async resolve({ entry, tempWorkDir, githubCache, fetchGithubRepo }) {
      const cacheKey = `${entry.source}@${entry.commit}`;
      let repoDir = githubCache.get(cacheKey);
      if (!repoDir) {
        repoDir = join(tempWorkDir, `gh-${githubCache.size}`);
        mkdirSync(repoDir, { recursive: true });
        await fetchGithubRepo({
          source: entry.source,
          commit: entry.commit,
          destinationDir: repoDir,
        });
        githubCache.set(cacheKey, repoDir);
      }
      return join(repoDir, entry.skillDir);
    },
  },
  'npm-cli': {
    validate(skillName, entry, errors) {
      validateExactSemver(skillName, entry.version, errors);
      if (
        entry.commit !== undefined &&
        (typeof entry.commit !== 'string' || !GIT_COMMIT_RE.test(entry.commit))
      ) {
        errors.push(
          `Skill "${skillName}" optional "commit" must be a 40-char git SHA (got ${JSON.stringify(entry.commit)})`,
        );
      }
      if (entry.aiTarget !== 'universal') {
        errors.push(
          `Skill "${skillName}" must use agent-neutral aiTarget "universal" (got ${JSON.stringify(entry.aiTarget)})`,
        );
      }
    },
    plan(skillName, entry, target) {
      return {
        skill: skillName,
        sourceType: entry.sourceType,
        pin: `${entry.source}@${entry.version}`,
        command: `npx --yes ${entry.source}@${entry.version} init --ai ${entry.aiTarget} --offline --force -> copy ${entry.skillDir} -> ${target}`,
        target,
      };
    },
    async resolve({ skillName, entry, tempWorkDir, runNpmCli }) {
      const stagingDir = join(tempWorkDir, `npm-${skillName}`);
      mkdirSync(stagingDir, { recursive: true });
      await runNpmCli({
        source: entry.source,
        version: entry.version,
        aiTarget: entry.aiTarget,
        stagingDir,
      });
      return join(stagingDir, entry.skillDir);
    },
  },
  'local-package': {
    validate(skillName, entry, errors) {
      validateExactSemver(skillName, entry.version, errors);
    },
    plan(skillName, entry, target) {
      return {
        skill: skillName,
        sourceType: entry.sourceType,
        pin: `${entry.source}@${entry.version}`,
        command: `copy node_modules/${entry.source}/${entry.skillDir} (verified ${entry.version}) -> ${target}`,
        target,
      };
    },
    async resolve({ entry, rootDir }) {
      const pkgRoot = join(rootDir, 'node_modules', ...entry.source.split('/'));
      const pkgJsonPath = join(pkgRoot, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        throw new Error(
          `Local package "${entry.source}" is not installed at ${pkgJsonPath}. Run "npm ci" first.`,
        );
      }
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.version !== entry.version) {
        throw new Error(
          `Local package "${entry.source}" version mismatch: lockfile pins ${entry.version}, installed ${pkg.version}`,
        );
      }
      return join(pkgRoot, entry.skillDir);
    },
  },
};

export function validateLockfile(lockfile) {
  const errors = [];

  if (!isPlainObject(lockfile)) {
    return { ok: false, errors: ['skills-lock.json must be a JSON object'] };
  }

  if (lockfile.version !== 3) {
    errors.push(`Unsupported lockfile version: ${String(lockfile.version)} (expected 3)`);
  }

  if (lockfile.targetDir !== CANONICAL_TARGET_DIR) {
    errors.push(
      `Lockfile targetDir must be "${CANONICAL_TARGET_DIR}" (got ${JSON.stringify(lockfile.targetDir)})`,
    );
  }

  if (!isPlainObject(lockfile.skills) || Object.keys(lockfile.skills).length === 0) {
    errors.push('Lockfile "skills" must be a non-empty object');
    return { ok: false, errors };
  }

  for (const [skillName, entry] of Object.entries(lockfile.skills)) {
    if (!SKILL_NAME_RE.test(skillName)) {
      errors.push(`Invalid skill name "${skillName}"`);
      continue;
    }

    if (!isPlainObject(entry)) {
      errors.push(`Skill "${skillName}" entry must be an object`);
      continue;
    }

    if (!isNonEmptyString(entry.source)) {
      errors.push(`Skill "${skillName}" must specify a non-empty "source"`);
    }

    const validSkillDir = isSafeRelativeSubpath(entry.skillDir);
    if (!validSkillDir) {
      errors.push(`Skill "${skillName}" has invalid "skillDir": ${JSON.stringify(entry.skillDir)}`);
    }

    const expectedSkillPath = validSkillDir ? `${entry.skillDir}/SKILL.md` : null;
    if (
      !isSafeRelativeSubpath(entry.skillPath) ||
      (expectedSkillPath !== null && entry.skillPath !== expectedSkillPath)
    ) {
      errors.push(
        `Skill "${skillName}" has invalid "skillPath": ${JSON.stringify(entry.skillPath)} (expected "${expectedSkillPath ?? '<skillDir>/SKILL.md'}")`,
      );
    }

    if (typeof entry.computedHash !== 'string' || !SHA256_RE.test(entry.computedHash)) {
      errors.push(`Skill "${skillName}" must pin a 64-char SHA-256 "computedHash"`);
    }

    const handler = SOURCE_HANDLERS[entry.sourceType];
    if (!handler) {
      errors.push(
        `Skill "${skillName}" has unsupported sourceType: ${JSON.stringify(entry.sourceType)}`,
      );
    } else {
      handler.validate(skillName, entry, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

function loadLockfile(lockfilePath) {
  if (!existsSync(lockfilePath)) {
    return { ok: false, errors: [`Lockfile does not exist: ${lockfilePath}`], lockfile: null };
  }

  let lockfile;
  try {
    lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid JSON in lockfile: ${formatError(err)}`],
      lockfile: null,
    };
  }

  const schemaResult = validateLockfile(lockfile);
  return { ok: schemaResult.ok, errors: schemaResult.errors, lockfile };
}

export function verifySkillsState({
  rootDir = DEFAULT_ROOT_DIR,
  lockfilePath = join(rootDir, 'skills-lock.json'),
  skillsDir = join(rootDir, CANONICAL_TARGET_DIR),
} = {}) {
  const loaded = loadLockfile(lockfilePath);
  if (!loaded.lockfile) {
    return { ok: false, errors: loaded.errors, skills: [] };
  }

  const errors = [...loaded.errors];
  const lockfile = loaded.lockfile;

  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    errors.push(`Canonical skills directory does not exist: ${skillsDir}`);
    return { ok: false, errors, skills: [] };
  }

  const lockedNames = isPlainObject(lockfile.skills) ? Object.keys(lockfile.skills).sort() : [];
  const lockedSet = new Set(lockedNames);

  const installedEntries = readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entry of installedEntries) {
    if (!entry.isDirectory()) {
      errors.push(`Unexpected non-directory entry in ${CANONICAL_TARGET_DIR}: ${entry.name}`);
      continue;
    }
    if (!lockedSet.has(entry.name)) {
      errors.push(`Untracked/orphan skill directory in ${CANONICAL_TARGET_DIR}: ${entry.name}`);
    }
  }

  for (const skillName of lockedNames) {
    const entry = lockfile.skills[skillName];
    const skillDir = join(skillsDir, skillName);
    if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
      errors.push(`Missing installed skill directory: ${CANONICAL_TARGET_DIR}/${skillName}`);
      continue;
    }

    const mdCheck = validateSkillMarkdown(skillDir, skillName);
    if (!mdCheck.ok) {
      errors.push(mdCheck.error);
    }

    if (typeof entry?.computedHash === 'string' && SHA256_RE.test(entry.computedHash)) {
      const actualHash = computeSkillDirHash(skillDir);
      if (actualHash !== entry.computedHash) {
        errors.push(
          `Content hash mismatch for "${skillName}": lockfile=${entry.computedHash}, actual=${actualHash}`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    skills: lockedNames,
  };
}

function buildPlanStep(skillName, entry) {
  const target = `${CANONICAL_TARGET_DIR}/${skillName}`;
  const handler = SOURCE_HANDLERS[entry.sourceType];
  if (!handler) {
    throw new Error(`Unsupported sourceType for "${skillName}": ${String(entry.sourceType)}`);
  }
  return handler.plan(skillName, entry, target);
}

async function defaultFetchGithubRepo({ source, commit, destinationDir }) {
  const url = `https://codeload.github.com/${source}/tar.gz/${commit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const tarballPath = join(dirname(destinationDir), `${commit}.tar.gz`);
  writeFileSync(tarballPath, archiveBuffer);

  try {
    const extract = spawnSync(
      'tar',
      ['-xzf', tarballPath, '--strip-components=1', '-C', destinationDir],
      { encoding: 'utf8' },
    );
    if (extract.error) {
      throw extract.error;
    }
    if (extract.status !== 0) {
      throw new Error(`tar extraction failed for ${source}@${commit}: ${extract.stderr.trim()}`);
    }
  } finally {
    rmSync(tarballPath, { force: true });
  }
}

async function defaultRunNpmCli({ source, version, aiTarget, stagingDir }) {
  const result = spawnSync(
    'npx',
    ['--yes', `${source}@${version}`, 'init', '--ai', aiTarget, '--offline', '--force'],
    {
      cwd: stagingDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${source}@${version} failed (exit ${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

export async function syncSkills({
  rootDir = DEFAULT_ROOT_DIR,
  lockfilePath = join(rootDir, 'skills-lock.json'),
  skillsDir = join(rootDir, CANONICAL_TARGET_DIR),
  dryRun = false,
  skillFilter = [],
  updateHashes = false,
  executors = {},
} = {}) {
  const loaded = loadLockfile(lockfilePath);
  if (!loaded.ok || !loaded.lockfile) {
    return { ok: false, errors: loaded.errors, plan: [], synced: [] };
  }

  const lockfile = loaded.lockfile;
  const allNames = Object.keys(lockfile.skills).sort();

  const unknownSkills = skillFilter.filter((name) => !(name in lockfile.skills));
  if (unknownSkills.length > 0) {
    return {
      ok: false,
      errors: [`Unknown skill(s) not declared in skills-lock.json: ${unknownSkills.join(', ')}`],
      plan: [],
      synced: [],
    };
  }

  const targetNames = skillFilter.length > 0 ? [...new Set(skillFilter)].sort() : allNames;
  const plan = targetNames.map((name) => buildPlanStep(name, lockfile.skills[name]));

  if (dryRun) {
    return { ok: true, errors: [], plan, synced: [] };
  }

  const fetchGithubRepo = executors.fetchGithubRepo ?? defaultFetchGithubRepo;
  const runNpmCli = executors.runNpmCli ?? defaultRunNpmCli;

  const tempWorkDir = mkdtempSync(join(tmpdir(), 'skills-sync-work-'));
  const githubCache = new Map();
  const errors = [];
  const synced = [];

  try {
    mkdirSync(skillsDir, { recursive: true });

    for (const skillName of targetNames) {
      const entry = lockfile.skills[skillName];
      const handler = SOURCE_HANDLERS[entry.sourceType];
      const targetSkillDir = join(skillsDir, skillName);

      try {
        const sourceDir = await handler.resolve({
          skillName,
          entry,
          rootDir,
          tempWorkDir,
          githubCache,
          fetchGithubRepo,
          runNpmCli,
        });

        if (!sourceDir || !existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
          throw new Error(`Resolved skill source directory does not exist: ${String(sourceDir)}`);
        }

        const mdCheck = validateSkillMarkdown(sourceDir, skillName);
        if (!mdCheck.ok) {
          throw new Error(mdCheck.error);
        }

        const actualHash = computeSkillDirHash(sourceDir);
        if (!updateHashes && actualHash !== entry.computedHash) {
          throw new Error(
            `Content hash mismatch for "${skillName}": lockfile=${entry.computedHash}, actual=${actualHash}. Pass --update-hashes only for intentional pinned upgrades.`,
          );
        }

        rmSync(targetSkillDir, { recursive: true, force: true });
        cpSync(sourceDir, targetSkillDir, { recursive: true });

        if (updateHashes) {
          lockfile.skills[skillName].computedHash = actualHash;
        }

        synced.push(skillName);
      } catch (err) {
        errors.push(`Failed to sync "${skillName}": ${formatError(err)}`);
      }
    }

    if (updateHashes && errors.length === 0) {
      writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, 'utf8');
    }
  } finally {
    rmSync(tempWorkDir, { recursive: true, force: true });
  }

  return { ok: errors.length === 0, errors, plan, synced };
}

function parseCliArgs(argv) {
  let rootDir = DEFAULT_ROOT_DIR;
  let verify = false;
  let dryRun = false;
  let updateHashes = false;
  const skillFilter = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--verify') {
      verify = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--update-hashes') {
      updateHashes = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --root');
      rootDir = resolve(next);
      i += 1;
    } else if (arg === '--skill') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --skill');
      skillFilter.push(next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { rootDir, verify, dryRun, updateHashes, skillFilter };
}

async function runCli() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`skills:sync failed:\n- ${formatError(err)}`);
    process.exitCode = 1;
    return;
  }

  if (options.verify) {
    const result = verifySkillsState({ rootDir: options.rootDir });
    if (!result.ok) {
      console.error(
        `Skills verification failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Skills verified (${result.skills.length} canonical skills pinned in ${CANONICAL_TARGET_DIR}): ${result.skills.join(', ')}`,
    );
    return;
  }

  const result = await syncSkills({
    rootDir: options.rootDir,
    dryRun: options.dryRun,
    skillFilter: options.skillFilter,
    updateHashes: options.updateHashes,
  });

  if (!result.ok) {
    console.error(`skills:sync failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log(
      `Pinned skills sync plan (${result.plan.length} skills -> ${CANONICAL_TARGET_DIR}):`,
    );
    for (const step of result.plan) {
      console.log(`- ${step.skill} (${step.pin}): ${step.command}`);
    }
    return;
  }

  console.log(
    `Synced ${result.synced.length} pinned canonical skills into ${CANONICAL_TARGET_DIR}: ${result.synced.join(', ')}`,
  );
}

const isMainModule =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await runCli();
}
