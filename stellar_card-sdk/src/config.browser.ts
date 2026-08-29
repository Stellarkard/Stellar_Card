// Browser stub for config.ts.
//
// The real config.ts reads/writes ~/.stellar_card/config.json using Node.js
// built-ins (fs, path, os, crypto). None of those are available in browsers.
//
// This stub is swapped in place of config.ts for browser bundler targets via
// the "browser" field in package.json. It satisfies the same interface so
// client.ts compiles without pulling fs/path/os/crypto into the browser bundle.
//
// Credentials must be passed explicitly when running in a browser:
//   new Stellar_CardClient({ apiKey: 'stellar_card_...', baseUrl: 'https://...' })

export interface Stellar_CardConfig {
  api_key: string;
  api_url: string;
  webhook_secret?: string | null;
  wallet_name?: string;
  vault_path?: string;
  passphrase_env?: string;
  created_at: string;
}

/**
 * Browser stub for {@link loadStellar_CardConfig} (config.ts).
 *
 * There is no `~/.stellar_card/config.json` in a browser — credentials must
 * be passed explicitly to `Stellar_CardClient`. Always returns `null` so
 * callers fall through to explicit-credential resolution.
 *
 * @param _configPath - Ignored; accepted only to match the Node entry point's signature.
 * @returns Always `null`.
 */
export function loadStellar_CardConfig(_configPath?: string): null {
  return null;
}

/**
 * Browser stub for {@link saveStellar_CardConfig} (config.ts).
 *
 * Persisting a config file isn't meaningful in a browser context, so this
 * always throws rather than silently no-op-ing.
 *
 * @param _config - Ignored.
 * @param _configPath - Ignored.
 * @throws {Error} Always — config persistence is not available in browsers.
 */
export function saveStellar_CardConfig(
  _config: Stellar_CardConfig,
  _configPath?: string,
): never {
  throw new Error(
    'saveStellar_CardConfig is not available in browser environments. ' +
      'Manage API keys via the Stellar_Card dashboard.',
  );
}

/**
 * Resolve API credentials in a browser context.
 *
 * Unlike the Node entry point (which falls back to the on-disk config file
 * and environment variables), the browser build has neither, so this simply
 * passes the explicitly supplied options through unchanged.
 *
 * @param opts - Explicit credentials supplied by the caller.
 * @param opts.apiKey - API key, if provided.
 * @param opts.baseUrl - API base URL, if provided.
 * @returns The same `apiKey`/`baseUrl` pair, unresolved further.
 */
export function resolveCredentials(
  opts: { apiKey?: string; baseUrl?: string } = {},
): { apiKey: string | undefined; baseUrl: string | undefined } {
  return { apiKey: opts.apiKey, baseUrl: opts.baseUrl };
}

/**
 * Validate that a base URL is safe to use for API requests.
 *
 * Rejects URLs carrying embedded `user:pass@` credentials (the API key is
 * sent via the `X-Api-Key` header, never in the URL) and anything that
 * isn't `https:`, so a misconfigured or malicious base URL can't
 * accidentally leak the API key over plaintext HTTP.
 *
 * @param url - Candidate base URL.
 * @param opts.context - Optional label included in the thrown error message (e.g. "webhook URL").
 * @returns The normalized URL string.
 * @throws {Error} If `url` fails to parse, embeds credentials, or is not HTTPS.
 */
export function assertSafeBaseUrl(url: string, opts: { context?: string } = {}): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid base URL: ${url}`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(
      `Refusing base URL ${JSON.stringify(url)} with embedded credentials. ` +
        `Use a bare https://host/path form — the api key is sent via the X-Api-Key header.`,
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Refusing to use non-HTTPS base URL (${url})${opts.context ? ` for ${opts.context}` : ''}.`,
    );
  }
  return parsed.toString();
}
