// Bundle analyzer utility. Run via `npm run analyze`.
// Produces a console report showing chunk sizes after `next build`.

import { readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(__dirname, '..', '.next');

async function getChunkSizes(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getChunkSizes(fullPath)));
    } else if (entry.name.endsWith('.js')) {
      const s = await stat(fullPath);
      files.push({
        name: fullPath.replace(BUILD_DIR + '/', ''),
        size: s.size,
        sizeKB: (s.size / 1024).toFixed(1),
      });
    }
  }
  return files;
}

async function main() {
  try {
    const files = await getChunkSizes(join(BUILD_DIR, 'static'));
    files.sort((a, b) => b.size - a.size);

    console.log('\n📦 Bundle Analysis\n');
    console.log('Chunks by size (largest first):');
    console.log('─'.repeat(70));

    let totalSize = 0;
    for (const f of files.slice(0, 20)) {
      totalSize += f.size;
      const bar = '█'.repeat(Math.min(Math.round(f.size / 10240), 40));
      console.log(`  ${f.sizeKB.padStart(8)} KB  ${bar}  ${f.name}`);
    }

    console.log('─'.repeat(70));
    console.log(`  Top 20 chunks: ${(totalSize / 1024).toFixed(1)} KB`);
    console.log(`  Total JS chunks: ${files.length}`);

    const allTotal = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`  Total JS size: ${(allTotal / 1024).toFixed(1)} KB`);

    if (allTotal > 300 * 1024) {
      console.log('\n⚠️  Total JS exceeds 300 KB. Consider code splitting or tree-shaking.');
    }
  } catch {
    console.error('Run `next build` first to generate the .next directory.');
    process.exit(1);
  }
}

main();
