const fs = require('fs');
const path = require('path');

function coreDirectory() {
  const directory = path.resolve(__dirname, '..', '.artifacts', 'playwright-core');
  if (!fs.existsSync(path.join(directory, 'browser-atml-build.json')))
    throw new Error('The browser engine has not been built. Run npm ci && npm run build first.');
  return directory;
}

module.exports = { coreDirectory };
