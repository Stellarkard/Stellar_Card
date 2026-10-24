import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as os from 'os';

export async function cacheCommand(args: string[]): Promise<number> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
  const cacheDir = path.join(homeDir, '.stellar_card');
  const cacheFile = path.join(cacheDir, 'cache.json');
  const configFile = path.join(cacheDir, 'config.json');

  const filesToDelete = [];
  if (fs.existsSync(cacheFile)) filesToDelete.push(cacheFile);
  if (fs.existsSync(configFile)) filesToDelete.push(configFile);

  if (filesToDelete.length === 0) {
    process.stdout.write('No cached files found to delete.\n');
    return 0;
  }

  process.stdout.write(
    `The following files will be deleted:\n${filesToDelete.map((f) => `  - ${f}`).join('\n')}\n`,
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Continue? (yes/no) ', (answer) => {
      rl.close();

      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        process.stdout.write('Cache clear cancelled.\n');
        resolve(0);
        return;
      }

      let errorCount = 0;
      for (const file of filesToDelete) {
        try {
          const size = fs.statSync(file).size;
          const randomData = Buffer.alloc(size);
          for (let i = 0; i < size; i++) {
            randomData[i] = Math.floor(Math.random() * 256);
          }
          fs.writeFileSync(file, randomData);
          fs.unlinkSync(file);
        } catch (err) {
          process.stderr.write(
            `Error deleting ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          errorCount++;
        }
      }

      if (errorCount === 0) {
        process.stdout.write('✓ Cache cleared successfully.\n');
        resolve(0);
      } else {
        process.stderr.write(`Error: ${errorCount} file(s) could not be deleted.\n`);
        resolve(1);
      }
    });
  });
}
