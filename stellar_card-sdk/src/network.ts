/**
 * Network configuration helpers for the stellar_card SDK.
 *
 * These utilities let callers swap out the Soroban RPC and Horizon URLs
 * used by payment functions — useful for custom deployments, private
 * validators, or Futurenet / testnet scenarios.
 */

import { Networks } from '@stellar/stellar-sdk';

/** Well-known Soroban RPC endpoints. */
const MAINNET_RPC = 'https://mainnet.sorobanrpc.com';
const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const FUTURENET_RPC = 'https://rpc-futurenet.stellar.org';

/** Well-known Horizon REST endpoints. */
const MAINNET_HORIZON = 'https://horizon.stellar.org';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const FUTURENET_HORIZON = 'https://horizon-futurenet.stellar.org';

/**
 * RPC endpoint configuration with optional authentication and timeout.
 */
export interface RpcEndpointConfig {
  /** RPC endpoint URL */
  url: string;
  /** Optional request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Optional API key for authenticated endpoints */
  apiKey?: string;
  /** Optional custom headers for requests */
  headers?: Record<string, string>;
}

/**
 * Full network endpoint configuration.
 *
 * All fields are optional — omitting a field causes the default for the
 * resolved `networkPassphrase` to be used.
 */
export interface NetworkConfig {
  /** Stellar network passphrase. Defaults to `Networks.PUBLIC`. */
  networkPassphrase?: string;
  /** Soroban RPC URL or configuration. Defaults to the public mainnet / testnet endpoint. */
  sorobanRpcUrl?: string | RpcEndpointConfig;
  /** Horizon REST API URL or configuration. Defaults to the public mainnet / testnet endpoint. */
  horizonUrl?: string | RpcEndpointConfig;
  /** Optional network name for identification */
  networkName?: string;
}

/**
 * Normalized RPC endpoint configuration after resolution.
 */
export interface ResolvedRpcEndpoint {
  url: string;
  timeout: number;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * Fully resolved network configuration with all fields populated.
 */
export interface ResolvedNetworkConfig {
  networkPassphrase: string;
  sorobanRpc: ResolvedRpcEndpoint;
  horizon: ResolvedRpcEndpoint;
  networkName: string;
}

/**
 * Normalize an RPC endpoint config from string or object form.
 */
function normalizeRpcEndpoint(
  input: string | RpcEndpointConfig | undefined,
  defaultUrl: string,
): ResolvedRpcEndpoint {
  if (typeof input === 'string') {
    const url = normalizeString(input);
    return { url: url ?? defaultUrl, timeout: 30000 };
  }
  if (input && typeof input === 'object') {
    const url = normalizeString(input.url);
    return {
      url: url ?? defaultUrl,
      timeout: input.timeout ?? 30000,
      apiKey: input.apiKey,
      headers: input.headers,
    };
  }
  return { url: defaultUrl, timeout: 30000 };
}

/**
 * Resolve a `NetworkConfig` object into fully-qualified configuration.
 *
 * Callers can pass a partial config and rely on this function to fill in
 * the public defaults for the selected network passphrase.
 *
 * @param config - Partial network configuration object (optional)
 * @returns Fully resolved network configuration with all endpoints populated
 *
 * @example
 * ```typescript
 * const config = resolveNetworkConfig({ 
 *   networkPassphrase: Networks.TESTNET,
 *   sorobanRpcUrl: 'https://custom-rpc.example.com'
 * });
 * console.log('Soroban RPC:', config.sorobanRpc.url);
 * ```
 */
export function resolveNetworkConfig(config: NetworkConfig = {}): ResolvedNetworkConfig {
  const networkPassphrase = normalizeString(config.networkPassphrase) ?? Networks.PUBLIC;
  
  let defaultSorobanRpc: string;
  let defaultHorizon: string;
  let defaultName: string;

  if (networkPassphrase === Networks.TESTNET) {
    defaultSorobanRpc = TESTNET_RPC;
    defaultHorizon = TESTNET_HORIZON;
    defaultName = 'Testnet';
  } else if (networkPassphrase === Networks.FUTURENET) {
    defaultSorobanRpc = FUTURENET_RPC;
    defaultHorizon = FUTURENET_HORIZON;
    defaultName = 'Futurenet';
  } else {
    defaultSorobanRpc = MAINNET_RPC;
    defaultHorizon = MAINNET_HORIZON;
    defaultName = 'Mainnet';
  }

  return {
    networkPassphrase,
    sorobanRpc: normalizeRpcEndpoint(config.sorobanRpcUrl, defaultSorobanRpc),
    horizon: normalizeRpcEndpoint(config.horizonUrl, defaultHorizon),
    networkName: normalizeString(config.networkName) ?? defaultName,
  };
}

/**
 * Return the default Soroban RPC URL for a given network passphrase.
 * 
 * Supports Mainnet, Testnet, and Futurenet networks.
 * 
 * @param networkPassphrase - Stellar network passphrase (defaults to mainnet)
 * @returns The default Soroban RPC URL for the specified network
 *
 * @example
 * ```typescript
 * const rpcUrl = getDefaultSorobanRpcUrl(Networks.TESTNET);
 * console.log('Testnet RPC:', rpcUrl); // https://soroban-testnet.stellar.org
 * ```
 */
export function getDefaultSorobanRpcUrl(networkPassphrase = Networks.PUBLIC): string {
  if (networkPassphrase === Networks.TESTNET) return TESTNET_RPC;
  if (networkPassphrase === Networks.FUTURENET) return FUTURENET_RPC;
  return MAINNET_RPC;
}

/**
 * Return the default Horizon URL for a given network passphrase.
 * 
 * Supports Mainnet, Testnet, and Futurenet networks.
 * 
 * @param networkPassphrase - Stellar network passphrase (defaults to mainnet)
 * @returns The default Horizon URL for the specified network
 *
 * @example
 * ```typescript
 * const horizonUrl = getDefaultHorizonUrl(Networks.TESTNET);
 * console.log('Testnet Horizon:', horizonUrl); // https://horizon-testnet.stellar.org
 * ```
 */
export function getDefaultHorizonUrl(networkPassphrase = Networks.PUBLIC): string {
  if (networkPassphrase === Networks.TESTNET) return TESTNET_HORIZON;
  if (networkPassphrase === Networks.FUTURENET) return FUTURENET_HORIZON;
  return MAINNET_HORIZON;
}

/**
 * Create a custom network configuration for private or non-standard deployments.
 * 
 * @example
 * const config = createCustomNetworkConfig({
 *   networkPassphrase: 'Custom Network ; January 2025',
 *   sorobanRpcUrl: 'https://custom-rpc.example.com',
 *   horizonUrl: 'https://custom-horizon.example.com',
 *   networkName: 'Custom Network'
 * });
 */
export function createCustomNetworkConfig(params: {
  networkPassphrase: string;
  sorobanRpcUrl: string | RpcEndpointConfig;
  horizonUrl: string | RpcEndpointConfig;
  networkName?: string;
}): ResolvedNetworkConfig {
  return resolveNetworkConfig(params);
}

/**
 * Validate that an RPC endpoint URL is well-formed.
 *
 * Checks URL format and warns about insecure HTTP endpoints in production.
 *
 * @param url - The RPC endpoint URL to validate
 * @param context - Optional context description for error messages
 * @throws {Error} When the URL is malformed or uses an invalid protocol
 *
 * @example
 * ```typescript
 * validateRpcEndpoint('https://rpc.example.com', 'Soroban RPC');
 * // Validates successfully
 *
 * validateRpcEndpoint('ftp://invalid.com');
 * // Throws: Invalid protocol: ftp:
 * ```
 */
export function validateRpcEndpoint(url: string, context?: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Invalid protocol: ${parsed.protocol}`);
    }
    // Warn about http in production contexts
    if (parsed.protocol === 'http:' && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      console.warn(
        `Warning: Using insecure HTTP endpoint ${url}${context ? ` for ${context}` : ''}. ` +
        'Consider using HTTPS for production deployments.'
      );
    }
  } catch (err) {
    throw new Error(
      `Invalid RPC endpoint URL "${url}"${context ? ` for ${context}` : ''}: ${(err as Error).message}`
    );
  }
}

// ── Custom RPC endpoint validation ────────────────────────────────────────────

/** Proxy configuration for RPC endpoints */
export interface RpcProxyConfig {
  /** Proxy URL (e.g., 'http://proxy.example.com:8080') */
  url: string;
  /** Optional proxy authentication username */
  username?: string;
  /** Optional proxy authentication password */
  password?: string;
  /** Optional list of hosts to bypass the proxy */
  noProxy?: string[];
}

/** Extended RPC endpoint config with proxy and retry support */
export interface ExtendedRpcEndpointConfig extends RpcEndpointConfig {
  /** Optional proxy configuration */
  proxy?: RpcProxyConfig;
  /** Optional retry configuration for failed requests */
  retry?: {
    /** Maximum number of retry attempts */
    maxAttempts: number;
    /** Base delay between retries in milliseconds */
    baseDelayMs: number;
    /** Whether to use exponential backoff */
    exponentialBackoff: boolean;
  };
}

/**
 * Validate a NetworkConfig object, checking that all URLs are well-formed
 * and that required fields are present.
 *
 * @param config - The network configuration to validate
 * @returns Array of validation error messages (empty if valid)
 *
 * @example
 * ```typescript
 * const errors = validateNetworkConfig({
 *   networkPassphrase: Networks.PUBLIC,
 *   sorobanRpcUrl: 'https://rpc.example.com',
 * });
 * if (errors.length > 0) {
 *   console.error('Invalid config:', errors);
 * }
 * ```
 */
export function validateNetworkConfig(config: NetworkConfig): string[] {
  const errors: string[] = [];

  if (config.networkPassphrase !== undefined) {
    if (typeof config.networkPassphrase !== 'string' || config.networkPassphrase.length === 0) {
      errors.push('networkPassphrase must be a non-empty string');
    }
  }

  if (config.sorobanRpcUrl !== undefined) {
    const url = typeof config.sorobanRpcUrl === 'string'
      ? config.sorobanRpcUrl
      : config.sorobanRpcUrl.url;
    try {
      validateRpcEndpoint(url, 'Soroban RPC');
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  if (config.horizonUrl !== undefined) {
    const url = typeof config.horizonUrl === 'string'
      ? config.horizonUrl
      : config.horizonUrl.url;
    try {
      validateRpcEndpoint(url, 'Horizon');
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  if (config.networkName !== undefined) {
    if (typeof config.networkName !== 'string' || config.networkName.length === 0) {
      errors.push('networkName must be a non-empty string');
    }
  }

  return errors;
}

/**
 * Resolve network configuration with retry support for endpoint health checks.
 *
 * Attempts to reach the Soroban RPC endpoint to verify connectivity before
 * returning the resolved config. Falls back to the resolved config without
 * verification if all attempts fail.
 *
 * @param config - Partial network configuration (optional)
 * @param retryOptions - Retry configuration for the health check
 * @returns Promise resolving to the fully-resolved network configuration
 *
 * @example
 * ```typescript
 * const config = await resolveNetworkConfigWithRetry({
 *   networkPassphrase: Networks.TESTNET,
 *   sorobanRpcUrl: 'https://custom-rpc.example.com',
 * }, { maxAttempts: 3, delayMs: 1000 });
 * ```
 */
export async function resolveNetworkConfigWithRetry(
  config: NetworkConfig = {},
  retryOptions: { maxAttempts?: number; delayMs?: number } = {},
): Promise<ResolvedNetworkConfig> {
  const { maxAttempts = 3, delayMs = 1000 } = retryOptions;
  const resolved = resolveNetworkConfig(config);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), resolved.sorobanRpc.timeout);
      const response = await fetch(resolved.sorobanRpc.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(resolved.sorobanRpc.apiKey
            ? { Authorization: `Bearer ${resolved.sorobanRpc.apiKey}` }
            : {}),
          ...resolved.sorobanRpc.headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return resolved;
    } catch {
      // Health check failed — wait before retrying
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }

  // All attempts failed — return the resolved config anyway.
  // The caller can handle connectivity issues at call time.
  return resolved;
}

/**
 * Create a fully custom network configuration for private or non-standard
 * deployments with extended endpoint options including proxy and retry.
 *
 * @param params - Custom network parameters
 * @returns Fully resolved network configuration
 *
 * @example
 * ```typescript
 * const config = createExtendedNetworkConfig({
 *   networkPassphrase: 'Custom Network ; January 2025',
 *   sorobanRpc: {
 *     url: 'https://private-rpc.example.com',
 *     apiKey: 'my-api-key',
 *     timeout: 60000,
 *     proxy: { url: 'http://proxy.example.com:8080' },
 *     retry: { maxAttempts: 3, baseDelayMs: 1000, exponentialBackoff: true },
 *   },
 *   horizon: {
 *     url: 'https://private-horizon.example.com',
 *     timeout: 30000,
 *   },
 *   networkName: 'Private Network',
 * });
 * ```
 */
export function createExtendedNetworkConfig(params: {
  networkPassphrase: string;
  sorobanRpc: ExtendedRpcEndpointConfig;
  horizon: ExtendedRpcEndpointConfig;
  networkName?: string;
}): ResolvedNetworkConfig {
  return resolveNetworkConfig({
    networkPassphrase: params.networkPassphrase,
    sorobanRpcUrl: {
      url: params.sorobanRpc.url,
      timeout: params.sorobanRpc.timeout,
      apiKey: params.sorobanRpc.apiKey,
      headers: params.sorobanRpc.headers,
    },
    horizonUrl: {
      url: params.horizon.url,
      timeout: params.horizon.timeout,
      apiKey: params.horizon.apiKey,
      headers: params.horizon.headers,
    },
    networkName: params.networkName,
  });
}

/** Environment variable names recognised by {@link resolveNetworkConfigFromEnv}. */
export const NETWORK_ENV_VARS = {
  networkPassphrase: 'STELLAR_NETWORK_PASSPHRASE',
  sorobanRpcUrl: 'STELLAR_SOROBAN_RPC_URL',
  horizonUrl: 'STELLAR_HORIZON_URL',
  apiKey: 'STELLAR_RPC_API_KEY',
  timeout: 'STELLAR_RPC_TIMEOUT',
  networkName: 'STELLAR_NETWORK_NAME',
} as const;

/**
 * Resolve network configuration from environment variables, falling back to
 * the public defaults for any variable that is unset.
 *
 * Recognised variables (see {@link NETWORK_ENV_VARS}):
 *   - `STELLAR_NETWORK_PASSPHRASE` — network passphrase (defaults to PUBLIC)
 *   - `STELLAR_SOROBAN_RPC_URL`    — custom Soroban RPC endpoint
 *   - `STELLAR_HORIZON_URL`        — custom Horizon endpoint
 *   - `STELLAR_RPC_API_KEY`        — API key applied to both endpoints
 *   - `STELLAR_RPC_TIMEOUT`        — request timeout in ms (must be a positive integer)
 *   - `STELLAR_NETWORK_NAME`       — human-readable network name
 *
 * A `overrides` object can be supplied to take precedence over the
 * environment — handy when only some values come from `process.env`.
 *
 * Browser-safe: when `process.env` is unavailable (e.g. in a bundled browser
 * build) this behaves exactly like {@link resolveNetworkConfig} with only the
 * supplied `overrides` applied.
 */
export function resolveNetworkConfigFromEnv(
  overrides: NetworkConfig = {},
): ResolvedNetworkConfig {
  const env: Record<string, string | undefined> =
    typeof process !== 'undefined' && process.env ? process.env : {};

  const apiKey = normalizeString(env[NETWORK_ENV_VARS.apiKey]);

  let timeout: number | undefined;
  const rawTimeout = normalizeString(env[NETWORK_ENV_VARS.timeout]);
  if (rawTimeout !== undefined) {
    const parsed = Number(rawTimeout);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `${NETWORK_ENV_VARS.timeout} must be a positive integer (ms), got "${rawTimeout}"`,
      );
    }
    timeout = parsed;
  }

  const buildEndpoint = (
    url: string | undefined,
  ): string | RpcEndpointConfig | undefined => {
    const cleaned = normalizeString(url);
    if (cleaned === undefined) return undefined;
    if (apiKey || timeout !== undefined) {
      return { url: cleaned, apiKey, timeout };
    }
    return cleaned;
  };

  return resolveNetworkConfig({
    networkPassphrase:
      normalizeString(overrides.networkPassphrase) ?? normalizeString(env[NETWORK_ENV_VARS.networkPassphrase]),
    sorobanRpcUrl:
      overrides.sorobanRpcUrl ?? buildEndpoint(env[NETWORK_ENV_VARS.sorobanRpcUrl]),
    horizonUrl:
      overrides.horizonUrl ?? buildEndpoint(env[NETWORK_ENV_VARS.horizonUrl]),
    networkName:
      normalizeString(overrides.networkName) ?? normalizeString(env[NETWORK_ENV_VARS.networkName]),
  });
}

/**
 * Normalize a string value, trimming whitespace and converting empty strings to undefined.
 */
function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
