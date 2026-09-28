// Unit tests for Soroban custom contract error decoding
import { describe, it, expect } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import {
  parseContractError,
  extractContractErrorCode,
  CONTRACT_ERROR_MESSAGES,
  ContractExecutionError,
} from '../soroban';

describe('Soroban contract error decoder', () => {
  describe('CONTRACT_ERROR_MESSAGES', () => {
    it('maps known contract error codes to descriptive messages', () => {
      expect(CONTRACT_ERROR_MESSAGES[1]).toBe('Invalid amount: amount must be positive');
      expect(CONTRACT_ERROR_MESSAGES[2]).toBe('Transfer failed: token transfer operation failed');
      expect(CONTRACT_ERROR_MESSAGES[3]).toBe(
        'Contract paused: no new payments accepted until unpaused',
      );
      expect(CONTRACT_ERROR_MESSAGES[4]).toBe('Withdraw limit exceeded');
      expect(CONTRACT_ERROR_MESSAGES[5]).toBe('Daily withdraw limit exceeded');
      expect(CONTRACT_ERROR_MESSAGES[6]).toBe('Invalid recipient');
    });
  });

  describe('extractContractErrorCode', () => {
    it('extracts code from raw number', () => {
      expect(extractContractErrorCode(1)).toBe(1);
      expect(extractContractErrorCode(2)).toBe(2);
      expect(extractContractErrorCode(3)).toBe(3);
    });

    it('extracts code from numeric string', () => {
      expect(extractContractErrorCode('1')).toBe(1);
      expect(extractContractErrorCode('42')).toBe(42);
    });

    it('extracts code from HostError string formats', () => {
      expect(extractContractErrorCode('HostError: Error(Contract, #1)')).toBe(1);
      expect(extractContractErrorCode('Error(Contract, 2)')).toBe(2);
      expect(extractContractErrorCode('Error(Contract, #3)')).toBe(3);
      expect(extractContractErrorCode('Contract error: 4')).toBe(4);
    });

    it('extracts code from object with contractCode or code', () => {
      expect(extractContractErrorCode({ contractCode: 1 })).toBe(1);
      expect(extractContractErrorCode({ code: 2 })).toBe(2);
      expect(extractContractErrorCode({ errorCode: 3 })).toBe(3);
    });

    it('extracts code from simulation error response object', () => {
      const simError = {
        error: 'HostError: Error(Contract, #2)',
      };
      expect(extractContractErrorCode(simError)).toBe(2);
    });

    it('extracts code from base64 ScVal XDR', () => {
      // ScVal containing sceContract(2)
      const scErr = xdr.ScError.sceContract(2);
      const scVal = xdr.ScVal.scvError(scErr);
      const b64 = scVal.toXDR('base64');

      expect(extractContractErrorCode(b64)).toBe(2);
    });

    it('extracts code from events array', () => {
      const scErr = xdr.ScError.sceContract(3);
      const scVal = xdr.ScVal.scvError(scErr);
      const b64 = scVal.toXDR('base64');

      const simResult = {
        events: ['some_other_xdr', b64],
      };
      expect(extractContractErrorCode(simResult)).toBe(3);
    });

    it('returns null for unrelated strings or objects without error codes', () => {
      expect(extractContractErrorCode('Network connection refused')).toBeNull();
      expect(extractContractErrorCode({ status: 'SUCCESS' })).toBeNull();
      expect(extractContractErrorCode(null)).toBeNull();
      expect(extractContractErrorCode(undefined)).toBeNull();
    });
  });

  describe('parseContractError', () => {
    it('decodes Error::InvalidAmount (code 1)', () => {
      const err = parseContractError(1);
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err.contractCode).toBe(1);
      expect(err.explanation).toBe('Invalid amount: amount must be positive');
      expect(err.message).toContain('Invalid amount: amount must be positive');
      expect(err.status).toBe(400);
    });

    it('decodes Error::TransferFailed (code 2)', () => {
      const err = parseContractError(2);
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err.contractCode).toBe(2);
      expect(err.explanation).toBe('Transfer failed: token transfer operation failed');
    });

    it('decodes Error::ContractPaused (code 3)', () => {
      const err = parseContractError(3);
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err.contractCode).toBe(3);
      expect(err.explanation).toBe('Contract paused: no new payments accepted until unpaused');
    });

    it('decodes Error::WithdrawLimitExceeded (code 4)', () => {
      const err = parseContractError(4);
      expect(err.contractCode).toBe(4);
      expect(err.explanation).toBe('Withdraw limit exceeded');
    });

    it('decodes Error::DailyWithdrawLimitExceeded (code 5)', () => {
      const err = parseContractError(5);
      expect(err.contractCode).toBe(5);
      expect(err.explanation).toBe('Daily withdraw limit exceeded');
    });

    it('decodes Error::InvalidRecipient (code 6)', () => {
      const err = parseContractError(6);
      expect(err.contractCode).toBe(6);
      expect(err.explanation).toBe('Invalid recipient');
    });

    it('handles unknown custom error codes gracefully with fallback string', () => {
      const err = parseContractError(99);
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err.contractCode).toBe(99);
      expect(err.explanation).toBe('Unknown custom contract error: 99');
      expect(err.message).toContain('Unknown custom contract error: 99');
    });

    it('decodes simulation error response from RPC', () => {
      const sim = {
        error: 'HostError: Error(Contract, #3)',
      };
      const err = parseContractError(sim);
      expect(err.contractCode).toBe(3);
      expect(err.explanation).toBe('Contract paused: no new payments accepted until unpaused');
    });

    it('decodes transaction error from diagnostic events', () => {
      const scErr = xdr.ScError.sceContract(1);
      const scVal = xdr.ScVal.scvError(scErr);
      const b64 = scVal.toXDR('base64');

      const txResult = {
        status: 'FAILED',
        diagnosticEvents: [b64],
      };
      const err = parseContractError(txResult);
      expect(err.contractCode).toBe(1);
      expect(err.explanation).toBe('Invalid amount: amount must be positive');
    });

    it('handles unparseable input with generic fallback', () => {
      const err = parseContractError('Something went wrong');
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err.contractCode).toBe(0);
      expect(err.explanation).toBe('Unknown contract error: Something went wrong');
    });

    it('serializes to JSON properly', () => {
      const err = parseContractError(1);
      const json = err.toJSON();
      expect(json.name).toBe('ContractExecutionError');
      expect(json.status).toBe(400);
      expect(json.message).toContain('Invalid amount');
    });
  });
});
