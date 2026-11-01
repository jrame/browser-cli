// Local, account-free probe. Usage: node scripts/repro-multiline-insertion.cjs firefox contenteditable CRLF
const fs = require('fs');
const path = require('path');
const playwright = require('playwright-core');

async function main() {
  const [name = 'firefox', target = 'textarea', eol = 'CRLF'] = process.argv.slice(2);
  if (!['firefox', 'chromium'].includes(name) || !['textarea', 'contenteditable'].includes(target) || !['LF', 'CRLF'].includes(eol))
    throw new Error('Expected: [firefox|chromium] [textarea|contenteditable] [LF|CRLF]');
  const source = fs.readFileSync(path.join(__dirname, '../tests/fixtures/multiline-source.txt'), 'utf8')
      .replace(/\r\n/g, '\n').replace(/\n/g, eol === 'CRLF' ? '\r\n' : '\n');
  const browser = await playwright[name].launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fs.readFileSync(path.join(__dirname, '../tests/fixtures/multiline-insertion.html'), 'utf8'));
    const result = await require('../tests/fixtures/multiline-scenario.cjs')(page, { target, source });
    console.log(JSON.stringify({ playwright: require('playwright-core/package.json').version, browser: browser.version(), target, eol, source, ...result }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
