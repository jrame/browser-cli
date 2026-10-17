const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.build');
fs.mkdirSync(cache, { recursive: true });
const work = fs.mkdtempSync(path.join(cache, 'clean-'));
const logDir = path.join(root, '.logs', 'browser-cli', 'build');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'clean-build.log');
const log = fs.openSync(logFile, 'w');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd = work) {
  if (process.platform === 'win32' && command === npm) {
    args = [process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args];
    command = process.execPath;
  }
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', log, log] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}
try {
  const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (listing.error) throw listing.error;
  if (listing.status !== 0) throw new Error(listing.stderr);
  for (const file of new Set(listing.stdout.split('\0').filter(Boolean))) {
    const source = path.join(root, file);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const target = path.join(work, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  console.log('Checking a clean exported checkout: ' + work);
  run(npm, ['ci', '--ignore-scripts']);
  run(npm, ['run', 'build']);
  run(process.execPath, ['browser.js', '--help']);
  run(npm, ['test', '--', '--project=unit']);
  run(npm, ['test', '--', '--project=chromium', '--grep=writes ATML']);
  run(npm, ['test', '--', 'tests/events.spec.ts', '--grep=startup listeners']);
  fs.closeSync(log);
  // Only delete the temporary directory allocated by this script, inside .build.
  const resolved = fs.realpathSync(work);
  const relative = path.relative(fs.realpathSync(cache), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe cleanup target: ' + resolved);
  fs.rmSync(resolved, { recursive: true, maxRetries: 3, retryDelay: 200 });
  console.log('Clean install, engine build, unit tests and Chromium/Firefox smoke tests passed. Log: ' + logFile);
} catch (error) {
  try { fs.closeSync(log); } catch {}
  console.error(fs.readFileSync(logFile, 'utf8').split('\n').slice(-80).join('\n'));
  console.error(error.message + '\nPreserved build directory: ' + work);
  process.exitCode = 1;
}
