import fs from 'fs';
import path from 'path';
import { test, expect } from './helpers';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'range-controls.html'), 'utf8');
const expected = fs.readFileSync(path.join(__dirname, 'fixtures', 'range-controls.atml'), 'utf8').trimEnd();

test('range roles expose only their present semantic values by default', async ({ cli }) => {
  await cli.open(fixture);
  const snapshot = JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot;
  expect(snapshot).toBe(expected);
  expect(JSON.parse(await cli.run('snapshot', 'default', '#complete', '--depth=1', '--inline', '--json')).snapshot)
    .toBe('id=complete label=Result role=progressbar valuemax=100 valuemin=0 valuenow=100');
});

test('range values refresh and disappear when removed, without using old SVG text', async ({ cli }) => {
  await cli.open(fixture);
  await cli.run('click', 'default', ':update');
  const snapshot = JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot;
  expect(snapshot).toContain('id=complete label=Result role=progressbar valuemax=90 valuemin=10 valuenow=37 valuetext="37 of 90"');
  expect(snapshot).toContain('label=Fuel role=meter valuemax=10.5 valuemin=-5 valuenow=6.25 valuetext="6.25 liters"');
  expect(snapshot).toContain(':volume role=slider valuemax=120 valuemin=0 valuenow=60\n');
  expect(snapshot).toContain(':quantity role=spinbutton valuemax=9 valuemin=1 valuenow=4 valuetext="4 items"');
  expect(snapshot).toContain('id=pending role=progressbar valuemax=100 valuemin=0 valuenow=25 valuetext="Quarter done"');
  expect(snapshot).not.toContain('100%');
  expect(snapshot).not.toContain('previous');
  expect(snapshot).not.toContain('Quiet');
  await cli.run('click', 'default', ':reset');
  expect(JSON.parse(await cli.run('snapshot', 'default', '#complete', '--inline', '--json')).snapshot)
    .toBe('id=complete label=Result role=progressbar valuemax=90 valuemin=10');
  expect(JSON.parse(await cli.run('snapshot', 'default', '#pending', '--inline', '--json')).snapshot)
    .toBe('id=pending role=progressbar valuemax=100 valuemin=0');
});

test('range values respect filters and coexist with configured attributes and tags', async ({ cli }) => {
  const config = path.join(cli.cwd, '.config', 'browser-cli', 'config.toml');
  cli.configure('[atml]\nremove_selectors = [".filter-me"]\nkeep_tags = ["div"]\nkeep_attrs = ["data-units", "aria-description", "description", "aria-valuetext"]\n');
  await cli.open(fixture);
  const snapshot = JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot;
  expect(snapshot).toContain('div id=custom data-units=points description="Extra context" role=progressbar valuenow=8');
  expect(snapshot).toContain('div id=unrelated role=status valuetext="Unrelated value"');
  expect(snapshot).not.toContain('id=excluded');
  expect(snapshot).not.toContain('id=hidden');
  expect(snapshot).not.toContain('valuenow=999');
  expect(snapshot).not.toContain('busy');
  // Removing the configuration on the next capture restores defaults.
  fs.writeFileSync(config, '');
  expect(JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot).toBe(expected);
});
