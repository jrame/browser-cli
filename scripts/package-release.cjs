// Package the compiled engine, never the checkout, Node.js or downloaded browsers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { coreDirectory } = require('./runtime.cjs');
const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

function main() {
  const platform = process.argv[2] || ({ win32: 'windows', linux: 'linux' })[process.platform];
  if (!['windows', 'linux'].includes(platform) || process.argv.length > 3)
    throw new Error('Usage: node scripts/package-release.cjs [windows|linux]');
  if (platform === 'windows' && process.platform !== 'win32')
    throw new Error('Build the Windows ZIP on Windows.');
  const core = coreDirectory();
  const pin = require('../upstream.json').playwright;
  const marker = JSON.parse(fs.readFileSync(path.join(core, 'browser-atml-build.json')));
  if (marker.commit !== pin.commit || marker.version !== pin.version)
    throw new Error('Compiled engine does not match upstream.json. Run npm run build.');
  const pkg = require('../package.json');
  const cache = path.join(root, '.build');
  const dist = path.join(root, 'dist');
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(dist, { recursive: true });
  const work = fs.mkdtempSync(path.join(cache, 'release-'));
  const name = `browser-${platform}`;
  const stage = path.join(work, name);
  const files = [
    'browser.js', 'skillCheck.js', 'LICENSE', 'NOTICE', 'README.md',
    'scripts/runtime.cjs', 'scripts/command-chain.cjs', 'scripts/install-release.cjs',
    platform === 'windows' ? 'install.ps1' : 'install.sh',
  ];
  function copy(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, filter: source => !['.local-browsers', 'node_modules'].includes(path.basename(source)) });
  }
  try {
    for (const file of files) copy(path.join(root, file), path.join(stage, file));
    copy(core, path.join(stage, '.artifacts', 'playwright-core'));
    const toml = path.dirname(path.dirname(require.resolve('smol-toml')));
    copy(toml, path.join(stage, 'node_modules', 'smol-toml'));
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
      name: pkg.name, version: pkg.version, private: true, license: pkg.license, engines: pkg.engines,
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(stage, 'browser-release.json'), JSON.stringify({
      version: pkg.version, platform,
    }, null, 2) + '\n');
    const archive = path.join(dist, name + (platform === 'windows' ? '.zip' : '.tar.gz'));
    if (fs.existsSync(archive)) fs.unlinkSync(archive);
    if (platform === 'windows') {
      // Compress-Archive can omit hidden entries. ZipFile preserves .artifacts.
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:BROWSER_RELEASE_STAGE, $env:BROWSER_RELEASE_ARCHIVE)'],
      { env: { ...process.env, BROWSER_RELEASE_STAGE: work, BROWSER_RELEASE_ARCHIVE: archive } });
    } else {
      run('tar', ['-czf', archive, '-C', work, name]);
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(archive + '.sha256', `${hash}  ${path.basename(archive)}\n`);
    console.log(`Created ${archive} and SHA-256 checksum`);
  } finally {
    const resolved = fs.realpathSync(work);
    const relative = path.relative(fs.realpathSync(cache), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe cleanup target');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
