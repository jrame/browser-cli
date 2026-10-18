const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
  if (Number(process.versions.node.split('.')[0]) < 20)
    throw new Error('Node.js 20 or newer is required.');
  const root = path.resolve(__dirname, '..');
  const marker = path.join(root, 'browser-release.json');
  if (!fs.existsSync(marker)) throw new Error('Download and extract a compiled release archive first.');
  const release = JSON.parse(fs.readFileSync(marker));
  const windows = process.platform === 'win32';
  if (release.platform !== (windows ? 'windows' : process.platform))
    throw new Error('Use the Windows archive on Windows, or the Linux archive with Linux Node.js inside WSL.');
  let installDir = windows ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'browser-cli') : path.join(os.homedir(), '.local', 'share', 'browser-cli');
  let binDir = path.join(os.homedir(), '.local', 'bin');
  let skipBrowsers = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--skip-browsers') skipBrowsers = true;
    else if (['--install-dir', '--bin-dir'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const option = args[i++];
      if (option === '--install-dir') installDir = args[i];
      else binDir = args[i];
    } else throw new Error('Options: --install-dir PATH, --bin-dir PATH, --skip-browsers');
  }
  installDir = path.resolve(installDir);
  binDir = path.resolve(binDir);
  // Resolve existing parent symlinks as well, so copying cannot recurse into itself.
  function realTarget(target) {
    if (fs.existsSync(target)) return fs.realpathSync(target);
    return path.join(realTarget(path.dirname(target)), path.basename(target));
  }
  function contains(parent, child) {
    const relative = path.relative(parent, child);
    return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  }
  const source = fs.realpathSync(root);
  const target = realTarget(installDir);
  if (contains(source, target) || contains(target, source))
    throw new Error('The installation directory must be separate from the extracted archive.');
  if (contains(source, realTarget(binDir)))
    throw new Error('The launcher directory must be outside the extracted archive.');
  if (fs.existsSync(installDir) && fs.readdirSync(installDir).length) {
    const installedMarker = path.join(installDir, 'browser-release.json');
    if (!fs.existsSync(installedMarker) || JSON.parse(fs.readFileSync(installedMarker)).platform !== release.platform)
      throw new Error('The installation directory is not a browser release. Choose another --install-dir.');
  }
  function run(args) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Command failed (${result.status}).`);
  }
  // Validate the payload before copying or replacing an existing command.
  run([path.join(root, 'browser.js'), '--version']);
  fs.cpSync(root, installDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  const entry = path.join(installDir, 'browser.js');
  const launcher = path.join(binDir, windows ? 'browser.cmd' : 'browser');
  if (windows) {
    fs.writeFileSync(launcher, `@echo off\r\nsetlocal DisableDelayedExpansion\r\nnode "${entry.replace(/%/g, '%%')}" %*\r\nexit /b %errorlevel%\r\n`);
  } else {
    const quoted = "'" + entry.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(launcher, `#!/bin/sh\nexec node ${quoted} "$@"\n`, { mode: 0o755 });
    fs.chmodSync(launcher, 0o755);
  }
  console.log(`Installed browser ${release.version}: ${launcher}`);
  console.log(`Add ${binDir} to PATH if it is not already present. See README.md for commands.`);
  if (!skipBrowsers) run([path.join(installDir, '.artifacts', 'playwright-core', 'cli.js'), 'install', 'chromium', 'firefox']);
  else console.log('Browser downloads skipped. Run browser install-browser chromium (and/or firefox) when needed.');
  if (!windows) console.log('If Linux browser libraries are missing, run browser install-browser --with-deps chromium (and/or firefox).');
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
