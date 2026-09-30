/**
 * SEP-0007 URI helpers for deep-linking with mobile Stellar wallets
 * (Lobstr, Vibrant, Freighter, etc.).
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 *
 * Supports:
 *   - `web+stellar:pay?...`  — payment request URIs
 *   - `web+stellar:tx?...`   — pre-built transaction (XDR) URIs
 */

import { Keypair, StrKey } from '@stellar/stellar-sdk';

/** Parameters for building a SEP-0007 `pay` URI. */
export interface Sep7PayParams {
  /** Destination G-address (required). */
  destination: string;
  /** Payment amount as a decimal string. */
  amount?: string;
  /** Asset code, e.g. `USDC`. Omit / `XLM` / `native` for native lumens. */
  assetCode?: string;
  /** Asset issuer G-address (required when assetCode is a non-native asset). */
  assetIssuer?: string;
  /** Memo text (UTF-8, max 28 bytes for MEMO_TEXT). */
  memo?: string;
  /** Memo type: `MEMO_TEXT` | `MEMO_ID` | `MEMO_HASH` | `MEMO_RETURN`. */
  memoType?: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH' | 'MEMO_RETURN';
  /** Optional callback URL the wallet POSTs the result to. */
  callback?: string;
  /** Human-readable message shown in the wallet. */
  msg?: string;
  /** Network passphrase (e.g. Public Global Stellar Network ; September 2015). */
  networkPassphrase?: string;
  /** Origin domain claiming this URI (for signature verification). */
  originDomain?: string;
  /**
   * Optional Ed25519 secret key (S…) used to produce a SEP-0007
   * `signature` query parameter over the unsigned URI.
   */
  signingKey?: string;
}

/** Parameters for building a SEP-0007 `tx` URI. */
export interface Sep7TxParams {
  /** Base64-encoded TransactionEnvelope XDR. */
  xdr: string;
  /** Optional replace fields (SEP-0007 `replace` param). */
  replace?: string;
  callback?: string;
  msg?: string;
  networkPassphrase?: string;
  originDomain?: string;
  signingKey?: string;
}

/** Structured result of {@link parseSep7Uri}. */
export interface Sep7ParsedUri {
  /** Operation type: `pay` or `tx`. */
  type: 'pay' | 'tx';
  /** Raw query parameters as a plain object. */
  params: Record<string, string>;
  /** Convenience fields for `pay` URIs. */
  destination?: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: string;
  /** Convenience field for `tx` URIs. */
  xdr?: string;
  callback?: string;
  msg?: string;
  networkPassphrase?: string;
  originDomain?: string;
  signature?: string;
}

const SEP7_SCHEME = 'web+stellar:';

function encodeQuery(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

function validatePayParams(params: Sep7PayParams): void {
  if (!params.destination || !StrKey.isValidEd25519PublicKey(params.destination)) {
    throw new Error(`SEP-0007: invalid destination address: ${params.destination}`);
  }
  if (params.amount !== undefined) {
    if (!/^\d+(\.\d+)?$/.test(params.amount) || parseFloat(params.amount) <= 0) {
      throw new Error(`SEP-0007: invalid amount: ${params.amount}`);
    }
  }
  const code = params.assetCode;
  const isNative = !code || code === 'XLM' || code === 'native';
  if (!isNative) {
    if (!params.assetIssuer || !StrKey.isValidEd25519PublicKey(params.assetIssuer)) {
      throw new Error('SEP-0007: asset_issuer is required for non-native assets');
    }
  }
  if (params.memo && Buffer.byteLength(params.memo, 'utf8') > 28 && params.memoType !== 'MEMO_HASH') {
    // MEMO_TEXT is capped at 28 bytes; MEMO_ID / HASH have their own limits —
    // warn via throw only for the common text case without an explicit type.
    if (!params.memoType || params.memoType === 'MEMO_TEXT') {
      throw new Error('SEP-0007: memo text exceeds 28 bytes');
    }
  }
}

/**
 * Sign a SEP-0007 URI per the spec: Ed25519 over the URI with
 * `signature` / `origin_domain` stripped, then append `signature`.
 */
function signSep7Uri(unsignedUri: string, signingKey: string): string {
  if (!StrKey.isValidEd25519SecretSeed(signingKey)) {
    throw new Error('SEP-0007: invalid signing key');
  }
  const keypair = Keypair.fromSecret(signingKey);
  const signature = keypair.sign(Buffer.from(unsignedUri, 'utf8')).toString('base64');
  const sep = unsignedUri.includes('?') ? '&' : '?';
  return `${unsignedUri}${sep}signature=${encodeURIComponent(signature)}`;
}

/**
 * Build a `web+stellar:pay?...` URI according to SEP-0007.
 *
 * @example
 * ```typescript
 * buildSep7PayUri({
 *   destination: 'GABC...',
 *   amount: '10.00',
 *   assetCode: 'USDC',
 *   assetIssuer: 'GA5Z...',
 *   memo: 'ord_123',
 * });
 * // → 'web+stellar:pay?destination=GABC...&amount=10.00&...'
 * ```
 */
export function buildSep7PayUri(params: Sep7PayParams): string {
  validatePayParams(params);

  const isNative =
    !params.assetCode || params.assetCode === 'XLM' || params.assetCode === 'native';

  const query = encodeQuery({
    destination: params.destination,
    amount: params.amount,
    asset_code: isNative ? undefined : params.assetCode,
    asset_issuer: isNative ? undefined : params.assetIssuer,
    memo: params.memo,
    memo_type: params.memo ? (params.memoType ?? 'MEMO_TEXT') : undefined,
    callback: params.callback,
    msg: params.msg,
    network_passphrase: params.networkPassphrase,
    origin_domain: params.originDomain,
  });

  const unsigned = `${SEP7_SCHEME}pay?${query}`;
  if (params.signingKey) {
    return signSep7Uri(unsigned, params.signingKey);
  }
  return unsigned;
}

/**
 * Build a `web+stellar:tx?xdr=...` URI for submitting a pre-built
 * (typically Soroban) transaction envelope.
 */
export function buildSep7TxUri(params: Sep7TxParams): string {
  if (!params.xdr || typeof params.xdr !== 'string') {
    throw new Error('SEP-0007: xdr is required for tx URIs');
  }

  const query = encodeQuery({
    xdr: params.xdr,
    replace: params.replace,
    callback: params.callback,
    msg: params.msg,
    network_passphrase: params.networkPassphrase,
    origin_domain: params.originDomain,
  });

  const unsigned = `${SEP7_SCHEME}tx?${query}`;
  if (params.signingKey) {
    return signSep7Uri(unsigned, params.signingKey);
  }
  return unsigned;
}

/**
 * Parse a SEP-0007 URI into structured payment / transaction parameters.
 *
 * @throws {Error} If the URI scheme or operation type is invalid.
 */
export function parseSep7Uri(uri: string): Sep7ParsedUri {
  if (typeof uri !== 'string' || !uri.startsWith(SEP7_SCHEME)) {
    throw new Error(`SEP-0007: URI must start with ${SEP7_SCHEME}`);
  }

  const rest = uri.slice(SEP7_SCHEME.length);
  const qIdx = rest.indexOf('?');
  const type = (qIdx === -1 ? rest : rest.slice(0, qIdx)).toLowerCase();
  if (type !== 'pay' && type !== 'tx') {
    throw new Error(`SEP-0007: unsupported operation type '${type}'`);
  }

  const query = qIdx === -1 ? '' : rest.slice(qIdx + 1);
  const params: Record<string, string> = {};
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
      const value = decodeURIComponent(eq === -1 ? '' : part.slice(eq + 1));
      params[key] = value;
    }
  }

  if (type === 'pay') {
    if (!params.destination) {
      throw new Error('SEP-0007: pay URI missing destination');
    }
    if (!StrKey.isValidEd25519PublicKey(params.destination)) {
      throw new Error(`SEP-0007: invalid destination: ${params.destination}`);
    }
    return {
      type: 'pay',
      params,
      destination: params.destination,
      amount: params.amount,
      assetCode: params.asset_code,
      assetIssuer: params.asset_issuer,
      memo: params.memo,
      memoType: params.memo_type,
      callback: params.callback,
      msg: params.msg,
      networkPassphrase: params.network_passphrase,
      originDomain: params.origin_domain,
      signature: params.signature,
    };
  }

  if (!params.xdr) {
    throw new Error('SEP-0007: tx URI missing xdr');
  }
  return {
    type: 'tx',
    params,
    xdr: params.xdr,
    callback: params.callback,
    msg: params.msg,
    networkPassphrase: params.network_passphrase,
    originDomain: params.origin_domain,
    signature: params.signature,
  };
}
