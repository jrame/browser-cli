import fs from 'fs';
import path from 'path';
import { test, expect } from './helpers';

const snapshots = (cwd: string) => fs.readdirSync(path.join(cwd, '.logs', 'browser-cli')).filter(file => file.endsWith('.atml'));

for (const mode of ['compact', 'raw', 'json']) {
  for (const inline of [false, true]) {
    test(`run-code reads a source file once and returns a ${inline ? 'inline' : 'file'} snapshot in ${mode} mode`, async ({ cli }) => {
      await cli.open('<title>Local run-code</title><button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button>');
      const source = 'async page => { await page.locator("#counter").click(); return await page.locator("#counter").textContent(); }';
      const filename = path.join(cli.cwd, 'source script.js');
      fs.writeFileSync(filename, source);
      const before = snapshots(cli.cwd).length;
      const logs = fs.readdirSync(path.join(cli.cwd, '.logs', 'browser-cli')).filter(file => file.endsWith('.js')).length;
      const flags = [...(inline ? ['--inline'] : []), ...(mode === 'compact' ? [] : [`--${mode}`])];
      const output = await cli.run('run-code', 'default', '--filename', filename, ...flags);
      expect(fs.readFileSync(filename, 'utf8')).toBe(source);
      expect(snapshots(cli.cwd)).toHaveLength(before + (inline ? 0 : 1));
      expect(fs.readdirSync(path.join(cli.cwd, '.logs', 'browser-cli')).filter(file => file.endsWith('.js'))).toHaveLength(logs + 1);
      if (mode === 'json') {
        const response = JSON.parse(output);
        expect(response.result).toBe('"1"');
        if (inline)
          expect(response.snapshot).toContain(':counter button\n  : 1');
        else
          expect(fs.readFileSync(path.resolve(cli.cwd, response.snapshot.file), 'utf8')).toContain(':counter button\n  : 1');
      } else if (inline) {
        expect(output).toContain(':counter button\n  : 1');
      } else {
        const snapshot = output.match(/(?:^|\n)([^\n]*\.atml)(?:\n|$)/)?.[1]
          ?? output.match(/\[Snapshot\]\(([^)]+)\)/)?.[1];
        expect(snapshot).toBeTruthy();
        expect(fs.readFileSync(path.resolve(cli.cwd, snapshot!), 'utf8')).toContain(':counter button\n  : 1');
      }
      expect(await cli.run('eval', 'default', 'document.querySelector("#counter").textContent', '--raw')).toBe('"1"');
    });
  }
}

test('file-backed chained commands run once each and capture only the final page', async ({ cli }) => {
  await cli.open('<button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button>');
  const source = 'async page => { await page.locator("#counter").click(); }';
  for (const filename of ['first.js', 'second.js'])
    fs.writeFileSync(path.join(cli.cwd, filename), source);
  const before = snapshots(cli.cwd).length;
  const output = await cli.run('run-code', 'default', '--filename=first.js', '--inline', '--then', 'run-code', '--filename', 'second.js', '--json');
  const result = JSON.parse(output.slice(output.indexOf('{')));
  expect(fs.readFileSync(path.resolve(cli.cwd, result.snapshot.file), 'utf8')).toContain(':counter button\n  : 2');
  expect(snapshots(cli.cwd)).toHaveLength(before + 1);
  expect(await cli.run('run-code', 'default', '--filename=first.js', '--then', 'run-code', '--filename=second.js', '--inline', '--raw')).toContain(':counter button\n  : 4');
  expect(snapshots(cli.cwd)).toHaveLength(before + 1);
  for (const filename of ['first.js', 'second.js'])
    expect(fs.readFileSync(path.join(cli.cwd, filename), 'utf8')).toBe(source);
  const failed = await cli.result('snapshot', 'default', '--filename=conflict.atml', '--inline', '--then', 'run-code', '--filename=first.js');
  expect(failed.exitCode).toBe(1);
  expect(failed.error).toContain('--inline cannot be combined with --filename');
  expect(fs.existsSync(path.join(cli.cwd, 'conflict.atml'))).toBe(false);
  expect(await cli.run('eval', 'default', 'document.querySelector("#counter").textContent', '--raw')).toBe('"4"');
});
