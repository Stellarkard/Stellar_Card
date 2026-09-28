/**
 * Cross-platform secure keystore adapter for Node.js and browser environments.
 *
 * Implements the EncryptedKeystore interface to securely store and retrieve
 * encrypted wallet credentials at rest using AES-256-GCM authenticated encryption.
 */

import { encrypt, decrypt, type EncryptedPayload } from './encryption';

export interface EncryptedKeystore {
  /**
   * Encrypt and store a wallet secret under the specified key identifier.
   *
   * @param key - Identifier for the wallet or credential
   * @param secret - Sensitive secret (e.g. Stellar secret key)
   * @param passphrase - User passphrase used to derive the AES-256-GCM key
   */
  set(key: string, secret: string, passphrase: string): Promise<void>;

  /**
   * Retrieve and decrypt a wallet secret.
   *
   * @param key - Identifier for the wallet
   * @param passphrase - User passphrase used during encryption
   * @returns Decrypted plaintext secret or null if not found
   */
  get(key: string, passphrase: string): Promise<string | null>;

  /**
   * Delete a stored wallet secret.
   *
   * @param key - Identifier for the wallet
   * @returns True if deleted, false if the key did not exist
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all stored wallet identifiers.
   *
   * @returns Array of wallet keys
   */
  list(): Promise<string[]>;
}

// ── Key identifier sanitizer ────────────────────────────────────────────────

const SAFE_KEY_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function sanitizeKey(key: string): string {
  const trimmed = key.trim();
  if (!SAFE_KEY_REGEX.test(trimmed)) {
    throw new Error(`Invalid keystore key identifier: "${key}". Must be 1-128 alphanumeric characters, dashes, or underscores.`);
  }
  return trimmed;
}

// ── Node.js Filesystem Keystore Adapter ──────────────────────────────────────

export class NodeFileSystemKeystore implements EncryptedKeystore {
  private baseDir: string;

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = customBaseDir;
    } else {
      // Lazy import Node modules to keep browser bundlers safe
      const os = require('os');
      const path = require('path');
      this.baseDir = path.join(os.homedir(), '.stellar-card', 'wallets');
    }
  }

  private ensureDir(): void {
    const fs = require('fs');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.baseDir, 0o700);
      } catch {
        /* best-effort */
      }
    }
  }

  private getFilePath(key: string): string {
    const path = require('path');
    const safeKey = sanitizeKey(key);
    return path.join(this.baseDir, `${safeKey}.json`);
  }

  async set(key: string, secret: string, passphrase: string): Promise<void> {
    if (!passphrase || !passphrase.trim()) {
      throw new Error('A non-empty passphrase is required to securely encrypt wallet credentials');
    }
    this.ensureDir();

    const payload = await encrypt(secret, { passphrase, context: 'wallet-keystore' });
    const filePath = this.getFilePath(key);
    const fs = require('fs');
    const crypto = require('crypto');

    const tmpPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const body = JSON.stringify(payload, null, 2);

    let committed = false;
    try {
      const fd = fs.openSync(tmpPath, 'w', 0o600);
      try {
        fs.writeFileSync(fd, body, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, filePath);
      committed = true;
    } finally {
      if (!committed) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async get(key: string, passphrase: string): Promise<string | null> {
    if (!passphrase || !passphrase.trim()) {
      throw new Error('A non-empty passphrase is required to decrypt wallet credentials');
    }
    const filePath = this.getFilePath(key);
    const fs = require('fs');

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }

    const payload = JSON.parse(raw) as EncryptedPayload;
    return decrypt({ payload, passphrase, context: 'wallet-keystore' });
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    const fs = require('fs');
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  async list(): Promise<string[]> {
    const fs = require('fs');
    try {
      if (!fs.existsSync(this.baseDir)) return [];
      const files: string[] = fs.readdirSync(this.baseDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}

// ── Browser Keystore Adapter (IndexedDB / localStorage with WebCrypto) ───────

export class BrowserKeystore implements EncryptedKeystore {
  private storagePrefix = 'stellar_card_wallet_';
  private memoryFallback = new Map<string, string>();

  private getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; keys(): string[] } {
    if (typeof window !== 'undefined' && window.localStorage) {
      return {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
        removeItem: (k) => window.localStorage.removeItem(k),
        keys: () => Object.keys(window.localStorage),
      };
    }
    return {
      getItem: (k) => this.memoryFallback.get(k) ?? null,
      setItem: (k, v) => this.memoryFallback.set(k, v),
      removeItem: (k) => this.memoryFallback.delete(k),
      keys: () => Array.from(this.memoryFallback.keys()),
    };
  }

  async set(key: string, secret: string, passphrase: string): Promise<void> {
    if (!passphrase || !passphrase.trim()) {
      throw new Error('A non-empty passphrase is required to securely encrypt wallet credentials');
    }
    const safeKey = sanitizeKey(key);
    const payload = await encrypt(secret, { passphrase, context: 'wallet-keystore' });
    const storage = this.getStorage();
    storage.setItem(`${this.storagePrefix}${safeKey}`, JSON.stringify(payload));
  }

  async get(key: string, passphrase: string): Promise<string | null> {
    if (!passphrase || !passphrase.trim()) {
      throw new Error('A non-empty passphrase is required to decrypt wallet credentials');
    }
    const safeKey = sanitizeKey(key);
    const storage = this.getStorage();
    const raw = storage.getItem(`${this.storagePrefix}${safeKey}`);
    if (!raw) return null;

    const payload = JSON.parse(raw) as EncryptedPayload;
    return decrypt({ payload, passphrase, context: 'wallet-keystore' });
  }

  async delete(key: string): Promise<boolean> {
    const safeKey = sanitizeKey(key);
    const storage = this.getStorage();
    const fullKey = `${this.storagePrefix}${safeKey}`;
    if (storage.getItem(fullKey) === null) {
      return false;
    }
    storage.removeItem(fullKey);
    return true;
  }

  async list(): Promise<string[]> {
    const storage = this.getStorage();
    return storage
      .keys()
      .filter((k) => k.startsWith(this.storagePrefix))
      .map((k) => k.slice(this.storagePrefix.length));
  }
}

/**
 * Create an EncryptedKeystore appropriate for the current runtime environment.
 *
 * Defaults to NodeFileSystemKeystore in Node.js and BrowserKeystore in browsers.
 *
 * @param options - Custom configuration (target type and base directory)
 * @returns Configured EncryptedKeystore instance
 */
export function createKeystore(options?: {
  type?: 'node' | 'browser' | 'auto';
  baseDir?: string;
}): EncryptedKeystore {
  const type = options?.type ?? (typeof window !== 'undefined' ? 'browser' : 'node');
  if (type === 'browser') {
    return new BrowserKeystore();
  }
  return new NodeFileSystemKeystore(options?.baseDir);
}
