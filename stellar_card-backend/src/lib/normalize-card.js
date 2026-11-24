// @ts-check
// Normalise the upstream card brand string before it's surfaced to agents.
//
// vcc/CTX returns brand strings like:
//   "Visa® Reward Card, 6-Month Expiration [ITNL] eGift Card"
//   "Mastercard® Prepaid"
//   "American Express Gift Card"
// which leak the upstream merchant catalog and CTX's internal SKU naming
// into the agent's transcript. The audit-F4 sanitisation principle says
// agents should see a stable label, never the internal product string.
//
// Rule: pattern-match on the raw brand for the card scheme + return
// "<currency> <scheme> Card". Currency is fixed to USD because every
// merchant in enabled-merchants.js is currently US/USD; if we onboard a
// non-USD merchant in the future we'll plumb the currency through from
// the order row and look it up here.
//
// Adversarial audit 2026-04-15:
//
//   F1-normalize-card: whitespace-only input no longer masquerades as
//     'USD Prepaid Card'. Pre-fix, `'   '.toLowerCase()` was a valid
//     truthy string, no substring matched, and the function returned
//     the cheerful 'USD Prepaid Card' fallback — hiding upstream data
//     corruption behind a plausible-looking label that the agent and
//     the dashboard would both accept. Now the input is trimmed before
//     matching; a whitespace-only string returns null just like empty
//     input does, surfacing the corruption to the caller.
//
//   F2-normalize-card: the unknown-scheme fallback used to be silent.
//     The inline comment said "ops needs to know we're seeing a new
//     merchant" but no logging actually fired — when CTX introduced a
//     new product SKU or renamed an existing one, the agent silently
//     saw 'USD Prepaid Card' and ops had no signal until a support
//     ticket came in. Now the fallback emits a dedup'd
//     bizEvent('normalize_card.unknown_brand', { raw }) + one-shot
//     console.warn per unique raw value per process. Same dedup
//     pattern as agent-state's unknown-state warn: first sight of
//     each distinct offender logs once, repeated sightings are
//     suppressed so one bad row doesn't spam the log.

// F2-normalize-card: dedup so the same unknown brand across hundreds of
// cards emits exactly one warn + one bizEvent per process lifetime.
const _warnedUnknownBrands = new Set();

// Lazy-loaded bizEvent so this module stays a leaf — logger.js already
// imports no card logic, but we avoid coupling just in case.
let _bizEvent = null;
function safeBizEvent(name, fields) {
  try {
    if (!_bizEvent) _bizEvent = require('./logger').event;
    _bizEvent(name, fields);
  } catch {
    /* intentional — observability must not block the gate */
  }
}

/**
 * @param {string|null|undefined} rawBrand
 * @returns {string|null}
 */
function normalizeCardBrand(rawBrand) {
  if (!rawBrand || typeof rawBrand !== 'string') return null;

  // F1-normalize-card: trim before any matching. A whitespace-only input
  // after trim is empty → null, not the 'USD Prepaid Card' fallback.
  const trimmed = rawBrand.trim();
  if (trimmed.length === 0) return null;

  const lower = trimmed.toLowerCase();
  if (lower.includes('visa')) return 'USD Visa Card';
  if (lower.includes('master')) return 'USD Mastercard';
  if (lower.includes('amex') || lower.includes('american express')) return 'USD Amex Card';
  if (lower.includes('discover')) return 'USD Discover Card';

  // F2-normalize-card: unknown scheme. Emit a loud-but-dedup'd signal so
  // ops sees new CTX product strings the first time they appear. Dedup'd
  // on the raw (pre-trim) value so a trailing-whitespace variant and its
  // clean sibling both register as "same offender" without spam.
  if (!_warnedUnknownBrands.has(trimmed)) {
    _warnedUnknownBrands.add(trimmed);
    console.warn(
      `[normalize-card] unknown brand ${JSON.stringify(trimmed)} — ` +
        `rendering as 'USD Prepaid Card'. Add a rule if this is a new merchant.`,
    );
    safeBizEvent('normalize_card.unknown_brand', { raw: trimmed });
  }
  return 'USD Prepaid Card';
}

/**
 * Test-only: reset the dedup cache so each case starts fresh.
 */
function _resetWarnedBrands() {
  _warnedUnknownBrands.clear();
}

// ── ISO 3166-1 alpha-2 country validation and address normalization (#956) ────
//
// Before forwarding cardholder address data to the VCC API we must validate:
//   1. country  — must be a recognized 2-letter ISO 3166-1 alpha-2 code.
//   2. postal code (US addresses) — 5-digit or ZIP+4 format (12345 / 12345-6789).
//   3. street address  — trim leading/trailing whitespace.
//   4. city            — trim and title-case.
//
// Invalid fields are collected and surfaced in a single descriptive error so
// callers can return a 400 with actionable field-level detail without making
// multiple round-trips.
//
// The ISO code list is intentionally embedded (not loaded from a file) so the
// module stays a leaf with no I/O dependencies. The list covers all 249 current
// UN M49 / ISO 3166-1 alpha-2 codes as of 2024.

const ISO_3166_1_ALPHA2 = new Set([
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
  'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
  'CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE',
  'EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF',
  'GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM',
  'HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
  'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC',
  'LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK',
  'ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA',
  'NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG',
  'PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
  'ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
  'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
  'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
]);

// US ZIP code: 5 digits, optionally followed by a hyphen and 4 digits.
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

/**
 * Title-case a city name: capitalize the first letter of each word,
 * lowercase the rest. Handles hyphenated names (e.g. "WINSTON-SALEM" →
 * "Winston-Salem") and apostrophes (e.g. "O'FALLON" → "O'Fallon").
 * @param {string} city
 * @returns {string}
 */
function titleCaseCity(city) {
  return city
    .split(/(\s+|(?<=[a-zA-Z])-(?=[a-zA-Z])|(?<=[a-zA-Z])'(?=[a-zA-Z]))/u)
    .map((part, idx, parts) => {
      // Even indices are word parts, odd indices are the separators.
      // We want to capitalize the first alpha char of each word part.
      if (/^[a-zA-Z]/.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part;
    })
    .join('');
}

/**
 * @typedef {Object} CardholderAddress
 * @property {string} street     - Street address line 1 (required)
 * @property {string} [street2]  - Street address line 2 (optional)
 * @property {string} city       - City name (required)
 * @property {string} [state]    - State / province code (optional)
 * @property {string} postalCode - Postal / ZIP code (required)
 * @property {string} country    - ISO 3166-1 alpha-2 country code (required)
 */

/**
 * @typedef {Object} NormalizedAddress
 * @property {string} street
 * @property {string} [street2]
 * @property {string} city
 * @property {string} [state]
 * @property {string} postalCode
 * @property {string} country
 */

/**
 * Validate and normalize a cardholder address before forwarding to the VCC API.
 *
 * Validates:
 *   - `country` is a recognized ISO 3166-1 alpha-2 code (case-insensitive; normalized to uppercase).
 *   - `postalCode` for US addresses conforms to 5-digit or ZIP+4 format.
 *
 * Normalizes:
 *   - `street` / `street2` — trimmed of leading/trailing whitespace.
 *   - `city` — trimmed and title-cased.
 *   - `country` — uppercased.
 *   - `state` — uppercased (if present).
 *
 * Throws a descriptive `Error` with an `invalidFields` property listing every
 * failing field so callers can return a 400 with actionable detail.
 *
 * @param {CardholderAddress} address
 * @returns {NormalizedAddress}
 */
function normalizeCardholderAddress(address) {
  if (!address || typeof address !== 'object') {
    const err = new Error('Address must be a plain object');
    /** @type {any} */ (err).invalidFields = ['address'];
    throw err;
  }

  const invalidFields = [];
  const errors = {};

  // ── country ──────────────────────────────────────────────────────────────
  const rawCountry = typeof address.country === 'string' ? address.country.trim().toUpperCase() : '';
  if (!rawCountry) {
    invalidFields.push('country');
    errors.country = 'country is required';
  } else if (!ISO_3166_1_ALPHA2.has(rawCountry)) {
    invalidFields.push('country');
    errors.country = `'${rawCountry}' is not a valid ISO 3166-1 alpha-2 country code`;
  }
  const country = rawCountry;

  // ── postalCode ───────────────────────────────────────────────────────────
  const rawPostal = typeof address.postalCode === 'string' ? address.postalCode.trim() : '';
  if (!rawPostal) {
    invalidFields.push('postalCode');
    errors.postalCode = 'postalCode is required';
  } else if (country === 'US' && !US_ZIP_RE.test(rawPostal)) {
    invalidFields.push('postalCode');
    errors.postalCode =
      `'${rawPostal}' is not a valid US ZIP code — expected 5 digits (12345) ` +
      `or ZIP+4 format (12345-6789)`;
  }

  // ── street ───────────────────────────────────────────────────────────────
  const rawStreet = typeof address.street === 'string' ? address.street.trim() : '';
  if (!rawStreet) {
    invalidFields.push('street');
    errors.street = 'street is required';
  }

  // ── city ─────────────────────────────────────────────────────────────────
  const rawCity = typeof address.city === 'string' ? address.city.trim() : '';
  if (!rawCity) {
    invalidFields.push('city');
    errors.city = 'city is required';
  }

  if (invalidFields.length > 0) {
    const fieldList = invalidFields.join(', ');
    const detail = Object.values(errors).join('; ');
    const err = new Error(
      `Address validation failed for field(s): ${fieldList}. ${detail}`,
    );
    /** @type {any} */ (err).invalidFields = invalidFields;
    /** @type {any} */ (err).fieldErrors = errors;
    throw err;
  }

  return {
    street: rawStreet,
    ...(address.street2 !== undefined && { street2: String(address.street2).trim() }),
    city: titleCaseCity(rawCity),
    ...(address.state !== undefined && { state: String(address.state).trim().toUpperCase() }),
    postalCode: rawPostal,
    country,
  };
}

module.exports = {
  normalizeCardBrand,
  normalizeCardholderAddress,
  titleCaseCity,
  ISO_3166_1_ALPHA2,
  _resetWarnedBrands,
};