import { test, expect } from '@playwright/test';

const { splitCommands } = require('../scripts/command-chain.cjs');

test('single commands and shell metacharacters keep their existing arguments', () => {
  expect(splitCommands(['type', 'Buy groceries; press Enter & echo hello'])).toBeNull();
  expect(splitCommands(['eval', '() => "--then"'])).toBeNull();
  expect(splitCommands(['type', '--', '--then'])).toBeNull();
});

for (const session of [['-s=ff'], ['-s', 'ff'], ['--session=ff'], ['--session', 'ff']]) {
  test(`chains inherit ${session.join(' ')} while other flags stay local`, () => {
    expect(splitCommands([...session, 'type', 'Buy groceries', '--inline', '--then', 'press', 'Enter'])).toEqual([
      [...session, 'type', 'Buy groceries', '--inline'],
      [...session, 'press', 'Enter'],
    ]);
  });
}

test('explicit session changes carry forward to later actions', () => {
  expect(splitCommands(['-s=ff', 'snapshot', '--then', '--session', 'other', 'snapshot', '--then', 'close'])).toEqual([
    ['-s=ff', 'snapshot'], ['--session', 'other', 'snapshot'], ['--session', 'other', 'close'],
  ]);
});

test('positional escape permits literal separator text after a chain', () => {
  expect(splitCommands(['-s=ff', 'snapshot', '--then', 'type', '--', '--then'])).toEqual([
    ['-s=ff', 'snapshot'], ['-s=ff', 'type', '--', '--then'],
  ]);
});

test('malformed chains are rejected before any action runs', () => {
  for (const args of [
    ['--then', 'press', 'Enter'], ['snapshot', '--then'], ['snapshot', '--then', '--then', 'close'],
    ['-s', '--then', 'close'], ['--session=', 'snapshot', '--then', 'close'],
  ])
    expect(() => splitCommands(args), args.join(' ')).toThrow(/command|session/);
});
