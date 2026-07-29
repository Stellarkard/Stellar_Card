/**
 * Deployment logic for the Stellar_Card contract, as pure functions.
 *
 * The CLI entry point (`../deploy_testnet.mjs`) is a thin shell around this
 * module: it reads `process.argv`, prints, and spawns. Everything that decides
 * *what* should happen lives here, takes its inputs as arguments, and returns
 * values instead of calling `process.exit` — which is what makes it testable
 * without a Soroban toolchain, a network, or a built contract.
 *
 * Node compatibility: the workspace targets Node >= 18 and CI runs 18/20/22,
 * so this sticks to APIs stable in 18 (`node:util.parseArgs` landed in 18.3).
 * Nothing here uses `util.styleText`, which would need 20.12+.
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

/** Basename of the compiled contract artefact. */
export const WASM_BASENAME = 'stellar_card_receiver.wasm';

/** Network used when neither a flag nor an environment variable supplies one. */
export const DEFAULT_NETWORK = 'testnet';

/** Networks the Soroban CLI recognises by name without extra configuration. */
export const KNOWN_NETWORKS = Object.freeze(['testnet', 'futurenet', 'mainnet', 'local', 'standalone']);

/**
 * A configuration problem the user can fix — a missing source account, an
 * unparseable flag. Distinguished from a genuine crash so the CLI can print a
 * clean message rather than a stack trace.
 */
export class DeployConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeployConfigError';
  }
}

/** The `--help` text. Exported so a test can assert every flag is documented. */
export function helpText() {
  return `Stellar_Card contract deployment helper

Usage:
  node deploy_testnet.mjs [options]

Options:
  -n, --network <name>   Target network (default: ${DEFAULT_NETWORK})
  -s, --source <id>      Identity name or secret key to sign with
  -d, --dry-run          Build the contract but skip deployment
  -h, --help             Show this help and exit
  -v, --version          Print the helper version and exit

Environment variables (used when the matching flag is absent):
  SOURCE_ACCOUNT         Identity name or secret key to sign with
  NETWORK                Target network

Examples:
  node deploy_testnet.mjs --source alice
  node deploy_testnet.mjs --source alice --network futurenet
  SOURCE_ACCOUNT=alice node deploy_testnet.mjs --dry-run
`;
}

/**
 * Merge CLI flags and environment variables into a resolved configuration.
 *
 * Flags win over environment variables, which win over defaults. Does not
 * validate — call {@link validateConfig} for that — so `--help` still works
 * when no source account is set.
 *
 * @param {{argv?: string[], env?: Record<string, string|undefined>}} [input]
 * @returns {{network: string, source: string, dryRun: boolean, help: boolean, version: boolean}}
 */
export function resolveConfig({ argv = [], env = {} } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        network: { type: 'string', short: 'n' },
        source: { type: 'string', short: 's' },
        'dry-run': { type: 'boolean', short: 'd', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    // parseArgs throws for an unknown flag or a missing value. Rewrap it so
    // callers only ever have to handle one error type.
    throw new DeployConfigError(`${error.message}\n\n${helpText()}`);
  }

  return {
    network: values.network ?? env.NETWORK ?? DEFAULT_NETWORK,
    source: values.source ?? env.SOURCE_ACCOUNT ?? '',
    dryRun: values['dry-run'],
    help: values.help,
    version: values.version,
  };
}

/**
 * Throw if the resolved configuration cannot produce a deployment.
 *
 * @param {{network: string, source: string}} config
 * @throws {DeployConfigError}
 */
export function validateConfig(config) {
  if (!config.source) {
    throw new DeployConfigError(
      'No source account supplied.\n' +
        '  Pass --source <identity> or set the SOURCE_ACCOUNT environment variable.\n' +
        '  Example: node deploy_testnet.mjs --source alice',
    );
  }

  if (!config.network) {
    throw new DeployConfigError('Network resolved to an empty string.');
  }

  // Deliberately not an error: the Soroban CLI supports arbitrary named
  // networks from its own config, so rejecting an unknown name here would
  // break a legitimate custom setup. A warning is the right strength.
  return {
    warnings: KNOWN_NETWORKS.includes(config.network)
      ? []
      : [
          `Network '${config.network}' is not one of the well-known names ` +
            `(${KNOWN_NETWORKS.join(', ')}). Continuing — make sure it is configured in your Soroban CLI.`,
        ],
  };
}

/**
 * Locate the contract directory and its build artefact.
 *
 * @param {string} projectRoot Absolute path to the repository root.
 */
export function contractPaths(projectRoot) {
  const contractDir = resolve(projectRoot, 'stellar_card-contract');
  return {
    contractDir,
    wasmFile: resolve(contractDir, 'target', 'wasm32-unknown-unknown', 'release', WASM_BASENAME),
  };
}

/**
 * The `soroban contract build` invocation.
 *
 * @returns {{file: string, args: string[]}}
 */
export function buildCommand() {
  return { file: 'soroban', args: ['contract', 'build'] };
}

/**
 * The `soroban contract deploy` invocation.
 *
 * @param {{wasmFile: string, source: string, network: string}} input
 * @returns {{file: string, args: string[]}}
 */
export function deployCommand({ wasmFile, source, network }) {
  if (!wasmFile) throw new DeployConfigError('deployCommand requires a wasmFile');
  if (!source) throw new DeployConfigError('deployCommand requires a source');
  if (!network) throw new DeployConfigError('deployCommand requires a network');

  return {
    file: 'soroban',
    args: ['contract', 'deploy', '--wasm', wasmFile, '--source', source, '--network', network],
  };
}

/**
 * The banner shown before work starts.
 *
 * A secret key passed via `--source` would otherwise be echoed to the terminal
 * and into any CI log, so it is masked. Identity *names* are not secret and
 * are shown in full, since seeing which identity is about to sign is the whole
 * point of the line.
 *
 * @param {{network: string, source: string, dryRun: boolean}} config
 */
export function formatBanner({ network, source, dryRun }) {
  const lines = [
    '=============================================',
    '   Stellar_Card Contract Deployment Script   ',
    '=============================================',
    `Network : ${network}`,
    `Source  : ${maskSecret(source)}`,
  ];
  if (dryRun) lines.push('Mode    : DRY RUN (skip actual deploy)');
  return lines.join('\n');
}

/**
 * Mask anything that looks like a Stellar secret key.
 *
 * Stellar secret seeds are 56 characters starting with `S`. Identity names
 * configured in the Soroban CLI are short and arbitrary, so the check is
 * shape-based rather than a guess at intent.
 */
export function maskSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  if (/^S[A-Z2-7]{55}$/.test(value)) {
    return `${value.slice(0, 4)}…${value.slice(-4)} (secret key, masked)`;
  }
  return value;
}
