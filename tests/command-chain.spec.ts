import path from 'path';
import { test, expect } from '@playwright/test';

const { splitCommands } = require('../scripts/command-chain.cjs');
const { coreDirectory } = require('../scripts/runtime.cjs');
const core = coreDirectory();
const { minimist } = require(path.join(core, 'lib/tools/cli-client/minimist.js'));
const { rejectSessionFlags, takeSessionArgument } = require(path.join(core, 'lib/tools/cli-client/program.js'));
const help = require(path.join(core, 'lib/tools/cli-client/help.json'));

function parse(argv: string[]) {
  const args = minimist(argv, { boolean: [...help.booleanOptions, 'inline', 'raw', 'json'], string: ['_'] });
  rejectSessionFlags(args);
  takeSessionArgument(args, help.commands[args._[0]]);
  return args;
}

test('session follows the command and leaves URL, target, text and options intact', () => {
  for (const [command, values] of [
    ['open', ['https://example.com']], ['click', [':email']], ['type', ['Buy groceries']],
    ['snapshot', []], ['attach', ['bound-browser']],
  ] as [string, string[]][]) {
    const args = parse([command, 'perso', ...values]);
    expect(args.session).toBe('perso');
    expect(args._).toEqual([command, ...values]);
  }
  expect(parse(['run-code', '123', '--filename', 'source script.js'])).toEqual({ _: ['run-code'], session: '123', filename: 'source script.js' });
  expect(parse(['attach', 'work', '--cdp=msedge'])).toEqual({ _: ['attach'], session: 'work', cdp: 'msedge' });
  expect(parse(['snapshot', 'open']).session).toBe('open');
  expect(parse(['type', 'perso', '--', '--session=literal'])._).toEqual(['type', '--session=literal']);
});

test('session is required and legacy flags are rejected in all forms', () => {
  for (const args of [['open'], ['snapshot'], ['close'], ['attach', '--cdp=chrome'], ['type', '', 'hello']])
    expect(() => parse(args)).toThrow('Missing session name');
  for (const flag of [['-s=ff'], ['-s', 'ff'], ['--session=ff'], ['--session', 'ff'], ['--no-session'], ['--session=']]) {
    expect(() => parse([...flag, 'snapshot'])).toThrow('Session flags have been removed');
    expect(() => parse(['snapshot', 'perso', ...flag])).toThrow('Session flags have been removed');
  }
  for (const name of ['../outside', 'https://example.com', '.', '..', 'with spaces', ''])
    expect(() => parse(['open', name])).toThrow(/session name/);
});

test('workspace commands have no session and dashboard selection is optional', () => {
  expect(parse(['install-browser', 'chromium'])._).toEqual(['install-browser', 'chromium']);
  for (const command of ['list', 'close-all', 'kill-all', 'install', 'show'])
    expect(parse([command]).session).toBeUndefined();
  expect(parse(['show', 'perso']).session).toBe('perso');
  expect(() => parse(['show', '--annotate'])).toThrow('Missing session name');
  expect(help.commands.open.help).toContain('browser open <session> [url]');
  expect(help.commands.attach.flags).not.toHaveProperty('session');
  expect(help.global).not.toContain('-s=');
});

test('run-code input and presentation flags stay local in a chain', () => {
  expect(splitCommands(['run-code', 'code', '--filename', 'first.js', '--inline', '--then', 'run-code', '--filename=second.js', '--json'])).toEqual([
    ['run-code', 'code', '--filename', 'first.js', '--inline'],
    ['run-code', 'code', '--filename=second.js', '--json'],
  ]);
});

test('chains inherit sessions through workspace commands', () => {
  expect(splitCommands(['snapshot', 'ff', '--then', 'list', '--then', 'snapshot', ':scope', '--then', 'close'])).toEqual([
    ['snapshot', 'ff'], ['list'], ['snapshot', 'ff', ':scope'], ['close', 'ff'],
  ]);
  expect(splitCommands(['list', '--then', 'snapshot', 'perso', '--then', 'close'])).toEqual([
    ['list'], ['snapshot', 'perso'], ['close', 'perso'],
  ]);
});

test('inherited session injection preserves flags, option values and literal text', () => {
  expect(splitCommands(['snapshot', 'perso', '--then', '--filename', 'snapshot', 'snapshot', '--then', 'type', 'perso'])).toEqual([
    ['snapshot', 'perso'], ['--filename', 'snapshot', 'snapshot', 'perso'], ['type', 'perso', 'perso'],
  ]);
  expect(splitCommands(['snapshot', 'perso', '--then', '--json', 'snapshot'])).toEqual([
    ['snapshot', 'perso'], ['--json', 'snapshot', 'perso'],
  ]);
});

test('single commands, shell metacharacters and escaped separators keep their arguments', () => {
  expect(splitCommands(['type', 'ff', 'Buy groceries; press Enter & echo hello'])).toBeNull();
  expect(splitCommands(['eval', 'ff', '() => "--then"'])).toBeNull();
  expect(splitCommands(['type', 'ff', '--', '--then'])).toBeNull();
  expect(splitCommands(['snapshot', 'ff', '--then', 'type', '--', '--then'])).toEqual([
    ['snapshot', 'ff'], ['type', 'ff', '--', '--then'],
  ]);
});

test('malformed chains are rejected before any action runs', () => {
  for (const args of [
    ['--then', 'press', 'ff', 'Enter'], ['snapshot', 'ff', '--then'], ['snapshot', 'ff', '--then', '--then', 'close', 'ff'],
  ])
    expect(() => splitCommands(args), args.join(' ')).toThrow(/command/);
});
