import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Bundle, Tree-Shaking and Exports Verification (#712)', () => {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  describe('Package Exports Map', () => {
    it('defines export map for ., ./browser, ./mcp, and ./ows', () => {
      const exportsMap = pkg.exports;
      expect(exportsMap).toBeDefined();

      // Root export
      expect(exportsMap['.']).toBeDefined();
      expect(exportsMap['.']['import']).toBeDefined();
      expect(exportsMap['.']['types']).toBeDefined();

      // Browser export
      expect(exportsMap['./browser']).toBeDefined();
      expect(exportsMap['./browser']['import']).toBeDefined();
      expect(exportsMap['./browser']['types']).toBe('./dist/browser.d.ts');

      // MCP export
      expect(exportsMap['./mcp']).toBeDefined();
      expect(exportsMap['./mcp']['import']).toBeDefined();
      expect(exportsMap['./mcp']['types']).toBe('./dist/mcp.d.ts');

      // OWS export
      expect(exportsMap['./ows']).toBeDefined();
      expect(exportsMap['./ows']['import']).toBeDefined();
      expect(exportsMap['./ows']['types']).toBe('./dist/ows.d.ts');
    });

    it('maps TypeScript declaration subpaths in typesVersions', () => {
      const typesVersions = pkg.typesVersions?.['*'];
      expect(typesVersions).toBeDefined();
      expect(typesVersions['browser']).toEqual(['./dist/browser.d.ts']);
      expect(typesVersions['mcp']).toEqual(['./dist/mcp.d.ts']);
      expect(typesVersions['ows']).toEqual(['./dist/ows.d.ts']);
    });
  });

  describe('Browser Bundle Isolation and Tree-Shaking', () => {
    const FORBIDDEN_BUILTINS = [
      'fs',
      'path',
      'os',
      'crypto',
      'child_process',
      'net',
      'tls',
      'dns',
      'http',
      'https',
      'cluster',
      'worker_threads',
    ];

    it('stubs out Node-specific built-ins in browser package field', () => {
      const browserField = pkg.browser;
      expect(browserField).toBeDefined();
      expect(browserField['fs']).toBe(false);
      expect(browserField['path']).toBe(false);
      expect(browserField['os']).toBe(false);
      expect(browserField['crypto']).toBe(false);
      expect(browserField['child_process']).toBe(false);
      expect(browserField['worker_threads']).toBe(false);
    });

    it('stubs out CLI and filesystem-dependent modules in browser package field', () => {
      const browserField = pkg.browser;
      expect(browserField['./dist/config.js']).toBe(false);
      expect(browserField['./dist/cli.js']).toBe(false);
      expect(browserField['./dist/commands/onboard.js']).toBe(false);
      expect(browserField['./dist/commands/purchase.js']).toBe(false);
      expect(browserField['./dist/commands/wallet.js']).toBe(false);
      expect(browserField['./dist/commands/status.js']).toBe(false);
      expect(browserField['./dist/version-check.js']).toBe(false);
    });

    it('does not import Node built-ins from src/browser.ts', async () => {
      const browserEntryPath = path.resolve(__dirname, '../browser.ts');
      const browserSource = fs.readFileSync(browserEntryPath, 'utf8');

      for (const builtin of FORBIDDEN_BUILTINS) {
        // Direct import checks: import ... from 'fs' or from 'node:fs'
        const regexDirect = new RegExp(`from\\s+['"](node:)?${builtin}['"]`);
        expect(regexDirect.test(browserSource)).toBe(false);

        // Require checks
        const regexRequire = new RegExp(`require\\s*\\(\\s*['"](node:)?${builtin}['"]\\s*\\)`);
        expect(regexRequire.test(browserSource)).toBe(false);
      }
    });

    it('imports StellarCardClient from browser entry cleanly', async () => {
      const browserModule = await import('../browser');
      expect(browserModule.Stellar_CardClient).toBeDefined();
      expect(typeof browserModule.Stellar_CardClient).toBe('function');
      expect(browserModule.Stellar_CardError).toBeDefined();
    });
  });

  describe('TypeScript Subpath Source and Declaration Files', () => {
    const srcDir = path.resolve(__dirname, '..');

    it('has matching source files for all exported subpaths', () => {
      const requiredSources = ['index.ts', 'browser.ts', 'mcp.ts', 'ows.ts'];

      for (const srcFile of requiredSources) {
        const fullPath = path.join(srcDir, srcFile);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });
  });
});
