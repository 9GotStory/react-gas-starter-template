import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { verifyGasBundle } from '../backend/verify-gas-bundle.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT_DIR = resolve(scriptsDir, '..');

const VALID_ENVS = new Set(['staging', 'prod']);
const VALID_ACTIONS = new Set(['push', 'deploy']);

const CLASP_FILES = {
  staging: '.clasp.staging.json',
  prod: '.clasp.prod.json',
};

const ENV_FILES = {
  staging: '.env.staging',
  prod: '.env.prod',
};

const ISOLATION_FIELDS = [
  { key: 'scriptId', label: 'scriptId' },
  { key: 'deploymentId', label: 'deploymentId' },
  { key: 'spreadsheetId', label: 'SPREADSHEET_ID' },
];

const VALUE_FLAGS = {
  '--env': 'env',
  '--action': 'action',
  '--version': 'version',
  '--description': 'description',
  '--confirm': 'confirm',
  '--root': 'rootDir',
};

const PLACEHOLDER_RE =
  /^(?:YOUR_[A-Z0-9_]+|REPLACE_[A-Z0-9_]+|CHANGEME|<[^>]+>|TODO_[A-Z0-9_]+|EXAMPLE_[A-Z0-9_]+)$/i;

const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function formatError(err) {
  return err instanceof Error ? err.message : String(err);
}

function isRegularFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

function isPlaceholder(value) {
  return PLACEHOLDER_RE.test(value.trim());
}

function isCiEnvironment(envVars) {
  const ci = String(envVars?.CI ?? '').toLowerCase();
  const gh = String(envVars?.GITHUB_ACTIONS ?? '').toLowerCase();
  return ci === 'true' || ci === '1' || gh === 'true';
}

export function expectedConfirmationPhrase(action, version) {
  if (action === 'deploy') {
    return `DEPLOY PROD ${String(version ?? '').trim()}`;
  }
  return 'PUSH PROD';
}

export function maskId(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '<unset>';
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '****';
  }
  return `****${trimmed.slice(-4)}`;
}

function parseDotEnvFile(filePath) {
  const vars = {};
  if (!isRegularFile(filePath)) {
    return { exists: false, vars };
  }

  const lines = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      vars[key] = value.trim();
    }
  }

  return { exists: true, vars };
}

function loadEnvironmentConfig(rootDir, envName) {
  const backendDir = join(rootDir, 'backend');
  const claspFileName = CLASP_FILES[envName];
  const claspPath = join(backendDir, claspFileName);
  const envFileName = ENV_FILES[envName];
  const envFilePath = join(backendDir, envFileName);

  const parseErrors = [];
  let claspJson = null;
  const claspExists = isRegularFile(claspPath);

  if (claspExists) {
    try {
      const parsed = JSON.parse(readFileSync(claspPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        parseErrors.push(`Invalid JSON object in backend/${claspFileName}`);
      } else {
        claspJson = parsed;
      }
    } catch (err) {
      parseErrors.push(`Failed to parse backend/${claspFileName}: ${formatError(err)}`);
    }
  }

  const envFile = parseDotEnvFile(envFilePath);

  const scriptId = typeof claspJson?.scriptId === 'string' ? claspJson.scriptId.trim() : '';
  const srcDir =
    typeof claspJson?.srcDir === 'string'
      ? claspJson.srcDir.trim()
      : typeof claspJson?.rootDir === 'string'
        ? claspJson.rootDir.trim()
        : '';

  const deploymentId = (envFile.vars.GAS_DEPLOYMENT_ID ?? '').trim();
  const spreadsheetId = (envFile.vars.SPREADSHEET_ID ?? '').trim();

  return {
    envName,
    claspFileName,
    claspExists,
    envFileName,
    hasAnyConfig: claspExists || envFile.exists,
    scriptId,
    srcDir,
    deploymentId,
    spreadsheetId,
    parseErrors,
  };
}

function validateRequiredEnvConfig(config, { requireDeploymentId }) {
  const errors = [...config.parseErrors];
  const label = config.envName === 'prod' ? 'Production' : 'Staging';

  if (!config.claspExists) {
    errors.push(
      `Missing ${label} clasp config: backend/${config.claspFileName} (copy backend/.clasp.json.example and set ${label} scriptId)`,
    );
  } else if (config.parseErrors.length === 0) {
    if (!config.scriptId || isPlaceholder(config.scriptId)) {
      errors.push(
        `Invalid or placeholder scriptId in backend/${config.claspFileName} for ${label}`,
      );
    }

    const normalizedSrcDir = config.srcDir.replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalizedSrcDir !== 'dist') {
      errors.push(
        `backend/${config.claspFileName} must set srcDir/rootDir to "dist" (got ${JSON.stringify(config.srcDir || '')})`,
      );
    }
  }

  if (!config.spreadsheetId || isPlaceholder(config.spreadsheetId)) {
    errors.push(
      `Missing or placeholder SPREADSHEET_ID for ${label} (set SPREADSHEET_ID in backend/${config.envFileName})`,
    );
  }

  if (requireDeploymentId) {
    if (!config.deploymentId || isPlaceholder(config.deploymentId)) {
      errors.push(
        `Missing or placeholder deploymentId for ${label} (set GAS_DEPLOYMENT_ID in backend/${config.envFileName})`,
      );
    }
  } else if (config.deploymentId && isPlaceholder(config.deploymentId)) {
    errors.push(
      `Placeholder deploymentId in ${label} config (leave GAS_DEPLOYMENT_ID blank before initial create-deployment or set the real ID in backend/${config.envFileName})`,
    );
  }

  return errors;
}

function validateEnvironmentIsolation(stagingConfig, prodConfig, { targetEnv, action }) {
  const errors = [];

  if (targetEnv === 'prod') {
    const stagingErrors = validateRequiredEnvConfig(stagingConfig, {
      requireDeploymentId: action === 'deploy',
    });
    if (stagingErrors.length > 0) {
      errors.push(
        ...stagingErrors.map(
          (err) => `Production isolation check requires valid Staging config: ${err}`,
        ),
      );
    }
  } else if (prodConfig.hasAnyConfig && prodConfig.parseErrors.length > 0) {
    errors.push(...prodConfig.parseErrors);
  }

  for (const { key, label } of ISOLATION_FIELDS) {
    const stagingValue = stagingConfig[key];
    const prodValue = prodConfig[key];
    if (stagingValue && prodValue && stagingValue === prodValue) {
      errors.push(
        `Environment isolation violation: Staging and Production ${label} must be distinct (both resolve to ${maskId(stagingValue)})`,
      );
    }
  }

  return errors;
}

export function parseVersionNumber(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.versionNumber === 'number' && Number.isInteger(parsed.versionNumber)) {
      return parsed.versionNumber;
    }
    if (typeof parsed?.versionNumber === 'string' && /^\d+$/.test(parsed.versionNumber)) {
      return Number.parseInt(parsed.versionNumber, 10);
    }
  } catch {
    // Fallback to text parsing when clasp emits non-JSON output
  }

  const match = trimmed.match(/Created version\s+(\d+)/i);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return null;
}

function runSpawn(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? formatError(result.error) : ''),
  };
}

function defaultRunBuild(rootDir) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return runSpawn(npmCmd, ['run', 'build'], rootDir);
}

function defaultRunGit(args, rootDir) {
  return runSpawn('git', args, rootDir);
}

function defaultRunClasp(args, backendDir) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return runSpawn(npxCmd, ['--no-install', 'clasp', ...args], backendDir);
}

function runClaspStep({ runClasp, args, stepName, plannedCommands, targetSummary }) {
  const res = runClasp(args);
  if (!res.ok) {
    const detail = (res.stderr || res.stdout || 'unknown clasp error').trim();
    return {
      ok: false,
      failure: {
        ok: false,
        errors: [`clasp ${stepName} failed: ${detail}`],
        targetSummary,
        plannedCommands,
      },
    };
  }
  return { ok: true, res };
}

export async function runGasDeployGuard({
  rootDir = DEFAULT_ROOT_DIR,
  env,
  action,
  version = '',
  description = '',
  confirm = '',
  dryRun = false,
  confirmPrompt = null,
  envVars = process.env,
  runBuild = () => defaultRunBuild(rootDir),
  runGit = (args) => defaultRunGit(args, rootDir),
  runClasp = (args) => defaultRunClasp(args, join(rootDir, 'backend')),
} = {}) {
  const errors = [];

  if (!VALID_ENVS.has(env)) {
    errors.push(`Invalid --env "${String(env ?? '')}" (expected "staging" or "prod")`);
  }
  if (!VALID_ACTIONS.has(action)) {
    errors.push(`Invalid --action "${String(action ?? '')}" (expected "push" or "deploy")`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, plannedCommands: [] };
  }

  if (env === 'prod' && isCiEnvironment(envVars)) {
    return {
      ok: false,
      errors: [
        'Production deployment is blocked in CI: merging into main must never auto-deploy Production (run manually from a clean local checkout per ADR-0006)',
      ],
      plannedCommands: [],
    };
  }

  const stagingConfig = loadEnvironmentConfig(rootDir, 'staging');
  const prodConfig = loadEnvironmentConfig(rootDir, 'prod');
  const targetConfig = env === 'prod' ? prodConfig : stagingConfig;

  errors.push(
    ...validateRequiredEnvConfig(targetConfig, {
      requireDeploymentId: action === 'deploy',
    }),
  );
  errors.push(
    ...validateEnvironmentIsolation(stagingConfig, prodConfig, {
      targetEnv: env,
      action,
    }),
  );

  if (env === 'prod') {
    if (action === 'deploy' && !SEMVER_RE.test(version.trim())) {
      errors.push(
        `Production deploy requires a valid SemVer --version (e.g. --version v1.0.0; got ${JSON.stringify(version)})`,
      );
    }

    const gitStatusRes = runGit(['status', '--porcelain']);
    if (!gitStatusRes.ok) {
      const detail = (gitStatusRes.stderr || gitStatusRes.stdout || 'git status failed').trim();
      errors.push(`Could not verify clean Git working tree before Production ${action}: ${detail}`);
    } else if (gitStatusRes.stdout.trim().length > 0) {
      errors.push(
        `Production ${action} requires a clean Git working tree (commit or stash uncommitted changes first)`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, plannedCommands: [] };
  }

  if (env === 'prod') {
    const expectedPhrase = expectedConfirmationPhrase(action, version);
    let provided = confirm.trim();
    if (!provided && typeof confirmPrompt === 'function') {
      provided = String((await confirmPrompt(expectedPhrase)) ?? '').trim();
    }
    if (provided !== expectedPhrase) {
      return {
        ok: false,
        errors: [
          `Production ${action} aborted: explicit confirmation required. Re-run interactively or pass --confirm "${expectedPhrase}"`,
        ],
        plannedCommands: [],
      };
    }
  }

  const gitShaRes = runGit(['rev-parse', '--short', 'HEAD']);
  const shortSha = gitShaRes.ok ? gitShaRes.stdout.trim() : '';

  const buildRes = runBuild();
  if (!buildRes.ok) {
    const detail = (buildRes.stderr || buildRes.stdout || 'unknown build error').trim();
    return {
      ok: false,
      errors: [`Production build failed before clasp push: ${detail}`],
      plannedCommands: [],
    };
  }

  const distDir = join(rootDir, 'backend', 'dist');
  const bundleResult = verifyGasBundle({ distDir });
  if (!bundleResult.ok) {
    return {
      ok: false,
      errors: bundleResult.errors.map((err) => `GAS bundle verification failed: ${err}`),
      plannedCommands: [],
    };
  }

  const claspFlag = ['-P', targetConfig.claspFileName];
  const targetSummary = {
    env,
    claspFile: `backend/${targetConfig.claspFileName}`,
    scriptId: maskId(targetConfig.scriptId),
    deploymentId: maskId(targetConfig.deploymentId),
    spreadsheetId: maskId(targetConfig.spreadsheetId),
  };

  // Pass -f so non-interactive piped `clasp push` deterministically uploads manifest updates
  // after verifyGasBundle and deployment guards have already validated backend/dist/.
  const pushArgs = [...claspFlag, 'push', '-f'];

  if (action === 'push') {
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        errors: [],
        env,
        action,
        targetSummary,
        plannedCommands: [pushArgs],
      };
    }

    const pushStep = runClaspStep({
      runClasp,
      args: pushArgs,
      stepName: 'push',
      plannedCommands: [pushArgs],
      targetSummary,
    });
    if (!pushStep.ok) {
      return pushStep.failure;
    }

    return {
      ok: true,
      dryRun: false,
      errors: [],
      env,
      action,
      targetSummary,
      plannedCommands: [pushArgs],
    };
  }

  const effectiveDescription =
    description.trim() ||
    (version.trim()
      ? shortSha
        ? `${version.trim()} (${shortSha})`
        : version.trim()
      : shortSha
        ? `${env} (${shortSha})`
        : `${env} deployment`);

  const createVersionArgs = [...claspFlag, '--json', 'create-version', effectiveDescription];

  if (dryRun) {
    const plannedUpdateArgs = [
      ...claspFlag,
      'update-deployment',
      targetConfig.deploymentId,
      '-V',
      '<createdVersionNumber>',
      '-d',
      effectiveDescription,
    ];
    return {
      ok: true,
      dryRun: true,
      errors: [],
      env,
      action,
      description: effectiveDescription,
      targetSummary,
      plannedCommands: [pushArgs, createVersionArgs, plannedUpdateArgs],
    };
  }

  const pushStep = runClaspStep({
    runClasp,
    args: pushArgs,
    stepName: 'push',
    plannedCommands: [pushArgs],
    targetSummary,
  });
  if (!pushStep.ok) {
    return pushStep.failure;
  }

  const versionStep = runClaspStep({
    runClasp,
    args: createVersionArgs,
    stepName: 'create-version',
    plannedCommands: [pushArgs, createVersionArgs],
    targetSummary,
  });
  if (!versionStep.ok) {
    return versionStep.failure;
  }

  const versionNumber = parseVersionNumber(versionStep.res.stdout);
  if (versionNumber === null) {
    return {
      ok: false,
      errors: [
        `Could not parse GAS versionNumber from clasp create-version output: ${versionStep.res.stdout.trim()}`,
      ],
      targetSummary,
      plannedCommands: [pushArgs, createVersionArgs],
    };
  }

  const updateArgs = [
    ...claspFlag,
    'update-deployment',
    targetConfig.deploymentId,
    '-V',
    String(versionNumber),
    '-d',
    effectiveDescription,
  ];
  const updateStep = runClaspStep({
    runClasp,
    args: updateArgs,
    stepName: 'update-deployment',
    plannedCommands: [pushArgs, createVersionArgs, updateArgs],
    targetSummary,
  });
  if (!updateStep.ok) {
    return updateStep.failure;
  }

  return {
    ok: true,
    dryRun: false,
    errors: [],
    env,
    action,
    versionNumber,
    description: effectiveDescription,
    targetSummary,
    plannedCommands: [pushArgs, createVersionArgs, updateArgs],
  };
}

function formatClaspCommandForDisplay(args) {
  const sanitized = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (i > 0 && args[i - 1] === 'update-deployment') {
      sanitized.push(maskId(arg));
    } else if (/\s/.test(arg)) {
      sanitized.push(JSON.stringify(arg));
    } else {
      sanitized.push(arg);
    }
  }
  return `clasp ${sanitized.join(' ')}`;
}

function parseCliArgs(argv) {
  const options = {
    rootDir: DEFAULT_ROOT_DIR,
    env: '',
    action: '',
    version: '',
    description: '',
    confirm: '',
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (Object.hasOwn(VALUE_FLAGS, arg)) {
      const next = argv[i + 1];
      if (!next) {
        throw new Error(`Missing value for ${arg}`);
      }
      const field = VALUE_FLAGS[arg];
      options[field] = field === 'rootDir' ? resolve(next) : next;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/gas-deploy.mjs --env <staging|prod> --action <push|deploy> [options]',
      '',
      'Options:',
      '  --env <staging|prod>      Target environment (uses backend/.clasp.<env>.json via clasp -P)',
      '  --action <push|deploy>    push (build + verify + clasp push -f) or deploy (immutable versioned deployment)',
      '  --version <semver>        Release version (required for prod deploy, e.g. v1.0.0)',
      '  --description <text>      Custom version/deployment description',
      '  --confirm <phrase>        Explicit confirmation phrase for prod ("DEPLOY PROD <version>" or "PUSH PROD")',
      '  --dry-run                 Run all guards, build, and bundle checks without invoking clasp',
      '  --root <dir>              Override repository root directory',
      '  -h, --help                Show this help message',
    ].join('\n'),
  );
}

async function promptInteractiveConfirmation(expectedPhrase) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return '';
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`Type "${expectedPhrase}" to proceed with Production deployment: `);
  } finally {
    rl.close();
  }
}

async function runCli() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`gas-deploy failed:\n- ${formatError(err)}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const result = await runGasDeployGuard({
    rootDir: options.rootDir,
    env: options.env,
    action: options.action,
    version: options.version,
    description: options.description,
    confirm: options.confirm,
    dryRun: options.dryRun,
    confirmPrompt: promptInteractiveConfirmation,
  });

  if (!result.ok) {
    console.error(`gas-deploy failed:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  const { targetSummary } = result;
  if (result.dryRun) {
    console.log(
      `gas-deploy dry-run passed (env=${targetSummary.env}, config=${targetSummary.claspFile}, scriptId=${targetSummary.scriptId}, deploymentId=${targetSummary.deploymentId}, spreadsheetId=${targetSummary.spreadsheetId})`,
    );
    console.log('Planned commands (not executed):');
    for (const cmd of result.plannedCommands) {
      console.log(`  ${formatClaspCommandForDisplay(cmd)}`);
    }
    return;
  }

  if (result.action === 'deploy') {
    console.log(
      `gas-deploy succeeded (env=${targetSummary.env}, version=${result.versionNumber}, description=${JSON.stringify(result.description)}, deploymentId=${targetSummary.deploymentId})`,
    );
  } else {
    console.log(
      `gas-deploy push succeeded (env=${targetSummary.env}, config=${targetSummary.claspFile}, scriptId=${targetSummary.scriptId})`,
    );
  }
}

const isMainModule =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await runCli();
}
