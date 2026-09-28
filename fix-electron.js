/**
 * postinstall hook:
 * 1. Ensure electron binary is extracted (pnpm v11+ skips electron's postinstall).
 * 2. Patch extract-zip for Node.js v22+ compatibility (yauzl stream pipeline hangs).
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Patch extract-zip for Node.js v22+ ──────────────────────────────────────
(function patchExtractZip() {
  const extractZipPath = path.join(__dirname, 'node_modules', 'extract-zip', 'index.js');
  if (!fs.existsSync(extractZipPath)) {
    console.log('[fix-electron] extract-zip not found, skipping patch.');
    return;
  }
  let src = fs.readFileSync(extractZipPath, 'utf8');
  if (src.includes('USE_POWERSHELL')) {
    console.log('[fix-electron] extract-zip already patched.');
    return;
  }
  console.log('[fix-electron] Patching extract-zip for Node.js v22+ compatibility...');
  // Insert the PowerShell fallback shim right after the requires / openZip / pipeline lines
  const shim = `
const { execSync: _execSync } = require('child_process')
const _NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10)
const USE_POWERSHELL = process.platform === 'win32' && _NODE_MAJOR >= 22

module.exports = async function (zipPath, opts) {
  if (!path.isAbsolute(opts.dir)) throw new Error('Target directory is expected to be absolute')
  await fs.mkdir(opts.dir, { recursive: true })
  opts.dir = await fs.realpath(opts.dir)
  if (USE_POWERSHELL) {
    _execSync(
      \`powershell -Command "Expand-Archive -Path '\${zipPath}' -DestinationPath '\${opts.dir}' -Force"\`,
      { stdio: 'pipe' }
    )
    return
  }
  return new Extractor(zipPath, opts).extract()
}
`;
  // Replace the original module.exports block at the bottom of the file
  src = src.replace(
    /module\.exports\s*=\s*async\s+function\s*\([^)]*\)\s*\{[\s\S]*?return\s+new\s+Extractor\([^)]*\)\.extract\(\)\s*\}/,
    shim.trimEnd()
  );
  fs.writeFileSync(extractZipPath, src, 'utf8');
  console.log('[fix-electron] extract-zip patched successfully.');
})();

const electronDir = path.join(__dirname, 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');

// Already set up — nothing to do
if (fs.existsSync(pathTxt)) {
  console.log('[fix-electron] path.txt already exists, skipping.');
  process.exit(0);
}

// Find the cached electron zip
const cacheDir = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), '.cache'), 'electron', 'Cache');
if (!fs.existsSync(cacheDir)) {
  console.log('[fix-electron] No electron cache found, skipping.');
  process.exit(0);
}

const electronPkg = require(path.join(electronDir, 'package.json'));
const version = electronPkg.version;
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch;
const zipName = `electron-v${version}-${platform}-${arch}.zip`;

// Recursively find the zip file in cache
function findZip(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findZip(full);
      if (found) return found;
    } else if (entry.name === zipName) {
      return full;
    }
  }
  return null;
}

const zipFile = findZip(cacheDir);
if (!zipFile) {
  console.log(`[fix-electron] ${zipName} not found in cache, skipping.`);
  process.exit(0);
}

const distDir = path.join(electronDir, 'dist');
console.log(`[fix-electron] Extracting ${zipName}...`);

if (process.platform === 'win32') {
  // Use PowerShell Expand-Archive on Windows
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir, { recursive: true });
  execSync(`powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${distDir}' -Force"`, { stdio: 'inherit' });
} else {
  // Use unzip on Unix
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  execSync(`unzip -o "${zipFile}" -d "${distDir}"`, { stdio: 'inherit' });
}

// Determine the executable name
const exeName = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron' : 'electron';
fs.writeFileSync(pathTxt, exeName);
console.log(`[fix-electron] Done! path.txt -> ${exeName}`);
