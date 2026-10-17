const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, '.upstream', 'playwright');
const paths = [
  'packages/playwright-core/src/server/browserContext.ts',
  'packages/playwright-core/src/server/network.ts',
  'packages/playwright-core/src/server/chromium/crNetworkManager.ts',
  'packages/injected/src/ariaSnapshot.ts',
  'packages/injected/src/injectedScript.ts',
  'packages/playwright-core/src/tools',
  ':(exclude)packages/playwright-core/src/tools/skills',
  'utils/build/build.js',
];
const result = spawnSync('git', ['diff', '--binary', 'HEAD', '--', ...paths], { cwd: source, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || `git diff exited ${result.status}`);
const target = path.join(root, 'patches', 'playwright', '0001-browser-atml.patch');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, result.stdout);
console.log('Updated ' + path.relative(root, target));
