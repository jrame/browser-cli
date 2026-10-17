import fs from 'fs';
import path from 'path';
import { test, expect } from './helpers';

type LegacyCase = { name: string; origin: string; html: string; config: Record<string, unknown>; browser: boolean; browserExpected: string };
const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-atml.json'), 'utf8')) as { cases: LegacyCase[] };

// Restore the historical ID syntax and remove CLI-only refs before comparing
// content. Text markers are still present here, so text cannot become a target.
function withoutCliReferences(snapshot: string): string {
  return snapshot.replace(/^( *):(\S+)(?: |$)(.*)$/gm, (_, indent, ref, rest) => {
    if (/^\d+$/.test(ref)) return indent + rest;
    const tag = rest.match(/^([a-z]\w*)(?= |$)/)?.[0];
    return indent + (tag ? `${tag} #${ref}${rest.slice(tag.length)}` : `#${ref}${rest ? ' ' + rest : ''}`);
  }).replace(/^(?! *: )(.*)\bid=("[^"]*"|\S+)/gm, '$1#$2');
}

for (const fixture of oracle.cases.filter(entry => entry.browser)) {
  test(`Python ATML content parity: ${fixture.name}`, async ({ cli }) => {
    if (Object.keys(fixture.config).length) {
      const toml = '[atml]\n' + Object.entries(fixture.config).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n');
      fs.writeFileSync(path.join(cli.cwd, '.config', 'browser-cli', 'config.toml'), toml);
    }
    await cli.open(fixture.html);
    // JSON preserves indentation and trailing text spaces, unlike the test
    // transport's trimmed stdout in --raw mode.
    const snapshot = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
    expect(typeof snapshot).toBe('string');
    expect(snapshot.split('\n').every((line: string) => line.trim().length > 0)).toBe(true);
    const content = (value: string) => value.split('\n').filter(line => line.trim()).map(line => line.replace(/^ +/, '')).join('\n');
    expect(content(withoutCliReferences(snapshot).replace(/^( *): /gm, '$1')), fixture.origin).toBe(content(fixture.browserExpected));
  });
}
