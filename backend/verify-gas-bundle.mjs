import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const backendDir = fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_DIST_DIR = resolve(backendDir, 'dist');
const DEFAULT_MAX_BUNDLE_BYTES = 100 * 1024;
const REQUIRED_FILES = ['Code.js', 'appsscript.json'];
const REQUIRED_ENTRYPOINTS = ['doGet', 'doPost'];

function formatError(err) {
  return err instanceof Error ? err.message : String(err);
}

function isRegularFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

function failureResult(errors, maxBytes) {
  return {
    ok: false,
    errors,
    files: [],
    entrypoints: [],
    bundleBytes: 0,
    maxBytes,
  };
}

function hasTopLevelFunctionDeclaration(source, name) {
  return new RegExp(`^function\\s+${name}\\s*\\(`, 'm').test(source);
}

export function verifyGasBundle({
  distDir = DEFAULT_DIST_DIR,
  maxBytes = DEFAULT_MAX_BUNDLE_BYTES,
} = {}) {
  const errors = [];

  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    return failureResult(
      [`Invalid maxBytes budget: ${String(maxBytes)} (expected a positive integer)`],
      maxBytes,
    );
  }

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    return failureResult([`Bundle directory does not exist: ${distDir}`], maxBytes);
  }

  const entries = readdirSync(distDir).sort();
  const requiredSet = new Set(REQUIRED_FILES);

  const missingFiles = REQUIRED_FILES.filter((name) => !entries.includes(name));
  if (missingFiles.length > 0) {
    errors.push(`Missing required bundle file(s): ${missingFiles.join(', ')}`);
  }

  const extraEntries = entries.filter((name) => !requiredSet.has(name));
  if (extraEntries.length > 0) {
    errors.push(`Unexpected extra file(s) in bundle output: ${extraEntries.join(', ')}`);
  }

  for (const name of REQUIRED_FILES) {
    if (entries.includes(name) && !isRegularFile(join(distDir, name))) {
      errors.push(`Expected "${name}" to be a regular file`);
    }
  }

  const manifestPath = join(distDir, 'appsscript.json');
  if (isRegularFile(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push('Invalid appsscript.json: expected a JSON object');
      }
    } catch (err) {
      errors.push(`Invalid appsscript.json: ${formatError(err)}`);
    }
  }

  const codePath = join(distDir, 'Code.js');
  let codeSize = 0;
  const foundEntrypoints = [];

  if (isRegularFile(codePath)) {
    const codeSource = readFileSync(codePath, 'utf8');
    codeSize = Buffer.byteLength(codeSource, 'utf8');

    if (codeSize > maxBytes) {
      errors.push(`Code.js exceeds size budget: ${codeSize} bytes > ${maxBytes} bytes`);
    }

    try {
      const sandbox = vm.createContext({});
      vm.runInContext(codeSource, sandbox, { filename: 'Code.js', timeout: 1000 });

      for (const entrypoint of REQUIRED_ENTRYPOINTS) {
        if (
          typeof sandbox[entrypoint] === 'function' &&
          hasTopLevelFunctionDeclaration(codeSource, entrypoint)
        ) {
          foundEntrypoints.push(entrypoint);
        } else {
          errors.push(
            `Missing top-level global entrypoint function declaration in Code.js: ${entrypoint}`,
          );
        }
      }
    } catch (err) {
      errors.push(`Failed to evaluate Code.js bundle: ${formatError(err)}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    files: entries,
    entrypoints: foundEntrypoints,
    bundleBytes: codeSize,
    maxBytes,
  };
}

function parseCliArgs(argv) {
  let distDir = DEFAULT_DIST_DIR;
  let maxBytes = DEFAULT_MAX_BUNDLE_BYTES;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --dist');
      }
      distDir = resolve(next);
      i += 1;
    } else if (arg === '--max-bytes') {
      const next = argv[i + 1];
      if (!next || !/^\d+$/.test(next)) {
        throw new Error(`Invalid value for --max-bytes: ${String(next)}`);
      }
      maxBytes = Number.parseInt(next, 10);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { distDir, maxBytes };
}

function runCli() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`GAS bundle verification failed:\n- ${formatError(err)}`);
    process.exitCode = 1;
    return;
  }

  const result = verifyGasBundle(options);
  if (!result.ok) {
    console.error(
      `GAS bundle verification failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `GAS bundle verified: files=[${result.files.join(', ')}], entrypoints=[${result.entrypoints.join(', ')}], size=${result.bundleBytes}/${result.maxBytes} bytes`,
  );
}

const isMainModule =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runCli();
}
