// Unit tests for issue #954 — Soroban contract upgrade event handler.
//
// Verifies that handleContractUpgradeEvent():
//   - detects contract_upgraded events by symbol
//   - logs the new WASM hash to audit (system_state)
//   - emits a stellar.contract_upgraded bizEvent
//   - sends an admin alert email
//   - flags ABI incompatibility when known payment symbols are missing

require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDb } = require('../helpers/app');

// ── Module cache patching ─────────────────────────────────────────────────────

function patchCache(relPath, exports) {
  const abs = require.resolve(`../../src/${relPath}`);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports, children: [], paths: [] };
}

// Collect bizEvent calls
const bizEvents = [];
patchCache('lib/logger', {
  event: (name, fields) => bizEvents.push({ name, fields }),
  logger: { info: () => {}, warn: () => {}, error: () => {} },
});

// Collect alert emails
const alertEmails = [];
patchCache('lib/email', {
  sendAlertEmail: async (opts) => { alertEmails.push(opts); },
});

const { handleContractUpgradeEvent } = require('../../src/payments/stellar');

// ── Helpers ───────────────────────────────────────────────────────────────────

const logs = [];
function testLog(msg) { logs.push(msg); }

// Build a minimal contract_upgraded event.
// When wasmBytes is provided, encodes as Soroban ScVal Bytes.
function makeUpgradeEvent(opts = {}) {
  const { wasmHex = 'a'.repeat(64), ledger = 1234, txHash = 'tx-abc', withSymbols = null } = opts;

  // Minimal scValToNative mock: for Bytes → Buffer, for strings → string, arrays → array.
  const topic0 = { type: 'scvSymbol', value: 'contract_upgraded' };
  const valueBytes = Buffer.from(wasmHex, 'hex');

  const topic = [topic0];
  if (withSymbols !== null) {
    // topic[2] is the parser_symbols array
    topic.push(null); // topic[1] placeholder
    topic.push({ type: 'scvVec', value: withSymbols.map((s) => ({ type: 'scvSymbol', value: s })) });
  }

  return {
    topic,
    value: { type: 'scvBytes', value: valueBytes },
    ledger,
    txHash,
    id: `${ledger}-0-0-0`,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleContractUpgradeEvent — WASM hash logging', () => {
  beforeEach(() => {
    resetDb();
    bizEvents.length = 0;
    alertEmails.length = 0;
    logs.length = 0;
    process.env.CARDS402_PLATFORM_OWNER_EMAIL = 'admin@example.com';
    process.env.RECEIVER_CONTRACT_ID = 'CTEST';
  });

  afterEach(() => {
    delete process.env.CARDS402_PLATFORM_OWNER_EMAIL;
  });

  it('persists the new WASM hash to system_state', async () => {
    const event = makeUpgradeEvent({ wasmHex: 'deadbeef'.repeat(8) });
    await handleContractUpgradeEvent(event, testLog);

    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'last_contract_upgrade'`).get();
    assert.ok(row, 'system_state row should exist');
    const data = JSON.parse(row.value);
    assert.equal(data.wasm_hash, 'deadbeef'.repeat(8));
    assert.equal(data.ledger, 1234);
    assert.equal(data.tx_hash, 'tx-abc');
  });

  it('emits stellar.contract_upgraded bizEvent', async () => {
    const event = makeUpgradeEvent();
    await handleContractUpgradeEvent(event, testLog);

    const ev = bizEvents.find((e) => e.name === 'stellar.contract_upgraded');
    assert.ok(ev, 'should emit stellar.contract_upgraded');
    assert.equal(typeof ev.fields.new_wasm_hash, 'string');
    assert.equal(ev.fields.ledger, 1234);
  });

  it('sends an admin alert email when CARDS402_PLATFORM_OWNER_EMAIL is set', async () => {
    const event = makeUpgradeEvent();
    await handleContractUpgradeEvent(event, testLog);

    assert.equal(alertEmails.length, 1);
    assert.equal(alertEmails[0].to, 'admin@example.com');
    assert.match(alertEmails[0].subject, /contract upgraded/i);
  });

  it('does not throw when CARDS402_PLATFORM_OWNER_EMAIL is unset', async () => {
    delete process.env.CARDS402_PLATFORM_OWNER_EMAIL;
    const event = makeUpgradeEvent();
    await assert.doesNotReject(() => handleContractUpgradeEvent(event, testLog));
  });
});

describe('handleContractUpgradeEvent — ABI version check', () => {
  beforeEach(() => {
    resetDb();
    bizEvents.length = 0;
    alertEmails.length = 0;
    process.env.CARDS402_PLATFORM_OWNER_EMAIL = 'admin@example.com';
  });

  afterEach(() => {
    delete process.env.CARDS402_PLATFORM_OWNER_EMAIL;
  });

  it('marks abi_compatible=true when pay_usdc and pay_xlm are present in topic[2]', async () => {
    const event = makeUpgradeEvent({ withSymbols: ['pay_usdc', 'pay_xlm', 'contract_upgraded'] });
    await handleContractUpgradeEvent(event, testLog);

    const ev = bizEvents.find((e) => e.name === 'stellar.contract_upgraded');
    assert.equal(ev.fields.abi_compatible, true);
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'last_contract_upgrade'`).get();
    assert.equal(JSON.parse(row.value).abi_compatible, true);
  });

  it('marks abi_compatible=false when a known payment symbol is missing', async () => {
    const event = makeUpgradeEvent({ withSymbols: ['pay_usdc'] }); // missing pay_xlm
    await handleContractUpgradeEvent(event, testLog);

    const ev = bizEvents.find((e) => e.name === 'stellar.contract_upgraded');
    assert.equal(ev.fields.abi_compatible, false);
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'last_contract_upgrade'`).get();
    assert.equal(JSON.parse(row.value).abi_compatible, false);
  });

  it('defaults to abi_compatible=true when topic[2] is absent', async () => {
    // No withSymbols → no topic[2], can't tell → assume compatible.
    const event = makeUpgradeEvent({ withSymbols: null });
    await handleContractUpgradeEvent(event, testLog);

    const ev = bizEvents.find((e) => e.name === 'stellar.contract_upgraded');
    assert.equal(ev.fields.abi_compatible, true);
  });

  it('includes a warning in the email subject on ABI mismatch', async () => {
    const event = makeUpgradeEvent({ withSymbols: ['pay_usdc'] }); // missing pay_xlm
    await handleContractUpgradeEvent(event, testLog);

    assert.ok(alertEmails.length > 0, 'alert email should be sent');
    assert.match(alertEmails[0].subject, /incompatible/i);
  });
});
