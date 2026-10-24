import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cacheCommand } from '../commands/cache';

describe('Cache clear command (logout)', () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar_card_test_'));
    originalEnv = { HOME: process.env.HOME };
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    if (fs.existsSync(tempDir)) {
      const cacheDir = path.join(tempDir, '.stellar_card');
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(cacheDir, file));
        }
        fs.rmdirSync(cacheDir);
      }
      fs.rmdirSync(tempDir);
    }
  });

  it('should report no files to delete when cache dir does not exist', async () => {
    const writeStub = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = await cacheCommand([]);
    expect(result).toBe(0);
    expect(writeStub).toHaveBeenCalledWith('No cached files found to delete.\n');
    writeStub.mockRestore();
  });

  it('should prompt user before deleting cache files', async () => {
    const cacheDir = path.join(tempDir, '.stellar_card');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'cache.json');
    fs.writeFileSync(cacheFile, JSON.stringify({ test: 'data' }));

    const writeStub = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const questionStub = vi
      .spyOn(require('readline'), 'createInterface')
      .mockReturnValue({
        question: (prompt: string, callback: (answer: string) => void) => {
          callback('no');
        },
        close: () => {},
      } as any);

    const result = await cacheCommand([]);
    expect(result).toBe(0);
    expect(writeStub).toHaveBeenCalledWith(
      expect.stringContaining('The following files will be deleted:'),
    );
    expect(fs.existsSync(cacheFile)).toBe(true);

    writeStub.mockRestore();
    questionStub.mockRestore();
  });

  it('should delete cache file when user confirms', async () => {
    const cacheDir = path.join(tempDir, '.stellar_card');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'cache.json');
    fs.writeFileSync(cacheFile, JSON.stringify({ test: 'data' }));

    const writeStub = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const questionStub = vi
      .spyOn(require('readline'), 'createInterface')
      .mockReturnValue({
        question: (prompt: string, callback: (answer: string) => void) => {
          callback('yes');
        },
        close: () => {},
      } as any);

    const result = await cacheCommand([]);
    expect(result).toBe(0);
    expect(fs.existsSync(cacheFile)).toBe(false);
    expect(writeStub).toHaveBeenCalledWith('✓ Cache cleared successfully.\n');

    writeStub.mockRestore();
    questionStub.mockRestore();
  });

  it('should handle both cache.json and config.json deletion', async () => {
    const cacheDir = path.join(tempDir, '.stellar_card');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'cache.json');
    const configFile = path.join(cacheDir, 'config.json');
    fs.writeFileSync(cacheFile, '{}');
    fs.writeFileSync(configFile, '{}');

    const writeStub = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const questionStub = vi
      .spyOn(require('readline'), 'createInterface')
      .mockReturnValue({
        question: (prompt: string, callback: (answer: string) => void) => {
          callback('yes');
        },
        close: () => {},
      } as any);

    const result = await cacheCommand([]);
    expect(result).toBe(0);
    expect(fs.existsSync(cacheFile)).toBe(false);
    expect(fs.existsSync(configFile)).toBe(false);

    writeStub.mockRestore();
    questionStub.mockRestore();
  });

  it('should securely overwrite file before deletion', async () => {
    const cacheDir = path.join(tempDir, '.stellar_card');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'cache.json');
    const sensitiveData = 'SECRET_API_KEY_12345';
    fs.writeFileSync(cacheFile, sensitiveData);

    const writeStub = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const writeFileStub = vi.spyOn(fs, 'writeFileSync').mockImplementation(fs.writeFileSync);
    const questionStub = vi
      .spyOn(require('readline'), 'createInterface')
      .mockReturnValue({
        question: (prompt: string, callback: (answer: string) => void) => {
          callback('yes');
        },
        close: () => {},
      } as any);

    await cacheCommand([]);

    expect(writeFileStub).toHaveBeenCalledWith(cacheFile, expect.any(Buffer));
    expect(fs.existsSync(cacheFile)).toBe(false);

    writeStub.mockRestore();
    writeFileStub.mockRestore();
    questionStub.mockRestore();
  });
});
