import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const backendDir = dirname(fileURLToPath(import.meta.url));

function createBackendEslint() {
  return new ESLint({ cwd: backendDir });
}

describe('backend ESLint GAS vs Node.js boundary', () => {
  it('rejects Node.js-only globals and node:* imports in GAS runtime source modules', async () => {
    const eslint = createBackendEslint();

    const [globalResult] = await eslint.lintText(
      [
        'export function readSecret(): string {',
        '  return Buffer.from(process.env.SECRET ?? "").toString("utf8");',
        '}',
      ].join('\n'),
      { filePath: `${backendDir}/src/sample.ts` },
    );

    const [importResult] = await eslint.lintText(
      ['import { readFileSync } from "node:fs";', 'export const reader = readFileSync;'].join('\n'),
      { filePath: `${backendDir}/src/sample.ts` },
    );

    expect(globalResult.errorCount).toBeGreaterThan(0);
    expect(importResult.errorCount).toBeGreaterThan(0);
  });

  it('allows ES2022 and GAS runtime usage in GAS source modules', async () => {
    const eslint = createBackendEslint();

    const [result] = await eslint.lintText(
      [
        'export function logSheetName(): string {',
        '  const name = SpreadsheetApp.openById("sheet-id").getName();',
        '  console.log(JSON.stringify({ name }));',
        '  return name;',
        '}',
      ].join('\n'),
      { filePath: `${backendDir}/src/sample.ts` },
    );

    expect(result.errorCount).toBe(0);
  });

  it('permits Node.js globals and node:* imports in Node.js build scripts', async () => {
    const eslint = createBackendEslint();

    const [result] = await eslint.lintText(
      [
        'import { resolve } from "node:path";',
        'export const target = resolve(process.cwd(), "dist");',
      ].join('\n'),
      { filePath: `${backendDir}/build.mjs` },
    );

    expect(result.errorCount).toBe(0);
  });
});
