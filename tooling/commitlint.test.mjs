import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runCommitlint = (message) => {
  try {
    execFileSync(process.execPath, ['./node_modules/@commitlint/cli/cli.js'], {
      input: message,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
};

test('accepts a conventional commit', () => {
  assert.equal(runCommitlint('feat: add virtual card controls\n'), true);
});

test('rejects malformed and unsupported commit types', () => {
  assert.equal(runCommitlint('added virtual card controls\n'), false);
  assert.equal(runCommitlint('feature: add virtual card controls\n'), false);
});

test('commit-msg hook invokes commitlint with the message file', () => {
  const hook = readFileSync('.husky/commit-msg', 'utf8');
  assert.match(hook, /commitlint --edit "\$1"/);
});
