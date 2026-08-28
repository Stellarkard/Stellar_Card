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

export function loadStellar_CardConfig(_configPath?: string): null {
  return null;
}

export function saveStellar_CardConfig(
  _config: Stellar_CardConfig,
  _configPath?: string,
): never {
  throw new Error(
    'saveStellar_CardConfig is not available in browser environments. ' +
      'Manage API keys via the Stellar_Card dashboard.',
  );
}

export function resolveCredentials(
  opts: { apiKey?: string; baseUrl?: string } = {},
): { apiKey: string | undefined; baseUrl: string | undefined } {
  return { apiKey: opts.apiKey, baseUrl: opts.baseUrl };
}

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
