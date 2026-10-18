// Exercise the actual extracted release and installer, without checkout dependencies.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';
if (!windows && process.platform !== 'linux') throw new Error('Verify on Windows or Linux/WSL.');
const name = windows ? 'browser-windows' : 'browser-linux';
const archive = path.join(root, 'dist', name + (windows ? '.zip' : '.tar.gz'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'browser release '));
const extracted = path.join(work, 'extracted');
const app = path.join(work, "user's app");
const bin = path.join(work, 'user bin');
const cwd = path.join(work, 'workspace');
const env = { ...process.env, NODE_PATH: '', NO_UPDATE_NOTIFIER: '1', PWTEST_DAEMON_SESSION_DIR: path.join(work, 'sessions') };
let installed = false;
let passed = false;
let commandId = 0;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    // Detached browser processes on Windows can retain inherited pipe handles.
    // Files let us wait for the command's exit independently of daemon lifetime.
    const log = path.join(work, `command-${++commandId}.log`);
    const fd = fs.openSync(log, 'w');
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd], windowsHide: true, ...options });
    const timer = setTimeout(() => {
      if (windows) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGKILL');
      reject(new Error(`${command} timed out:\n${fs.readFileSync(log, 'utf8')}`));
    }, 90000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      fs.closeSync(fd);
      const output = fs.readFileSync(log, 'utf8');
      if (code !== 0) reject(new Error(`${command} failed (${code}):\n${output}`));
      else resolve(output);
    });
  });
}

function cli(args) {
  if (windows) {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$cliArgs = @(ConvertFrom-Json $env:BROWSER_VERIFY_ARGS); & $env:BROWSER_VERIFY_LAUNCHER @cliArgs; exit $LASTEXITCODE'],
    { env: { ...env, BROWSER_VERIFY_ARGS: JSON.stringify(args), BROWSER_VERIFY_LAUNCHER: path.join(bin, 'browser.cmd') } });
  }
  return run(path.join(bin, 'browser'), args);
}

async function main() {
try {
  fs.mkdirSync(extracted);
  fs.mkdirSync(cwd);
  const expected = fs.readFileSync(archive + '.sha256', 'utf8').split(/\s/)[0];
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), expected, 'Archive checksum');
  if (windows) {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:BROWSER_VERIFY_ARCHIVE, $env:BROWSER_VERIFY_EXTRACTED)'],
    { env: { ...env, BROWSER_VERIFY_ARCHIVE: archive, BROWSER_VERIFY_EXTRACTED: extracted } });
  } else {
    await run('tar', ['-xzf', archive, '-C', extracted]);
  }
  const payload = path.join(extracted, name);
  console.log('Extracted archive and verified checksum.');
  for (const forbidden of ['.git', '.upstream', 'src', 'patches', 'node.exe', 'node', 'node_modules/playwright', 'node_modules/@playwright', '.artifacts/playwright-core/.local-browsers'])
    assert.equal(fs.existsSync(path.join(payload, forbidden)), false, `Unexpected release payload: ${forbidden}`);
  const installer = windows ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(payload, 'install.ps1'), '-InstallDir', app, '-BinDir', bin, '-SkipBrowsers']] :
    ['sh', [path.join(payload, 'install.sh'), '--install-dir', app, '--bin-dir', bin, '--skip-browsers']];
  await run(...installer);
  installed = true;
  // A second install must work, and the archive can be removed after installation.
  await run(...installer);
  console.log('Installer and repeated installation passed.');
  const resolvedExtracted = fs.realpathSync(extracted);
  assert.equal(path.dirname(resolvedExtracted), fs.realpathSync(work));
  fs.rmSync(resolvedExtracted, { recursive: true });
  assert.equal((await cli(['--version'])).trim(), require('../package.json').version);
  assert.match(await cli(['--help']), /ATML snapshots/);
  assert.match(await cli(['install-browser', 'chromium', '--dry-run']), /chromium/i);
  console.log('Installed launcher and browser download command passed.');
  for (const browserName of ['chromium', 'firefox']) {
    console.log(`Checking installed CLI with ${browserName}...`);
    const configDir = path.join(cwd, '.config', 'browser-cli');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'cli.config.json'), JSON.stringify({
      browser: { browserName, launchOptions: {
        headless: true,
        ...(process.platform === 'linux' && process.getuid() === 0 ? { chromiumSandbox: false } : {}),
      } },
    }));
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[atml]\nremove_selectors = [".omit"]\n');
    try {
      const html = '<title>Release smoke</title><input id="name"><button id="submit">Save</button><p class="omit">OMIT ME</p>';
      const value = "l'archive & spaces";
      const snapshot = await cli(['open', 'data:text/html,' + encodeURIComponent(html), '--then', 'fill', ':name', value, '--then', 'snapshot', '--inline']);
      assert.match(snapshot, /Release smoke/);
      assert.ok(snapshot.includes(value), `Launcher argument preservation: ${snapshot}`);
      assert.match(snapshot, /:submit button/);
      assert.ok(!snapshot.includes('OMIT ME'), 'Bundled TOML dependency must apply filters');
    } finally {
      await cli(['close']);
    }
  }
  passed = true;
  console.log('Release checksum, extraction, repeated install, launchers, Chromium/Firefox and ATML filtering passed.');
} finally {
  if (installed && !passed) {
    try { await cli(['close-all']); } catch {}
  }
  if (passed) {
    const resolved = fs.realpathSync(work);
    const relative = path.relative(fs.realpathSync(os.tmpdir()), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe cleanup target');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } else {
    console.error(`Preserved release verification directory: ${work}`);
  }
}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
