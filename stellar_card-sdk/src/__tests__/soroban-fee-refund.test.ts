/**
 * Unit tests for Soroban gas / fee refund tracking (#769).
 */

import { describe, it, expect, vi } from 'vitest';
import { computeFeeRefund, extractFeeMetricsFromHorizon } from '../soroban';
import type { Logger } from '../logger';

describe('computeFeeRefund', () => {
  it('returns maxFee − feeCharged as feeRefunded', () => {
    expect(computeFeeRefund('100000', '40000')).toEqual({
      maxFee: '100000',
      feeCharged: '40000',
      feeRefunded: '60000',
    });
  });

  it('accepts number and bigint inputs', () => {
    expect(computeFeeRefund(1000n, 250)).toEqual({
      maxFee: '1000',
      feeCharged: '250',
      feeRefunded: '750',
    });
  });

  it('clamps negative refunds to zero', () => {
    expect(computeFeeRefund('100', '150').feeRefunded).toBe('0');
  });

  it('handles zero charged fee (full refund)', () => {
    expect(computeFeeRefund('50000', '0').feeRefunded).toBe('50000');
  });
});

describe('extractFeeMetricsFromHorizon', () => {
  it('reads fee_charged and max_fee from Horizon JSON', () => {
    const metrics = extractFeeMetricsFromHorizon(
      { fee_charged: '12345', max_fee: '100000' },
      '999',
    );
    expect(metrics).toEqual({
      maxFee: '100000',
      feeCharged: '12345',
      feeRefunded: '87655',
    });
  });

  it('falls back to the allocated max fee when Horizon omits fields', () => {
    const metrics = extractFeeMetricsFromHorizon({}, '7777');
    expect(metrics).toEqual({
      maxFee: '7777',
      feeCharged: '7777',
      feeRefunded: '0',
    });
  });
});

describe('TransactionResult fee fields', () => {
  it('exposes feeCharged and feeRefunded on payment result objects', () => {
    const paymentResult = {
      hash: 'a'.repeat(64),
      feeCharged: '10000',
      feeRefunded: '90000',
      maxFee: '100000',
    };
    expect(paymentResult.feeCharged).toBe('10000');
    expect(paymentResult.feeRefunded).toBe('90000');
    expect(paymentResult.maxFee).toBe('100000');
  });
});

describe('gas efficiency debug logging', () => {
  it('logger.debug is the channel used for gas metrics', () => {
    const debug = vi.fn();
    const logger: Logger = {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const metrics = computeFeeRefund('100000', '25000');
    const efficiency = ((1 - Number(metrics.feeCharged) / Number(metrics.maxFee)) * 100).toFixed(1);
    logger.debug(
      `Soroban gas refund for abc: charged=${metrics.feeCharged} max=${metrics.maxFee} refunded=${metrics.feeRefunded} (${efficiency}% unused)`,
      metrics,
    );
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]![0]).toContain('75.0% unused');
  });
});
