import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyGasBundle } from './verify-gas-bundle.mjs';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-gas-bundle.mjs');

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

const tempDirs = [];

function createFixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'gas-bundle-test-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('verifyGasBundle', () => {
  it('passes when bundle contains strictly Code.js and appsscript.json with global doGet/doPost within size budget', () => {
    const dir = createFixtureDir({
      'Code.js': VALID_CODE,
      'appsscript.json': VALID_MANIFEST,
    });

    const result = verifyGasBundle({ distDir: dir });

    expect(result.ok).toBe(true);
    expect(result.files).toEqual(['Code.js', 'appsscript.json']);
    expect(result.entrypoints).toEqual(['doGet', 'doPost']);
    expect(result.bundleBytes).toBeGreaterThan(0);
    expect(result.bundleBytes).toBeLessThanOrEqual(result.maxBytes);
  });

  it('fails when extra files or subdirectories appear in dist', () => {
    const dirWithFile = createFixtureDir({
      'Code.js': VALID_CODE,
      'appsscript.json': VALID_MANIFEST,
      'extra.js': 'console.log("unexpected");',
    });

    const fileResult = verifyGasBundle({ distDir: dirWithFile });
    expect(fileResult.ok).toBe(false);
    expect(fileResult.errors.join('\n')).toMatch(/extra\.js/);

    const dirWithSubdir = createFixtureDir({
      'Code.js': VALID_CODE,
      'appsscript.json': VALID_MANIFEST,
    });
    mkdirSync(join(dirWithSubdir, 'nested'));

    const subdirResult = verifyGasBundle({ distDir: dirWithSubdir });
    expect(subdirResult.ok).toBe(false);
    expect(subdirResult.errors.join('\n')).toMatch(/nested/);
  });

  it('fails when required files or dist directory are missing', () => {
    const missingManifestDir = createFixtureDir({ 'Code.js': VALID_CODE });
    const missingManifestResult = verifyGasBundle({ distDir: missingManifestDir });
    expect(missingManifestResult.ok).toBe(false);
    expect(missingManifestResult.errors.join('\n')).toMatch(/appsscript\.json/);

    const missingDirResult = verifyGasBundle({ distDir: join(missingManifestDir, 'nope') });
    expect(missingDirResult.ok).toBe(false);
    expect(missingDirResult.errors.join('\n')).toMatch(/does not exist/i);
  });

  it('fails when doGet or doPost top-level globals are missing or not globally exposed', () => {
    const missingPostDir = createFixtureDir({
      'Code.js': 'function doGet() { return {}; }',
      'appsscript.json': VALID_MANIFEST,
    });
    const missingPostResult = verifyGasBundle({ distDir: missingPostDir });
    expect(missingPostResult.ok).toBe(false);
    expect(missingPostResult.errors.join('\n')).toMatch(/doPost/);

    const scopedOnlyDir = createFixtureDir({
      'Code.js': [
        '(() => {',
        '  function doGet() { return {}; }',
        '  function doPost() { return {}; }',
        '})();',
      ].join('\n'),
      'appsscript.json': VALID_MANIFEST,
    });
    const scopedOnlyResult = verifyGasBundle({ distDir: scopedOnlyDir });
    expect(scopedOnlyResult.ok).toBe(false);
    expect(scopedOnlyResult.errors.join('\n')).toMatch(/doGet/);
    expect(scopedOnlyResult.errors.join('\n')).toMatch(/doPost/);

    const varAssignedDir = createFixtureDir({
      'Code.js': [
        'var doGet = function () { return {}; };',
        'function doPost() { return {}; }',
      ].join('\n'),
      'appsscript.json': VALID_MANIFEST,
    });
    const varAssignedResult = verifyGasBundle({ distDir: varAssignedDir });
    expect(varAssignedResult.ok).toBe(false);
    expect(varAssignedResult.errors.join('\n')).toMatch(/doGet/);
  });

  it('fails when Code.js has a syntax error or appsscript.json is invalid JSON', () => {
    const syntaxErrorDir = createFixtureDir({
      'Code.js': 'function doGet( { return {}; }',
      'appsscript.json': VALID_MANIFEST,
    });
    const syntaxResult = verifyGasBundle({ distDir: syntaxErrorDir });
    expect(syntaxResult.ok).toBe(false);
    expect(syntaxResult.errors.join('\n')).toMatch(/Code\.js/);

    const invalidManifestDir = createFixtureDir({
      'Code.js': VALID_CODE,
      'appsscript.json': '{ not-valid-json',
    });
    const manifestResult = verifyGasBundle({ distDir: invalidManifestDir });
    expect(manifestResult.ok).toBe(false);
    expect(manifestResult.errors.join('\n')).toMatch(/appsscript\.json/);
  });

  it('fails when Code.js exceeds the size budget and passes at the exact limit', () => {
    const exactBytes = Buffer.byteLength(VALID_CODE, 'utf8');
    const dir = createFixtureDir({
      'Code.js': VALID_CODE,
      'appsscript.json': VALID_MANIFEST,
    });

    const atLimit = verifyGasBundle({ distDir: dir, maxBytes: exactBytes });
    expect(atLimit.ok).toBe(true);

    const overLimit = verifyGasBundle({ distDir: dir, maxBytes: exactBytes - 1 });
    expect(overLimit.ok).toBe(false);
    expect(overLimit.errors.join('\n')).toMatch(/size budget/i);
  });

  it('runs as a CLI exiting 0 on valid fixtures and 1 on invalid fixtures', () => {
    const validDir = createFixtureDir({
      'Code.js': VALID_CODE,
      'appsscript.json': VALID_MANIFEST,
    });

    const passRun = spawnSync(process.execPath, [scriptPath, '--dist', validDir], {
      encoding: 'utf8',
    });
    expect(passRun.status).toBe(0);
    expect(passRun.stdout).toMatch(/GAS bundle verified/i);

    const overBudgetRun = spawnSync(
      process.execPath,
      [scriptPath, '--dist', validDir, '--max-bytes', '10'],
      { encoding: 'utf8' },
    );
    expect(overBudgetRun.status).toBe(1);
    expect(overBudgetRun.stderr).toMatch(/size budget/i);
  });
});
