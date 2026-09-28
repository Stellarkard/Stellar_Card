import { describe, it, expect } from 'vitest';
import { signMessage, verifyMessage, createWallet } from '../stellar';

describe('Message signing and verification (SEP-0032)', () => {
  it('should sign a string message and return a base64 signature', () => {
    const wallet = createWallet();
    const message = 'hello world';
    const signature = signMessage(message, wallet.secret);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');
    expect(signature.length > 0).toBe(true);
  });

  it('should sign binary (Uint8Array) message and return a base64 signature', () => {
    const wallet = createWallet();
    const message = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const signature = signMessage(message, wallet.secret);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');
  });

  it('should verify a valid message signature', () => {
    const wallet = createWallet();
    const message = 'test message';
    const signature = signMessage(message, wallet.secret);
    const isValid = verifyMessage(message, signature, wallet.publicKey);
    expect(isValid).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const wallet = createWallet();
    const message = 'test message';
    const invalidSignature = 'aW52YWxpZHNpZ25hdHVyZQ=='; // base64 for "invalidsignature"
    const isValid = verifyMessage(message, invalidSignature, wallet.publicKey);
    expect(isValid).toBe(false);
  });

  it('should reject a signature from a different message', () => {
    const wallet = createWallet();
    const message1 = 'message one';
    const message2 = 'message two';
    const signature = signMessage(message1, wallet.secret);
    const isValid = verifyMessage(message2, signature, wallet.publicKey);
    expect(isValid).toBe(false);
  });

  it('should reject a signature with a different public key', () => {
    const wallet1 = createWallet();
    const wallet2 = createWallet();
    const message = 'test message';
    const signature = signMessage(message, wallet1.secret);
    const isValid = verifyMessage(message, signature, wallet2.publicKey);
    expect(isValid).toBe(false);
  });

  it('should handle empty message strings', () => {
    const wallet = createWallet();
    const message = '';
    const signature = signMessage(message, wallet.secret);
    const isValid = verifyMessage(message, signature, wallet.publicKey);
    expect(isValid).toBe(true);
  });

  it('should handle empty Uint8Array messages', () => {
    const wallet = createWallet();
    const message = new Uint8Array([]);
    const signature = signMessage(message, wallet.secret);
    const isValid = verifyMessage(message, signature, wallet.publicKey);
    expect(isValid).toBe(true);
  });

  it('should handle binary message with both sign and verify', () => {
    const wallet = createWallet();
    const message = new Uint8Array([255, 254, 253, 0, 1, 2]);
    const signature = signMessage(message, wallet.secret);
    const isValid = verifyMessage(message, signature, wallet.publicKey);
    expect(isValid).toBe(true);
  });

  it('should return false for invalid signature format', () => {
    const wallet = createWallet();
    const message = 'test message';
    const invalidBase64 = '!!!invalid!!!base64!!!';
    const isValid = verifyMessage(message, invalidBase64, wallet.publicKey);
    expect(isValid).toBe(false);
  });

  it('should return false for invalid public key', () => {
    const wallet = createWallet();
    const message = 'test message';
    const signature = signMessage(message, wallet.secret);
    const isValid = verifyMessage(message, signature, 'INVALID_PUBLIC_KEY');
    expect(isValid).toBe(false);
  });

  it('should throw on invalid secret key', () => {
    const message = 'test message';
    expect(() => signMessage(message, 'INVALID_SECRET_KEY')).toThrow();
  });
});
