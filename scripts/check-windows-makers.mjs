// Guards the Windows packaging path against dependency-layout regressions.
//
// forge.config.ts imports every maker statically, so the config only loads when
// each maker's transitive requires resolve. pnpm's `hoisted` layout is
// platform-dependent: on win32 it prunes `glob@7` (needed by
// electron-winstaller -> @electron/asar@3), which makes `electron-forge make`
// fail with "Cannot find module 'glob'" while the same tree works on linux.
//
// This installs the repo the way a Windows host would (`--os=win32
// --cpu=x64`) on any OS, then requires every maker.
//
// Usage: node scripts/check-windows-makers.mjs [repoRoot]
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const excluded = new Set(['node_modules', '.git', '.vite', 'out']);
const work = mkdtempSync(join(tmpdir(), 'finance-viewer-win32-'));

let failed = false;

try {
  cpSync(repoRoot, work, {
    recursive: true,
    filter: source =>
      !relative(repoRoot, source)
        .split(sep)
        .some(part => excluded.has(part)),
  });

  const install = spawnSync(
    'pnpm',
    ['install', '--frozen-lockfile', '--os=win32', '--cpu=x64', '--ignore-scripts'],
    { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' },
  );

  if (install.status !== 0) {
    console.error('win32 install failed');
    failed = true;
  } else {
    const pkg = JSON.parse(readFileSync(join(work, 'package.json'), 'utf8'));
    const makers = Object.keys({ ...pkg.devDependencies, ...pkg.dependencies }).filter(name =>
      name.startsWith('@electron-forge/maker-'),
    );
    const requireFromWork = createRequire(join(work, 'package.json'));

    for (const maker of makers) {
      try {
        requireFromWork(maker);
        console.log(`ok   ${maker}`);
      } catch (error) {
        failed = true;
        console.error(`FAIL ${maker}: ${error.message.split('\n')[0]}`);
      }
    }
  }
} finally {
  if (failed) {
    console.error(`Work directory kept for inspection: ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
