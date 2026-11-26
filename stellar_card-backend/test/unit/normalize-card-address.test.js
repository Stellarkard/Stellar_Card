// Unit tests for issue #956 — ISO 3166-1 alpha-2 country and postal code
// validation in cardholder address normalization.
//
// Verifies normalizeCardholderAddress():
//   - accepts valid ISO 3166-1 alpha-2 country codes (case-insensitive)
//   - rejects invalid / unknown country codes
//   - validates US ZIP codes (5-digit and ZIP+4)
//   - rejects malformed US postal codes
//   - trims street / street2 whitespace
//   - title-cases the city name
//   - collects ALL invalid fields in one error (not early exit)
//   - throws with an `invalidFields` property

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCardholderAddress,
  titleCaseCity,
  ISO_3166_1_ALPHA2,
} = require('../../src/lib/normalize-card');

// ── titleCaseCity ─────────────────────────────────────────────────────────────

describe('titleCaseCity', () => {
  it('capitalizes a single word', () => {
    assert.equal(titleCaseCity('DALLAS'), 'Dallas');
  });

  it('capitalizes each word in a multi-word city name', () => {
    assert.equal(titleCaseCity('NEW YORK'), 'New York');
  });

  it('handles all-lowercase input', () => {
    assert.equal(titleCaseCity('los angeles'), 'Los Angeles');
  });

  it('handles mixed-case input', () => {
    assert.equal(titleCaseCity('sAn fRaNcIsco'), 'San Francisco');
  });

  it('preserves already-title-cased input', () => {
    assert.equal(titleCaseCity('Portland'), 'Portland');
  });
});

// ── ISO_3166_1_ALPHA2 set ─────────────────────────────────────────────────────

describe('ISO_3166_1_ALPHA2', () => {
  it('contains US', () => assert.ok(ISO_3166_1_ALPHA2.has('US')));
  it('contains GB', () => assert.ok(ISO_3166_1_ALPHA2.has('GB')));
  it('contains DE', () => assert.ok(ISO_3166_1_ALPHA2.has('DE')));
  it('contains CA', () => assert.ok(ISO_3166_1_ALPHA2.has('CA')));
  it('does not contain XX', () => assert.ok(!ISO_3166_1_ALPHA2.has('XX')));
  it('does not contain USA', () => assert.ok(!ISO_3166_1_ALPHA2.has('USA')));
  it('contains at least 240 entries', () => assert.ok(ISO_3166_1_ALPHA2.size >= 240));
});

// ── normalizeCardholderAddress — valid addresses ──────────────────────────────

describe('normalizeCardholderAddress — valid international addresses', () => {
  it('accepts a valid US address with 5-digit ZIP', () => {
    const result = normalizeCardholderAddress({
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    });
    assert.equal(result.country, 'US');
    assert.equal(result.postalCode, '62701');
    assert.equal(result.city, 'Springfield');
    assert.equal(result.street, '123 Main St');
  });

  it('accepts a valid US address with ZIP+4', () => {
    const result = normalizeCardholderAddress({
      street: '456 Oak Ave',
      city: 'Austin',
      postalCode: '78701-1234',
      country: 'US',
    });
    assert.equal(result.postalCode, '78701-1234');
  });

  it('accepts a valid GB address (no US ZIP check)', () => {
    const result = normalizeCardholderAddress({
      street: '10 Downing Street',
      city: 'London',
      postalCode: 'SW1A 2AA',
      country: 'GB',
    });
    assert.equal(result.country, 'GB');
    assert.equal(result.postalCode, 'SW1A 2AA');
  });

  it('accepts a valid DE address', () => {
    const result = normalizeCardholderAddress({
      street: 'Unter den Linden 1',
      city: 'Berlin',
      postalCode: '10117',
      country: 'de', // lowercase — should be uppercased
    });
    assert.equal(result.country, 'DE');
  });

  it('normalizes country to uppercase', () => {
    const result = normalizeCardholderAddress({
      street: '1 Rue de Rivoli',
      city: 'paris',
      postalCode: '75001',
      country: 'fr',
    });
    assert.equal(result.country, 'FR');
  });

  it('trims whitespace from street', () => {
    const result = normalizeCardholderAddress({
      street: '  789 Elm Street  ',
      city: 'Denver',
      postalCode: '80201',
      country: 'US',
    });
    assert.equal(result.street, '789 Elm Street');
  });

  it('title-cases the city name', () => {
    const result = normalizeCardholderAddress({
      street: '1 Main St',
      city: 'NEW ORLEANS',
      postalCode: '70112',
      country: 'US',
    });
    assert.equal(result.city, 'New Orleans');
  });

  it('uppercases state when provided', () => {
    const result = normalizeCardholderAddress({
      street: '1 Main St',
      city: 'Boston',
      state: 'ma',
      postalCode: '02101',
      country: 'US',
    });
    assert.equal(result.state, 'MA');
  });

  it('passes through street2 when provided', () => {
    const result = normalizeCardholderAddress({
      street: '1 Main St',
      street2: '  Apt 4B  ',
      city: 'Chicago',
      postalCode: '60601',
      country: 'US',
    });
    assert.equal(result.street2, 'Apt 4B');
  });
});

// ── normalizeCardholderAddress — invalid inputs ───────────────────────────────

describe('normalizeCardholderAddress — invalid country', () => {
  it('throws on an unknown country code', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: 'Somewhere',
          postalCode: '12345',
          country: 'XX',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('country'));
        return true;
      },
    );
  });

  it('throws on a 3-letter code (ISO 3166-1 alpha-3 not accepted)', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: 'Somewhere',
          postalCode: '12345',
          country: 'USA',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('country'));
        return true;
      },
    );
  });

  it('throws when country is empty', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: 'Somewhere',
          postalCode: '12345',
          country: '',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('country'));
        return true;
      },
    );
  });
});

describe('normalizeCardholderAddress — invalid US postal codes', () => {
  it('throws on a 4-digit US ZIP', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: 'Springfield',
          postalCode: '1234',
          country: 'US',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('postalCode'));
        return true;
      },
    );
  });

  it('throws on a US ZIP with wrong separator in ZIP+4', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: 'Springfield',
          postalCode: '12345_6789',
          country: 'US',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('postalCode'));
        return true;
      },
    );
  });

  it('throws on an alphabetic US ZIP', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: 'Springfield',
          postalCode: 'ABCDE',
          country: 'US',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('postalCode'));
        return true;
      },
    );
  });
});

describe('normalizeCardholderAddress — required fields', () => {
  it('throws when street is missing', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '',
          city: 'Denver',
          postalCode: '80201',
          country: 'US',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('street'));
        return true;
      },
    );
  });

  it('throws when city is missing', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '1 Main St',
          city: '',
          postalCode: '80201',
          country: 'US',
        }),
      (err) => {
        assert.ok(err.invalidFields.includes('city'));
        return true;
      },
    );
  });

  it('collects multiple invalid fields in one error', () => {
    assert.throws(
      () =>
        normalizeCardholderAddress({
          street: '',
          city: '',
          postalCode: 'bad',
          country: 'XX',
        }),
      (err) => {
        assert.ok(Array.isArray(err.invalidFields));
        assert.ok(err.invalidFields.includes('street'));
        assert.ok(err.invalidFields.includes('city'));
        assert.ok(err.invalidFields.includes('country'));
        assert.ok(err.invalidFields.includes('postalCode'));
        return true;
      },
    );
  });
});
