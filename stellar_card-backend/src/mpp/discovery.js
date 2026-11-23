// @ts-check
// MPP discovery + challenge shape.
//
// Centralises the JSON shapes that leave the server so the challenge
// body, the WWW-Authenticate header, and the discovery document all
// agree on what's supported. Keeping this in one file means any future
// method addition (classic Stellar payment, Tempo, EVM) goes through a
// single touch point.

const USDC_ISSUER_DEFAULT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const CHALLENGE_RESOURCE_PATTERN = '/v1/cards/visa/{amount_usdc}';

/**
 * Return the /v1/.well-known/mpp discovery document.
 *
 * Includes the RFC-style fields (assets, contract_id, challenge_endpoint,
 * public_key, schemes) alongside the legacy fields kept for backward
 * compatibility with existing MPP clients.
 */
function buildDiscoveryDoc() {
  const network = process.env.STELLAR_NETWORK || 'mainnet';
  const contractId = process.env.RECEIVER_CONTRACT_ID || '';
  const usdcIssuer = process.env.STELLAR_USDC_ISSUER || USDC_ISSUER_DEFAULT;
  const publicKey = process.env.STELLAR_PUBLIC_KEY || '';
  const baseUrl = (process.env.CARDS402_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const challengeEndpoint = `${baseUrl}${CHALLENGE_RESOURCE_PATTERN}`;
  const schemes = ['stellar_soroban_usdc', 'stellar_soroban_xlm'];
  return {
    version: '1.0',
    protocol: 'mpp/1.0',
    accepts: ['stellar'],
    assets: [
      { code: 'USDC', issuer: usdcIssuer, type: 'credit_alphanum4' },
      { code: 'XLM', issuer: null, type: 'native' },
    ],
    contract_id: contractId,
    challenge_endpoint: challengeEndpoint,
    public_key: publicKey,
    schemes,
    resources: [
      {
        pattern: CHALLENGE_RESOURCE_PATTERN,
        description: 'Virtual Visa card, face-value 0.01–10000 USDC',
        bounds: { min: '0.01', max: '10000.00', currency: 'USDC' },
      },
    ],
    stellar: {
      network,
      receiver_contract: contractId,
      usdc_asset: `USDC:${usdcIssuer}`,
      methods: ['soroban_contract_pay_usdc', 'soroban_contract_pay_xlm'],
    },
  };
}

/**
 * Build the JSON body returned with a 402 response. Each method entry
 * is self-describing so an MPP client can pick one and know exactly
 * what on-chain operation to submit.
 *
 * @param {{
 *   challenge: { id: string, expiresAt: Date, resourcePath: string },
 *   amountUsdc: string,
 *   amountXlmQuote: string | null,
 * }} args
 */
function buildChallengeBody(args) {
  const { challenge, amountUsdc, amountXlmQuote } = args;
  const contractId = process.env.RECEIVER_CONTRACT_ID || '';
  const usdcIssuer = process.env.STELLAR_USDC_ISSUER || USDC_ISSUER_DEFAULT;

  const usdcStroops = decimalToStroops(amountUsdc);

  const methods = [
    {
      scheme: 'stellar',
      kind: 'soroban_contract',
      contract_id: contractId,
      function: 'pay_usdc',
      asset: `USDC:${usdcIssuer}`,
      amount: amountUsdc,
      amount_stroops: usdcStroops,
      memo_field: 'order_id',
      memo_value: challenge.id,
    },
  ];

  if (amountXlmQuote) {
    methods.push({
      scheme: 'stellar',
      kind: 'soroban_contract',
      contract_id: contractId,
      function: 'pay_xlm',
      asset: 'native',
      amount: amountXlmQuote,
      amount_stroops: decimalToStroops(amountXlmQuote),
      memo_field: 'order_id',
      memo_value: challenge.id,
    });
  }

  return {
    error: 'payment_required',
    protocol: 'mpp/1.0',
    challenge_id: challenge.id,
    amount: { value: amountUsdc, currency: 'USD' },
    expires_at: challenge.expiresAt.toISOString(),
    methods,
    retry_url: challenge.resourcePath,
  };
}

/**
 * WWW-Authenticate header value for a 402 response. Per MPP the scheme
 * is 'Payment' with realm, challenge, and a methods list that the
 * client can parse without the JSON body.
 */
function buildWwwAuthenticate(challengeId) {
  return `Payment realm="stellar_card", challenge="${challengeId}", methods="stellar"`;
}

/**
 * Convert a decimal USDC amount to 7-decimal stroops as a string.
 * Example: '10.00' → '100000000'.
 */
function decimalToStroops(decimal) {
  if (!/^\d+(\.\d+)?$/.test(decimal)) throw new Error(`invalid decimal: ${decimal}`);
  const [whole, frac = ''] = decimal.split('.');
  if (frac.length > 7) throw new Error(`too many decimals: ${decimal}`);
  const padded = frac.padEnd(7, '0');
  return (BigInt(whole) * 10_000_000n + BigInt(padded || '0')).toString();
}

module.exports = { buildDiscoveryDoc, buildChallengeBody, buildWwwAuthenticate, decimalToStroops };
