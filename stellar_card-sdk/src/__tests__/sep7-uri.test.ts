/**
 * Unit tests for SEP-0007 URI generation and parsing (#772).
 */

import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  buildSep7PayUri,
  buildSep7TxUri,
  parseSep7Uri,
} from '../utils/sep7';

const kp = Keypair.random();
const DEST_REAL = kp.publicKey();
const ISSUER = Keypair.random().publicKey();

describe('buildSep7PayUri', () => {
  it('builds a native XLM pay URI', () => {
    const uri = buildSep7PayUri({
      destination: DEST_REAL,
      amount: '10.00',
      memo: 'ord_abc',
    });
    expect(uri.startsWith('web+stellar:pay?')).toBe(true);
    expect(uri).toContain(`destination=${DEST_REAL}`);
    expect(uri).toContain('amount=10.00');
    expect(uri).toContain('memo=ord_abc');
    expect(uri).toContain('memo_type=MEMO_TEXT');
    expect(uri).not.toContain('asset_code');
  });

  it('includes asset_code and asset_issuer for USDC', () => {
    const uri = buildSep7PayUri({
      destination: DEST_REAL,
      amount: '25.5',
      assetCode: 'USDC',
      assetIssuer: ISSUER,
    });
    expect(uri).toContain('asset_code=USDC');
    expect(uri).toContain(`asset_issuer=${ISSUER}`);
  });

  it('rejects invalid destination', () => {
    expect(() => buildSep7PayUri({ destination: 'not-a-key' })).toThrow(/invalid destination/i);
  });

  it('rejects non-native asset without issuer', () => {
    expect(() =>
      buildSep7PayUri({ destination: DEST_REAL, assetCode: 'USDC' }),
    ).toThrow(/asset_issuer/i);
  });

  it('rejects invalid amount', () => {
    expect(() =>
      buildSep7PayUri({ destination: DEST_REAL, amount: '-1' }),
    ).toThrow(/invalid amount/i);
  });

  it('signs the URI when signingKey is provided', () => {
    const signer = Keypair.random();
    const uri = buildSep7PayUri({
      destination: DEST_REAL,
      amount: '1',
      originDomain: 'stellar_card.com',
      signingKey: signer.secret(),
    });
    expect(uri).toContain('signature=');
    const parsed = parseSep7Uri(uri);
    expect(parsed.signature).toBeTruthy();
    expect(parsed.originDomain).toBe('stellar_card.com');
  });
});

describe('buildSep7TxUri', () => {
  it('builds a tx URI with xdr', () => {
    const uri = buildSep7TxUri({ xdr: 'AAAAAgAAAAD...' });
    expect(uri).toBe('web+stellar:tx?xdr=AAAAAgAAAAD...');
  });

  it('requires xdr', () => {
    expect(() => buildSep7TxUri({ xdr: '' })).toThrow(/xdr is required/i);
  });

  it('includes callback and network_passphrase', () => {
    const uri = buildSep7TxUri({
      xdr: 'ABCD',
      callback: 'https://example.com/cb',
      networkPassphrase: 'Test SDF Network ; August 2021',
    });
    expect(uri).toContain('callback=');
    expect(uri).toContain('network_passphrase=');
  });
});

describe('parseSep7Uri', () => {
  it('round-trips a pay URI', () => {
    const uri = buildSep7PayUri({
      destination: DEST_REAL,
      amount: '5.00',
      assetCode: 'USDC',
      assetIssuer: ISSUER,
      memo: 'hello',
    });
    const parsed = parseSep7Uri(uri);
    expect(parsed.type).toBe('pay');
    expect(parsed.destination).toBe(DEST_REAL);
    expect(parsed.amount).toBe('5.00');
    expect(parsed.assetCode).toBe('USDC');
    expect(parsed.assetIssuer).toBe(ISSUER);
    expect(parsed.memo).toBe('hello');
  });

  it('parses a tx URI', () => {
    const parsed = parseSep7Uri('web+stellar:tx?xdr=AAAA&msg=hi');
    expect(parsed.type).toBe('tx');
    expect(parsed.xdr).toBe('AAAA');
    expect(parsed.msg).toBe('hi');
  });

  it('rejects non-SEP7 schemes', () => {
    expect(() => parseSep7Uri('https://example.com')).toThrow(/must start with/i);
  });

  it('rejects unknown operation types', () => {
    expect(() => parseSep7Uri('web+stellar:foo?a=1')).toThrow(/unsupported operation/i);
  });

  it('rejects pay URI without destination', () => {
    expect(() => parseSep7Uri('web+stellar:pay?amount=1')).toThrow(/missing destination/i);
  });
});
