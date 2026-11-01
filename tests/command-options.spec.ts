import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const { coreDirectory } = require('../scripts/runtime.cjs');
const core = coreDirectory();
const { minimist } = require(path.join(core, 'lib/tools/cli-client/minimist.js'));
const { validatePresentationOptions } = require(path.join(core, 'lib/tools/cli-client/presentation.js'));
const { parseCommand } = require('../.upstream/playwright/packages/playwright-core/src/tools/cli-daemon/command');
const { commands } = require('../.upstream/playwright/packages/playwright-core/src/tools/cli-daemon/commands');
const help = require(path.join(core, 'lib/tools/cli-client/help.json'));

function parse(argv: string[]) {
  const args = minimist(argv, { boolean: [...help.booleanOptions, 'inline', 'raw', 'json'], string: ['_'] });
  validatePresentationOptions(args, help.commands[args._[0]]);
  delete args.inline;
  delete args.format;
  delete args.raw;
  delete args.json;
  return parseCommand(commands[args._[0]], args);
}

test('focus accepts a required target and uses the shared backend command', () => {
  expect(parse(['focus', ':technical', '--inline'])).toEqual({ toolName: 'browser_focus', toolParams: { target: ':technical' } });
  expect(() => parse(['focus'])).toThrow();
  expect(help.commands.focus).toBeDefined();
});

test('find preserves literal text and valued regex parsing and generated metadata', () => {
  expect(parse(['find', 'Sign in']).toolParams).toEqual({ text: 'Sign in', regex: undefined, filename: undefined });
  expect(parse(['find', 'Sign in', '--regex=']).toolParams).toEqual({ text: 'Sign in', regex: '', filename: undefined });
  for (const regex of [['--regex', 'Sign (in|up)'], ['--regex=Sign (in|up)']])
    expect(parse(['find', ...regex]).toolParams).toEqual({ text: undefined, regex: 'Sign (in|up)', filename: undefined });
  expect(parse(['find', '--regex', '/sign (in|up)/i']).toolParams.regex).toBe('/sign (in|up)/i');
  expect(help.commands.find.flags.regex).toBe('string');
  expect(help.booleanOptions).not.toContain('regex');
  expect(help.commands.find.help).toContain('--regex <pattern>');
  expect(help.commands.snapshot.help).toMatch(/--boxes\s+include/);
});

test('find parser rejects a boolean regex flag, conflicting queries and invalid patterns with an example', () => {
  for (const args of [
    ['find', 'Sign (in|up)', '--regex'],
    ['find', '--regex'],
    ['find'],
    ['find', '--regex='],
    ['find', 'Sign in', '--regex', 'Sign (in|up)'],
    ['find', '--regex=['],
    ['find', '--regex=/sign/z'],
  ])
    expect(() => parse(args), args.join(' ')).toThrow('browser find <session> --regex "Sign (in|up)"');
});

for (const filename of [['--filename', 'source script.js'], ['--filename=source script.js']]) {
  for (const mode of [[], ['--raw'], ['--json']]) {
    test(`parses run-code input with inline and ${[...filename, ...mode].join(' ')}`, () => {
      expect(parse(['run-code', ...filename, '--inline', ...mode])).toEqual({
        toolName: 'browser_run_code_unsafe', toolParams: { code: undefined, filename: 'source script.js' },
      });
      expect(parse(['run-code', ...filename]).toolParams.filename).toBe('source script.js');
    });
  }
}

test('keeps positional code and input filename separate from presentation', () => {
  expect(parse(['run-code', 'async page => 42', '--inline', '--format=yaml']).toolParams).toEqual({ code: 'async page => 42', filename: undefined });
  expect(parse(['run-code', 'async page => 0', '--filename=input.js', '--inline']).toolParams).toEqual({ code: 'async page => 0', filename: 'input.js' });
  expect(() => parse(['run-code', '--filename=input.js', '--format=bad'])).toThrow('--format must be atml or yaml');
});

test('command metadata classifies file options and preserves output conflicts', () => {
  expect(help.commands['run-code'].fileOptions).toEqual({ filename: 'input' });
  for (const [name, command] of Object.entries(commands) as [string, any][]) {
    if (!command.options?.shape.filename) continue;
    expect(help.commands[name].fileOptions.filename, name).toBe(name === 'run-code' ? 'input' : 'output');
    if (name !== 'run-code') {
      for (const mode of [[], ['--raw'], ['--json']])
        expect(() => parse([name, '--filename=output.atml', '--inline', ...mode]), name).toThrow('--inline cannot be combined with --filename');
    }
  }
  // Validation follows declared roles rather than a hard-coded flag or command name.
  expect(() => validatePresentationOptions({ _: [], inline: true, source: 'in.js', destination: 'out.atml' }, { fileOptions: { source: 'input', destination: 'output' } })).toThrow('--inline cannot be combined with --destination');
});

test('file-backed execution reads and invokes the source exactly once', async ({}, info) => {
  const filename = info.outputPath('source.js');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, 'async page => page.increment()');
  const { default: tools } = require('../.upstream/playwright/packages/playwright-core/src/tools/backend/runCode');
  const readFile = fs.promises.readFile;
  let reads = 0, executions = 0, snapshots = 0;
  const results: string[] = [];
  fs.promises.readFile = ((...args: any[]) => {
    if (args[0] === filename) ++reads;
    return (readFile as any)(...args);
  }) as typeof readFile;
  try {
    const tab = {
      page: { increment: () => ++executions },
      modalStates: () => [],
      context: { onUnhandledRejection: () => () => {} },
      waitForCompletion: async (callback: () => Promise<void>) => await callback(),
    };
    await tools[0].handle({ ensureTab: async () => tab }, { filename, code: '() => { throw new Error("filename must take precedence"); }' }, {
      resolveClientFilename: async (value: string) => value,
      addCode: () => {},
      addTextResult: (value: string) => results.push(value),
      setIncludeSnapshot: () => ++snapshots,
    });
    expect({ reads, executions, snapshots, results }).toEqual({ reads: 1, executions: 1, snapshots: 1, results: ['1'] });
  } finally {
    fs.promises.readFile = readFile;
  }
});
