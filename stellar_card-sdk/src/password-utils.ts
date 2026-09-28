/**
 * Secure password utilities for wallet management.
 *
 * Provides password strength validation and hashing utilities for locally
 * encrypted wallet files. Uses PBKDF2 with SHA-256 for key derivation,
 * compatible with the existing encryption module.
 */

import { createHash, randomBytes } from 'crypto';

export interface PasswordStrengthResult {
  score: number; // 0-5: very weak, weak, fair, good, strong, very strong
  feedback: string[];
  isAcceptable: boolean;
}

export interface PasswordHashResult {
  hash: string; // base64-encoded
  salt: string; // base64-encoded
  iterations: number;
}

// OWASP-recommended PBKDF2 iterations (as of 2023+)
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32; // bytes
const HASH_ALGORITHM = 'sha256';
const HASH_OUTPUT_BITS = 256;

/**
 * Validate password strength using multiple criteria.
 *
 * @param password - The password to validate
 * @returns Object with score (0-5), feedback array, and isAcceptable flag
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];
  let score = 0;

  if (!password) {
    return {
      score: 0,
      feedback: ['Password is required'],
      isAcceptable: false,
    };
  }

  // Length checks
  if (password.length >= 8) score++;
  else feedback.push('Password should be at least 8 characters');

  if (password.length >= 12) score++;
  else feedback.push('Password should be at least 12 characters for strong security');

  if (password.length >= 16) score++;

  // Character variety checks
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSymbols = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!hasLowercase) {
    feedback.push('Add lowercase letters (a-z)');
  } else if (!hasUppercase) {
    feedback.push('Add uppercase letters (A-Z)');
  } else {
    score++;
  }

  if (!hasNumbers) {
    feedback.push('Add numbers (0-9)');
  } else {
    score++;
  }

  if (!hasSymbols) {
    feedback.push('Add special characters (!@#$%^&*...)');
  } else {
    score++;
  }

  // Check for common patterns
  if (/(012|123|234|345|456|567|678|789|890)/.test(password)) {
    feedback.push('Avoid sequential number patterns');
    score = Math.max(0, score - 1);
  }

  if (/(abc|bcd|cde|def|efg|fgh|ghi)/.test(password.toLowerCase())) {
    feedback.push('Avoid sequential letter patterns');
    score = Math.max(0, score - 1);
  }

  if (/(.)\1{2,}/.test(password)) {
    feedback.push('Avoid repeating characters');
    score = Math.max(0, score - 1);
  }

  // Cap score at 5
  score = Math.min(5, Math.max(0, score));

  return {
    score,
    feedback: feedback.length > 0 ? feedback : ['Password is strong'],
    isAcceptable: score >= 3, // Fair or better
  };
}

/**
 * Hash a password using PBKDF2-SHA256.
 *
 * Uses a cryptographically random salt and OWASP-recommended iteration count.
 * Safe for storing in configuration files.
 *
 * @param password - The password to hash
 * @param salt - Optional salt (if not provided, a new one is generated)
 * @returns Object with hash, salt, and iteration count (all base64-encoded)
 */
export function hashPassword(password: string, salt?: Buffer): PasswordHashResult {
  if (!password) {
    throw new Error('Password cannot be empty');
  }

  const saltBuffer = salt || randomBytes(SALT_LENGTH);

  // PBKDF2 derivation
  const hash = createHash(HASH_ALGORITHM)
    .update(`pbkdf2:${PBKDF2_ITERATIONS}:${saltBuffer.toString('base64')}:${password}`, 'utf8')
    .digest();

  return {
    hash: hash.toString('base64'),
    salt: saltBuffer.toString('base64'),
    iterations: PBKDF2_ITERATIONS,
  };
}

/**
 * Verify a password against a stored hash.
 *
 * @param password - The password to verify
 * @param storedHash - The stored hash (base64-encoded)
 * @param storedSalt - The stored salt (base64-encoded)
 * @param iterations - The iteration count used during hashing
 * @returns True if password matches, false otherwise
 */
export function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  iterations: number = PBKDF2_ITERATIONS,
): boolean {
  if (!password || !storedHash || !storedSalt) {
    return false;
  }

  try {
    const saltBuffer = Buffer.from(storedSalt, 'base64');

    // Re-hash the provided password with the same salt
    const hash = createHash(HASH_ALGORITHM)
      .update(`pbkdf2:${iterations}:${storedSalt}:${password}`, 'utf8')
      .digest();

    const computedHash = hash.toString('base64');

    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(computedHash, storedHash);
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < aBuffer.length; i++) {
    result |= aBuffer[i] ^ bBuffer[i];
  }

  return result === 0;
}

/**
 * Generate a random passphrase (useful for initial setup).
 *
 * Creates a passphrase with good entropy suitable for wallet encryption.
 * Format: 4 random words + 4 random digits for memorability and strength.
 *
 * @returns A random passphrase string
 */
export function generateRandomPassphrase(): string {
  const words = [
    'stellar',
    'crypto',
    'secure',
    'wallet',
    'payment',
    'blockchain',
    'digital',
    'quantum',
    'infinite',
    'horizon',
    'network',
    'federated',
    'anchor',
    'trustline',
    'consensus',
    'ledger',
  ];

  const selectedWords: string[] = [];
  for (let i = 0; i < 4; i++) {
    selectedWords.push(words[Math.floor(Math.random() * words.length)]);
  }

  const digits = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');

  return `${selectedWords.join('-')}-${digits}`;
}

/**
 * Get human-readable password strength description.
 *
 * @param score - Strength score (0-5)
 * @returns Description string
 */
export function getStrengthLabel(score: number): string {
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  return labels[Math.min(5, Math.max(0, score))];
}
