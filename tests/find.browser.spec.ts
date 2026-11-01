import fs from 'fs';
import path from 'path';
import { test, expect } from './helpers';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'find-query.html'), 'utf8');

test('find distinguishes literal text from valued regex options on a local fixture', async ({ cli }) => {
  await cli.open(fixture);
  const literal = await cli.run('find', 'default', 'sign IN');
  expect(literal).toContain('Found 2 matches for "sign IN"');
  expect(literal).toContain('data-testid=login-action');
  // Preserve the existing treatment of an empty regex value alongside plain text.
  expect(await cli.run('find', 'default', 'sign IN', '--regex=')).toContain('Found 2 matches for "sign IN"');
  expect(await cli.run('find', 'default', 'Sign (in|up)')).toContain('Found 1 match for "Sign (in|up)"');
  expect(await cli.run('find', 'default', 'Add to cart')).toContain('Found 1 match for "Add to cart"');
  expect(await cli.run('find', 'default', 'login-action')).toContain('Found 1 match');
  expect(await cli.run('find', 'default', 'no such text')).toContain('No matches found');

  for (const option of [['--regex', 'Sign (in|up)'], ['--regex=Sign (in|up)'], ['--regex', '/Sign (in|up)/g']]) {
    const output = await cli.run('find', 'default', ...option);
    expect(output).toContain('Found 2 matches for /Sign (in|up)/');
    expect(output).toContain('data-testid=login-action');
  }
  for (const option of [['--regex', '/sign (in|up)/i'], ['--regex=/sign (in|up)/i']])
    expect(await cli.run('find', 'default', ...option)).toContain('Found 3 matches for /sign (in|up)/i');
  expect(await cli.run('find', 'default', '--regex', '\\$[0-9]+\\.[0-9]{2}')).toContain('Found 1 match for /\\$[0-9]+\\.[0-9]{2}/');

  await cli.run('find', 'default', '--regex', 'Sign (in|up)', '--filename=find results.md');
  expect(fs.readFileSync(path.join(cli.cwd, 'find results.md'), 'utf8')).toContain('Found 2 matches');
  expect(await cli.run('find', 'default', '--regex', '/sign (in|up)/i', '--format=yaml')).toContain('Found 3 matches');
});

test('find rejects malformed invocations and invalid regexes without falling back to literal text', async ({ cli }) => {
  // Validate before requiring an open session as well as against a live fixture.
  const malformed = [
    ['find', 'Sign (in|up)', '--regex'],
    ['find', '--regex'],
    ['find', '--regex', '--filename=bad.md'],
    ['find'],
    ['find', '--regex='],
    ['find', 'Sign in', '--regex', 'Sign (in|up)'],
    ['find', '--regex=Sign', '--regex=up'],
  ];
  const invalid = ['[', '(', '/[/i', '/sign/z', '/sign/ii'];
  for (const open of [false, true]) {
    if (open)
      await cli.open(fixture);
    for (const args of [...malformed, ...invalid.map(pattern => ['find', '--regex', pattern])]) {
      const result = await cli.result(args[0], 'default', ...args.slice(1));
      expect(result.exitCode, args.join(' ')).toBe(1);
      expect(result.error).toContain('browser find <session> --regex "Sign (in|up)"');
      expect(result.output).not.toContain('Found ');
      expect(result.output).not.toContain('No matches found');
      if (invalid.includes(args[2]))
        expect(result.error).toContain('Invalid regular expression');
    }
  }
  expect(fs.existsSync(path.join(cli.cwd, 'bad.md'))).toBe(false);
});

test('find generated help describes a pattern value and quotes the canonical invocation', async ({ cli }) => {
  const help = await cli.run('find', 'default', '--help');
  expect(help).toContain('browser find <session> [text]');
  expect(help).toContain('--regex <pattern>');
  expect(help).toContain('not a boolean flag');
  expect(help).toContain('browser find <session> --regex "sign (in|up)"');
  expect(help).toContain('"/sign (in|up)/i"');
});
