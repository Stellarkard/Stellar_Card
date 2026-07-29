import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const gitDir = resolve('..', '.git');
if (existsSync(gitDir)) {
  execSync('npx husky', { cwd: '..', stdio: 'inherit' });
}
