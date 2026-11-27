import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runGasDeployGuard } from './gas-deploy.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(scriptDir, 'gas-deploy.mjs');
const repoRoot = resolve(scriptDir, '..');

const VALID_CODE = [
  'function doGet(e) { return { action: e?.parameter?.action }; }',
  'function doPost(e) { return { body: e?.postData?.contents }; }',
].join('\n');

const VALID_MANIFEST = JSON.stringify(
  {
    timeZone: 'Asia/Bangkok',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
    oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    webapp: {
      executeAs: 'USER_DEPLOYING',
      access: 'MYSELF',
    },
  },
  null,
  2,
);

const VALID_DUAL_ENV_OPTIONS = {
  stagingClasp: { scriptId: 'script-staging-001', srcDir: 'dist' },
  prodClasp: { scriptId: 'script-prod-001', srcDir: 'dist' },
  stagingEnv: 'GAS_DEPLOYMENT_ID=deploy-staging-001\nSPREADSHEET_ID=sheet-staging-001\n',
  prodEnv: 'GAS_DEPLOYMENT_ID=deploy-prod-001\nSPREADSHEET_ID=sheet-prod-001\n',
};

const tempDirs = [];

function createWorkspaceFixture({
  stagingClasp = { scriptId: 'script-staging-001', srcDir: 'dist' },
  prodClasp = null,
  stagingEnv = 'GAS_DEPLOYMENT_ID=AKfycbStagingDeploy001\nSPREADSHEET_ID=sheet-staging-001\n',
  prodEnv = null,
  distFiles = { 'Code.js': VALID_CODE, 'appsscript.json': VALID_MANIFEST },
} = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'gas-deploy-test-'));
  tempDirs.push(rootDir);

  const backendDir = join(rootDir, 'backend');
  mkdirSync(backendDir, { recursive: true });

  if (stagingClasp !== null) {
    writeFileSync(
      join(backendDir, '.clasp.staging.json'),
      typeof stagingClasp === 'string' ? stagingClasp : JSON.stringify(stagingClasp, null, 2),
      'utf8',
    );
  }
  if (prodClasp !== null) {
    writeFileSync(
      join(backendDir, '.clasp.prod.json'),
      typeof prodClasp === 'string' ? prodClasp : JSON.stringify(prodClasp, null, 2),
      'utf8',
    );
  }
  if (stagingEnv !== null) {
    writeFileSync(join(backendDir, '.env.staging'), stagingEnv, 'utf8');
  }
  if (prodEnv !== null) {
    writeFileSync(join(backendDir, '.env.prod'), prodEnv, 'utf8');
  }
  if (distFiles !== null) {
    const distDir = join(backendDir, 'dist');
    mkdirSync(distDir, { recursive: true });
    for (const [name, content] of Object.entries(distFiles)) {
      writeFileSync(join(distDir, name), content, 'utf8');
    }
  }

  return rootDir;
}

function initGitRepo(rootDir) {
  const run = (args) => {
    const res = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
    }
  };
  writeFileSync(
    join(rootDir, '.gitignore'),
    '.clasp*.json\n!.clasp.json.example\n.env*\n!.env.example\ndist/\n',
    'utf8',
  );
  writeFileSync(join(rootDir, 'README.md'), '# fixture\n', 'utf8');
  run(['init']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test User']);
  run(['add', '.gitignore', 'README.md']);
  run(['commit', '-m', 'chore: initial commit']);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('runGasDeployGuard — Slice 1: Staging build, bundle verification & clasp -P', () => {
  it('enforces build and GAS bundle verification before invoking clasp -P push -f on staging push', async () => {
    const rootDir = createWorkspaceFixture({
      stagingEnv: 'GAS_DEPLOYMENT_ID=\nSPREADSHEET_ID=sheet-staging-001\n',
    });
    const calls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'push',
      runBuild: () => {
        calls.push(['build']);
        return { ok: true, stdout: '', stderr: '' };
      },
      runClasp: (args) => {
        calls.push(['clasp', ...args]);
        return { ok: true, stdout: 'Pushed 2 files.', stderr: '' };
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([['build'], ['clasp', '-P', '.clasp.staging.json', 'push', '-f']]);
  });

  it('aborts without invoking clasp when production build fails', async () => {
    const rootDir = createWorkspaceFixture();
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'push',
      runBuild: () => ({ ok: false, stdout: '', stderr: 'tsc failed' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/build failed/i);
    expect(claspCalls).toEqual([]);
  });

  it('aborts without invoking clasp when GAS bundle verification fails', async () => {
    const rootDir = createWorkspaceFixture({
      distFiles: {
        'Code.js': 'function doGet() { return {}; }',
        'appsscript.json': VALID_MANIFEST,
      },
    });
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'push',
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/doPost/);
    expect(claspCalls).toEqual([]);
  });

  it('runs immutable versioned deployment (push -f -> create-version -> update-deployment) using clasp -P on staging deploy', async () => {
    const rootDir = createWorkspaceFixture();
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'deploy',
      version: 'v1.0.0-rc.1',
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runGit: (args) => {
        if (args[0] === 'rev-parse') return { ok: true, stdout: 'abc1234\n', stderr: '' };
        return { ok: true, stdout: '', stderr: '' };
      },
      runClasp: (args) => {
        claspCalls.push(args);
        if (args.includes('create-version')) {
          return { ok: true, stdout: JSON.stringify({ versionNumber: 12 }), stderr: '' };
        }
        return { ok: true, stdout: 'ok', stderr: '' };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.versionNumber).toBe(12);
    expect(claspCalls).toEqual([
      ['-P', '.clasp.staging.json', 'push', '-f'],
      ['-P', '.clasp.staging.json', '--json', 'create-version', 'v1.0.0-rc.1 (abc1234)'],
      [
        '-P',
        '.clasp.staging.json',
        'update-deployment',
        'AKfycbStagingDeploy001',
        '-V',
        '12',
        '-d',
        'v1.0.0-rc.1 (abc1234)',
      ],
    ]);
  });

  it('rejects missing or placeholder staging config and invalid srcDir', async () => {
    const placeholderRoot = createWorkspaceFixture({
      stagingClasp: { scriptId: 'YOUR_APPS_SCRIPT_ID', srcDir: 'src' },
      stagingEnv: 'GAS_DEPLOYMENT_ID=\nSPREADSHEET_ID=YOUR_GOOGLE_SPREADSHEET_ID\n',
    });
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir: placeholderRoot,
      env: 'staging',
      action: 'deploy',
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toMatch(/scriptId/i);
    expect(joined).toMatch(/srcDir|rootDir/i);
    expect(joined).toMatch(/deploymentId/i);
    expect(joined).toMatch(/SPREADSHEET_ID/);
    expect(claspCalls).toEqual([]);
  });
});

describe('runGasDeployGuard — Slice 2: Staging vs Production isolation', () => {
  it('rejects identical scriptId between Staging and Production', async () => {
    const rootDir = createWorkspaceFixture({
      stagingClasp: { scriptId: 'shared-script-id', srcDir: 'dist' },
      prodClasp: { scriptId: 'shared-script-id', srcDir: 'dist' },
      stagingEnv: 'GAS_DEPLOYMENT_ID=deploy-staging-001\nSPREADSHEET_ID=sheet-staging-001\n',
      prodEnv: 'GAS_DEPLOYMENT_ID=deploy-prod-001\nSPREADSHEET_ID=sheet-prod-001\n',
    });
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'deploy',
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/scriptId.*distinct|same scriptId/i);
    expect(claspCalls).toEqual([]);
  });

  it('rejects identical deploymentId between Staging and Production', async () => {
    const rootDir = createWorkspaceFixture({
      stagingClasp: { scriptId: 'script-staging-001', srcDir: 'dist' },
      prodClasp: { scriptId: 'script-prod-001', srcDir: 'dist' },
      stagingEnv: 'GAS_DEPLOYMENT_ID=AKfycbSharedDeploy\nSPREADSHEET_ID=sheet-staging-001\n',
      prodEnv: 'GAS_DEPLOYMENT_ID=AKfycbSharedDeploy\nSPREADSHEET_ID=sheet-prod-001\n',
    });
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'deploy',
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/deploymentId.*distinct|same deploymentId/i);
    expect(claspCalls).toEqual([]);
  });

  it('rejects identical SPREADSHEET_ID between Staging and Production without printing raw IDs', async () => {
    const secretSheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz9876543210';
    const rootDir = createWorkspaceFixture({
      stagingClasp: { scriptId: 'script-staging-001', srcDir: 'dist' },
      prodClasp: { scriptId: 'script-prod-001', srcDir: 'dist' },
      stagingEnv: `GAS_DEPLOYMENT_ID=deploy-staging-001\nSPREADSHEET_ID=${secretSheetId}\n`,
      prodEnv: `GAS_DEPLOYMENT_ID=deploy-prod-001\nSPREADSHEET_ID=${secretSheetId}\n`,
    });
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'staging',
      action: 'deploy',
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toMatch(/SPREADSHEET_ID.*distinct|same SPREADSHEET_ID/i);
    expect(joined).not.toContain(secretSheetId);
    expect(claspCalls).toEqual([]);
  });

  it('rejects Production deployment when Staging config is missing so isolation cannot be bypassed', async () => {
    const rootDir = createWorkspaceFixture({
      stagingClasp: null,
      stagingEnv: null,
      prodClasp: { scriptId: 'script-prod-001', srcDir: 'dist' },
      prodEnv: 'GAS_DEPLOYMENT_ID=deploy-prod-001\nSPREADSHEET_ID=sheet-prod-001\n',
    });
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      version: 'v1.0.0',
      confirm: 'DEPLOY PROD v1.0.0',
      envVars: {},
      runGit: () => ({ ok: true, stdout: '', stderr: '' }),
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/Staging/i);
    expect(claspCalls).toEqual([]);
  });
});

describe('runGasDeployGuard — Slice 3: Production safety gates', () => {
  it('blocks Production deployment inside CI so merging to main never auto-deploys Production', async () => {
    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    initGitRepo(rootDir);
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      version: 'v1.0.0',
      confirm: 'DEPLOY PROD v1.0.0',
      envVars: { CI: 'true' },
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/CI|auto-deploy/i);
    expect(claspCalls).toEqual([]);
  });

  it('rejects Production deployment when the Git working tree is dirty', async () => {
    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    initGitRepo(rootDir);
    writeFileSync(join(rootDir, 'README.md'), '# modified uncommitted change\n', 'utf8');
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      version: 'v1.0.0',
      confirm: 'DEPLOY PROD v1.0.0',
      envVars: {},
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/clean Git working tree/i);
    expect(claspCalls).toEqual([]);
  });

  it('requires a valid SemVer --version for Production deploy', async () => {
    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    initGitRepo(rootDir);
    const claspCalls = [];

    const missingVersion = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      confirm: 'DEPLOY PROD v1.0.0',
      envVars: {},
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(missingVersion.ok).toBe(false);
    expect(missingVersion.errors.join('\n')).toMatch(/SemVer|--version/i);
    expect(claspCalls).toEqual([]);
  });

  it('rejects Production deploy and push when explicit confirmation is missing or wrong', async () => {
    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    initGitRepo(rootDir);
    const claspCalls = [];

    const missingConfirm = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      version: 'v1.0.0',
      envVars: {},
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(missingConfirm.ok).toBe(false);
    expect(missingConfirm.errors.join('\n')).toMatch(/DEPLOY PROD v1\.0\.0/);

    const wrongConfirm = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'push',
      confirm: 'yes',
      envVars: {},
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(wrongConfirm.ok).toBe(false);
    expect(wrongConfirm.errors.join('\n')).toMatch(/PUSH PROD/);
    expect(claspCalls).toEqual([]);
  });

  it('deploys Production with clasp -P when Git tree is clean, environments are isolated, SemVer is valid, and confirmation matches', async () => {
    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    initGitRepo(rootDir);
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      version: 'v1.2.0',
      confirmPrompt: async (expectedPhrase) => expectedPhrase,
      envVars: {},
      runBuild: () => ({ ok: true, stdout: '', stderr: '' }),
      runClasp: (args) => {
        claspCalls.push(args);
        if (args.includes('create-version')) {
          return { ok: true, stdout: JSON.stringify({ versionNumber: 7 }), stderr: '' };
        }
        return { ok: true, stdout: 'ok', stderr: '' };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.versionNumber).toBe(7);
    expect(claspCalls[0]).toEqual(['-P', '.clasp.prod.json', 'push', '-f']);
    expect(claspCalls[1].slice(0, 4)).toEqual([
      '-P',
      '.clasp.prod.json',
      '--json',
      'create-version',
    ]);
    expect(claspCalls[1][4]).toMatch(/^v1\.2\.0 \([0-9a-f]+\)$/);
    expect(claspCalls[2].slice(0, 6)).toEqual([
      '-P',
      '.clasp.prod.json',
      'update-deployment',
      'deploy-prod-001',
      '-V',
      '7',
    ]);
  });
});

describe('runGasDeployGuard — Slice 4: Dry-run, CLI seam & gitignore verification', () => {
  it('supports --dry-run by running all checks, build, and bundle verification without invoking clasp', async () => {
    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    initGitRepo(rootDir);
    let buildCount = 0;
    const claspCalls = [];

    const result = await runGasDeployGuard({
      rootDir,
      env: 'prod',
      action: 'deploy',
      version: 'v1.0.0',
      confirm: 'DEPLOY PROD v1.0.0',
      dryRun: true,
      envVars: {},
      runBuild: () => {
        buildCount += 1;
        return { ok: true, stdout: '', stderr: '' };
      },
      runClasp: (args) => {
        claspCalls.push(args);
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(buildCount).toBe(1);
    expect(claspCalls).toEqual([]);
    expect(result.plannedCommands).toHaveLength(3);
    expect(result.plannedCommands[0]).toEqual(['-P', '.clasp.prod.json', 'push', '-f']);
    expect(result.plannedCommands[1].slice(0, 4)).toEqual([
      '-P',
      '.clasp.prod.json',
      '--json',
      'create-version',
    ]);
    expect(result.plannedCommands[2].slice(0, 4)).toEqual([
      '-P',
      '.clasp.prod.json',
      'update-deployment',
      'deploy-prod-001',
    ]);
  });

  it('runs via CLI subprocess: exits 0 on --help and valid --dry-run, exits 1 on guard violations', () => {
    const helpRun = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
    expect(helpRun.status).toBe(0);
    expect(helpRun.stdout).toMatch(/Usage:/);

    const rootDir = createWorkspaceFixture(VALID_DUAL_ENV_OPTIONS);
    writeFileSync(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { build: 'node -e "process.exit(0)"' } }),
      'utf8',
    );
    initGitRepo(rootDir);
    spawnSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'chore: add build script'], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    const cleanEnv = { ...process.env };
    delete cleanEnv.CI;
    delete cleanEnv.GITHUB_ACTIONS;

    const passRun = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--root',
        rootDir,
        '--env',
        'prod',
        '--action',
        'deploy',
        '--version',
        'v1.0.0',
        '--confirm',
        'DEPLOY PROD v1.0.0',
        '--dry-run',
      ],
      { encoding: 'utf8', env: cleanEnv },
    );
    expect(passRun.status).toBe(0);
    expect(passRun.stdout).toMatch(/dry-run/i);
    expect(passRun.stdout).toMatch(/clasp -P \.clasp\.prod\.json push -f/);
    expect(passRun.stdout).not.toContain('sheet-prod-001');

    const unconfirmedRun = spawnSync(
      process.execPath,
      [scriptPath, '--root', rootDir, '--env', 'prod', '--action', 'deploy', '--version', 'v1.0.0'],
      { encoding: 'utf8', env: cleanEnv },
    );
    expect(unconfirmedRun.status).toBe(1);
    expect(unconfirmedRun.stderr).toMatch(/DEPLOY PROD v1\.0\.0/);
  });

  it('ignores all environment-specific clasp configs in repo .gitignore while preserving examples', () => {
    const shouldIgnore = [
      '.clasp.json',
      'backend/.clasp.json',
      'backend/.clasp.staging.json',
      'backend/.clasp.prod.json',
      'backend/.clasp-uat.json',
      'backend/.env.staging',
      'backend/.env.prod',
    ];

    for (const filePath of shouldIgnore) {
      const res = spawnSync('git', ['check-ignore', filePath], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(res.status, `Expected ${filePath} to be gitignored`).toBe(0);
    }

    const shouldTrack = ['backend/.clasp.json.example', 'backend/.env.example'];
    for (const filePath of shouldTrack) {
      const res = spawnSync('git', ['check-ignore', filePath], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(res.status, `Expected ${filePath} NOT to be gitignored`).toBe(1);
    }
  });
});
