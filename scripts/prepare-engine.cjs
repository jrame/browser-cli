// Rebuild from pinned source. Only generated caches under this checkout are modified.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const pin = require('../upstream.json').playwright;
const source = path.join(root, '.upstream', 'playwright');
const artifact = path.join(root, '.artifacts', 'playwright-core');
const logDir = path.join(root, '.logs', 'browser-cli', 'build');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd = root, options = {}) {
  if (process.platform === 'win32' && command === npm) {
    args = [process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args];
    command = process.execPath;
  }
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return result.stdout;
}
function git(args, options) { return run('git', args, source, options); }
function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

async function main() {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(path.join(source, '.git'))) {
    if (fs.existsSync(source) && fs.readdirSync(source).length)
      throw new Error(`Refusing to overwrite a nonempty source cache: ${source}`);
    run('git', ['init', source]);
    git(['remote', 'add', 'origin', pin.repository]);
    git(['fetch', '--depth=1', 'origin', pin.commit]);
    git(['checkout', '--detach', pin.commit]);
  }
  const head = git(['rev-parse', 'HEAD'], { stdio: 'pipe' }).trim();
  if (head !== pin.commit) throw new Error(`Unexpected Playwright source commit: ${head}`);
  for (const file of fs.readdirSync(path.join(root, 'patches', 'playwright')).filter(file => file.endsWith('.patch')).sort()) {
    const patch = path.join(root, 'patches', 'playwright', file);
    const applied = spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd: source, stdio: 'ignore' }).status === 0;
    if (!applied) {
      git(['apply', '--check', patch]);
      git(['apply', patch]);
    }
  }
  const backend = path.join(source, 'packages', 'playwright-core', 'src', 'tools', 'backend', 'atml');
  for (const file of fs.readdirSync(path.join(root, 'src', 'atml')).filter(file => file.endsWith('.ts'))) copy(path.join(root, 'src', 'atml', file), path.join(backend, file));
  copy(path.join(root, 'src', 'atml', 'dom.ts'), path.join(source, 'packages', 'injected', 'src', 'browserAtml.ts'));
  copy(path.join(root, 'skills', 'browser'), path.join(source, 'packages', 'playwright-core', 'src', 'tools', 'skills', 'browser'));
  const packageLock = fs.readFileSync(path.join(source, 'package-lock.json'));
  const lockHash = crypto.createHash('sha256').update(packageLock).digest('hex');
  const depsMarker = path.join(source, 'node_modules', '.browser-lock');
  if (!fs.existsSync(depsMarker) || fs.readFileSync(depsMarker, 'utf8') !== lockHash) {
    console.log('Installing pinned engine build dependencies…');
    run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source);
    fs.writeFileSync(depsMarker, lockHash);
  }
  console.log(`Building Playwright ${pin.commit.slice(0, 12)} with ATML…`);
  const log = path.join(logDir, 'engine-build.log');
  const fd = fs.openSync(log, 'w');
  try {
    run(npm, ['run', 'build', '--', '--disable-install'], source, { stdio: ['ignore', fd, fd] });
  } catch (error) {
    fs.closeSync(fd);
    console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-70).join('\n'));
    throw error;
  }
  fs.closeSync(fd);
  // Start with the exact published package's manifests, entry points and assets,
  // then install the compiled lib as a separate artifact, never into node_modules.
  const original = path.dirname(require.resolve('playwright-core/package.json'));
  if (require(path.join(original, 'package.json')).version !== pin.version)
    throw new Error('Installed playwright-core does not match upstream.json; run npm ci.');
  copy(original, artifact);
  copy(path.join(source, 'packages', 'playwright-core', 'lib'), path.join(artifact, 'lib'));
  fs.writeFileSync(path.join(artifact, 'browser-atml-build.json'), JSON.stringify({ commit: pin.commit, version: pin.version }, null, 2));
  console.log('Browser engine ready. Run node browser.js --help, or npm link to install browser.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
