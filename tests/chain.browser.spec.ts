import fs from 'fs';
import path from 'path';
import { test, expect } from './helpers';

const snapshots = (cwd: string) => fs.readdirSync(path.join(cwd, '.logs', 'browser-cli')).filter(file => file.endsWith('.atml'));

test('chains open, focus, type and Enter in the same named session', async ({ cli }) => {
  const html = '<input id="task" onkeydown="if(event.key===\'Enter\') document.querySelector(\'output\').textContent=this.value"><output></output>';
  const text = 'Buy groceries; milk & bread "today"';
  const output = await cli.run('-s=chain', 'open', 'data:text/html,' + encodeURIComponent(html),
      '--then', 'click', ':task', '--then', 'type', text, '--then', 'press', 'Enter');
  expect(output.split('\n').filter(line => line.endsWith('.atml'))).toHaveLength(1);
  expect(snapshots(cli.cwd)).toHaveLength(1);
  expect(fs.readFileSync(path.join(cli.cwd, '.logs', 'browser-cli', snapshots(cli.cwd)[0]), 'utf8')).toContain(text);
  expect(await cli.run('-s=chain', 'eval', '() => document.querySelector("output").textContent')).toContain(JSON.stringify(text));
});

test('two Enter actions produce one final snapshot and ordinary commands keep capturing', async ({ cli }) => {
  await cli.open('<button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button>');
  await cli.run('click', ':counter');
  const before = snapshots(cli.cwd).length;
  const output = await cli.run('press', 'Enter', '--then', 'press', 'Enter');
  expect(output.split('\n').filter(line => line.endsWith('.atml'))).toHaveLength(1);
  expect(snapshots(cli.cwd)).toHaveLength(before + 1);
  expect(fs.readFileSync(path.resolve(cli.cwd, output.split('\n').at(-1)!), 'utf8')).toContain('  : 3');
  expect(await cli.run('press', 'Enter')).toMatch(/^ok\n.*\.atml$/);
  expect(snapshots(cli.cwd)).toHaveLength(before + 2);
});

test('chains refresh refs after actions without snapshots and capture a final Tab', async ({ cli }) => {
  await cli.open('<input id="task"><input id="next">');
  const before = snapshots(cli.cwd).length;
  const output = await cli.run('eval', '() => document.querySelector("#task").id = "renamed"',
      '--then', 'click', ':renamed', '--then', 'type', 'Water flowers', '--then', 'press', 'Tab');
  expect(snapshots(cli.cwd)).toHaveLength(before + 1);
  expect(fs.readFileSync(path.resolve(cli.cwd, output.split('\n').at(-1)!), 'utf8')).toContain(':renamed input value="Water flowers"');
  expect(await cli.run('eval', 'document.activeElement.id')).toContain('"next"');
});

test('explicit intermediate snapshots stay visible and the final snapshot respects inline mode', async ({ cli }) => {
  await cli.open('<input id="task">');
  const before = snapshots(cli.cwd).length;
  const output = await cli.run('snapshot', ':task', '--filename=before.atml',
      '--then', 'click', ':task', '--then', 'type', 'Water flowers', '--inline', '--json');
  expect(output).toContain('./before.atml');
  expect(fs.readFileSync(path.join(cli.cwd, 'before.atml'), 'utf8')).toContain(':task input value');
  expect(JSON.parse(output.slice(output.indexOf('{'))).snapshot).toBe(':task input value="Water flowers"');
  expect(snapshots(cli.cwd)).toHaveLength(before);
});

test('chains stop after a browser action fails', async ({ cli }) => {
  await cli.open('<input id="task">');
  const result = await cli.result('fill', ':missing', 'x', '--then', 'fill', ':task', 'should not run');
  expect(result.exitCode).toBe(1);
  expect(await cli.run('eval', '() => document.querySelector("input").value')).toContain('""');
});

test('chains stop after CLI validation fails', async ({ cli }) => {
  await cli.open('<input id="task">');
  const result = await cli.result('unknown-action', '--then', 'fill', ':task', 'should not run');
  expect(result.exitCode).toBe(1);
  expect(result.output + result.error).toContain('Unknown command');
  expect(await cli.run('eval', '() => document.querySelector("input").value')).toContain('""');
});

test('chains pass escaped separator text literally', async ({ cli }) => {
  await cli.open('<input id="task">');
  await cli.run('click', ':task', '--then', 'type', '--', '--then');
  expect(await cli.run('eval', '() => document.querySelector("input").value')).toContain('"--then"');
});
