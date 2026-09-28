import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  NodeFileSystemKeystore,
  BrowserKeystore,
  createKeystore,
} from '../keystore';
import { saveWalletToKeystore, loadWalletFromKeystore } from '../ows';

describe('EncryptedKeystore Adapters (#705)', () => {
  const testDir = path.join(os.tmpdir(), `stellar-card-keystore-test-${Date.now()}`);
  const testKey = 'agent_wallet_test';
  const testSecret = 'SDJFKLSJDFKLSDJFKLSJDFKLSDJFKLSJDFKLSDJFKLSJDFKLSDJFKLSJD';
  const testPassphrase = 'super-secret-agent-passphrase-2026';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('NodeFileSystemKeystore', () => {
    it('encrypts and persists wallet secret on disk', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      await keystore.set(testKey, testSecret, testPassphrase);

      const filePath = path.join(testDir, `${testKey}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      const fileContent = fs.readFileSync(filePath, 'utf8');
      expect(fileContent).not.toContain(testSecret); // Never stored in plaintext
      const payload = JSON.parse(fileContent);
      expect(payload).toHaveProperty('value');
      expect(payload).toHaveProperty('iv');
      expect(payload).toHaveProperty('salt');

      const decrypted = await keystore.get(testKey, testPassphrase);
      expect(decrypted).toBe(testSecret);
    });

    it('fails decryption with wrong passphrase', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      await keystore.set(testKey, testSecret, testPassphrase);

      await expect(keystore.get(testKey, 'wrong-passphrase')).rejects.toThrow();
    });

    it('returns null for non-existent key', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      const result = await keystore.get('non_existent', testPassphrase);
      expect(result).toBeNull();
    });

    it('lists stored wallet identifiers', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      await keystore.set('wallet_1', testSecret, testPassphrase);
      await keystore.set('wallet_2', testSecret, testPassphrase);

      const list = await keystore.list();
      expect(list).toContain('wallet_1');
      expect(list).toContain('wallet_2');
      expect(list.length).toBe(2);
    });

    it('deletes wallet credentials', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      await keystore.set(testKey, testSecret, testPassphrase);

      const deleted = await keystore.delete(testKey);
      expect(deleted).toBe(true);

      const afterDelete = await keystore.get(testKey, testPassphrase);
      expect(afterDelete).toBeNull();

      const deleteAgain = await keystore.delete(testKey);
      expect(deleteAgain).toBe(false);
    });

    it('rejects empty passphrase', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      await expect(keystore.set(testKey, testSecret, '')).rejects.toThrowError(
        /non-empty passphrase/,
      );
      await expect(keystore.get(testKey, '')).rejects.toThrowError(
        /non-empty passphrase/,
      );
    });
  });

  describe('BrowserKeystore', () => {
    it('encrypts and retrieves credentials in browser storage adapter', async () => {
      const browserStore = new BrowserKeystore();
      await browserStore.set('browser_wallet', testSecret, testPassphrase);

      const retrieved = await browserStore.get('browser_wallet', testPassphrase);
      expect(retrieved).toBe(testSecret);

      const keys = await browserStore.list();
      expect(keys).toContain('browser_wallet');

      const deleted = await browserStore.delete('browser_wallet');
      expect(deleted).toBe(true);
      expect(await browserStore.get('browser_wallet', testPassphrase)).toBeNull();
    });
  });

  describe('createKeystore factory', () => {
    it('instantiates Node keystore by default in Node runtime', () => {
      const store = createKeystore({ baseDir: testDir });
      expect(store).toBeInstanceOf(NodeFileSystemKeystore);
    });

    it('instantiates Browser keystore when explicitly specified', () => {
      const store = createKeystore({ type: 'browser' });
      expect(store).toBeInstanceOf(BrowserKeystore);
    });
  });

  describe('OWS integration helpers', () => {
    it('saves and loads wallet using saveWalletToKeystore and loadWalletFromKeystore', async () => {
      const keystore = new NodeFileSystemKeystore(testDir);
      await saveWalletToKeystore(testKey, testSecret, testPassphrase, keystore);

      const loaded = await loadWalletFromKeystore(testKey, testPassphrase, keystore);
      expect(loaded).toBe(testSecret);
    });
  });
});
