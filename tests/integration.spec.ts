/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { test, expect } from '@playwright/test';
import { runCli as runBrowser, browserCacheDirectory } from './helpers';

type CliResult = {
  output: string;
  error: string;
  exitCode: number | null;
};

async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const cliPath = path.join(__dirname, '../browser.js');
  fs.mkdirSync(path.join(test.info().outputPath(), '.config', 'browser-cli'), { recursive: true });
  fs.writeFileSync(path.join(test.info().outputPath(), '.config', 'browser-cli', 'cli.config.json'), JSON.stringify({ browser: { browserName: 'chromium', launchOptions: { headless: true } } }));

  return new Promise<CliResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const childProcess = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        HOME: test.info().outputPath(),
        USERPROFILE: test.info().outputPath(),
        BROWSER_ATML_CONFIG: '',
        PLAYWRIGHT_BROWSERS_PATH: browserCacheDirectory,
        PLAYWRIGHT_CLI_INSTALLATION_FOR_TEST: test.info().outputPath(),
        PWTEST_DAEMON_SESSION_DIR: test.info().outputPath('sessions'),
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        ...env,
      },
      cwd: test.info().outputPath(),
    });

    childProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      resolve({
        output: stdout.trim(),
        error: stderr.trim(),
        exitCode: code,
      });
    });

    childProcess.on('error', reject);
  });
}

test('install creates the browser-cli config directory and ignores its logs', async ({}, info) => {
  const cwd = info.outputPath();
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/');
  expect(await runBrowser(cwd, ['install'])).toEqual(expect.objectContaining({ exitCode: 0 }));
  expect(fs.statSync(path.join(cwd, '.config', 'browser-cli')).isDirectory()).toBe(true);
  const ignored = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
  expect(ignored).toContain('\n.logs/browser-cli/\n');
  expect(fs.existsSync(path.join(cwd, '.playwright'))).toBe(false);
  expect(await runBrowser(cwd, ['install'])).toEqual(expect.objectContaining({ exitCode: 0 }));
  expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe(ignored);
  fs.writeFileSync(path.join(cwd, '.gitignore'), '/.logs/\n');
  expect(await runBrowser(cwd, ['install'])).toEqual(expect.objectContaining({ exitCode: 0 }));
  expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe('/.logs/\n');
});

test('blank sessions remain usable but data URLs are denied without an allowlist', async ({}) => {
  const blank = await runCli(['open', 'perso']);
  expect(blank.exitCode, blank.error).toBe(0);
  expect(blank.output).toContain('Browser `perso` opened');
  expect((await runCli(['eval', 'perso', 'location.href', '--raw'])).output).toBe('"about:blank"');
  expect((await runCli(['close', 'perso'])).exitCode).toBe(0);
  expect(await runCli(['open', 'default', 'data:text/html,hello', '--persistent', '--inline'])).toEqual(expect.objectContaining({
    output: expect.stringContaining('navigation.allowed_urls'),
    exitCode: 1,
  }));

  expect(await runCli(['delete-data', 'default'])).toEqual(expect.objectContaining({
    output: expect.stringContaining('Deleted user data for'),
    exitCode: 0,
  }));
});

test('CLI requires a positional session and rejects all former session flags', async ({}) => {
  for (const args of [['open'], ['snapshot'], ['close'], ['attach', '--cdp=chrome']]) {
    const result = await runCli(args, { PLAYWRIGHT_CLI_SESSION: 'implicit' });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Missing session name');
  }
  for (const flags of [['-s=old'], ['-s', 'old'], ['--session=old'], ['--session', 'old']]) {
    const result = await runCli([...flags, 'open']);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Session flags have been removed');
  }
  const close = await runCli(['close', 'perso'], { PLAYWRIGHT_CLI_SESSION: 'implicit' });
  expect(close.exitCode).toBe(0);
  expect(close.output).toContain("Browser 'perso' is not open.");
  expect((await runCli(['list', '--json'])).output).not.toContain('implicit');
  const help = await runCli(['open', '--help']);
  expect(help.exitCode).toBe(0);
  expect(help.output).toContain('browser open <session> [url]');
  expect(help.output).not.toContain('-s=');
});

test('attach rejects remote targets that cannot enforce the default navigation policy', async ({}) => {
  // The remote server must provide the same ATML injected engine as the CLI.
  const { coreDirectory } = require('../scripts/runtime.cjs');
  const { chromium } = require(coreDirectory());
  const server = await chromium.launchServer({ headless: true });
  try {
    const attached = await runCli(['attach', 'perso', '--endpoint', server.wsEndpoint(), '--inline']);
    expect(attached.exitCode, attached.error || attached.output).toBe(1);
    expect(attached.output + attached.error).toContain('navigation.allowed_urls requires a local browser connection');
    const browser = await chromium.connect(server.wsEndpoint());
    expect(browser.isConnected()).toBe(true);
    await browser.close();
  } finally {
    await runCli(['close-all']);
    await server.close();
  }
});

test('warns when installed skill is out of date', async ({}) => {
  expect(await runCli(['install', '--skills'], { NO_UPDATE_NOTIFIER: '1' })).toEqual(expect.objectContaining({
    exitCode: 0,
  }));

  const skillFile = path.join(test.info().outputPath(), '.claude', 'skills', 'browser', 'SKILL.md');
  fs.appendFileSync(skillFile, 'x');

  const env = { CI: '', NO_UPDATE_NOTIFIER: '' };
  expect(await runCli(['--help'], env)).toEqual(expect.objectContaining({
    error: expect.stringContaining('does not match the tool version'),
  }));

  expect(await runCli(['--help'], env)).toEqual(expect.objectContaining({
    error: expect.not.stringContaining('does not match the tool version'),
  }));
});

test('does not warn when installed skill only differs in line endings', async ({}) => {
  expect(await runCli(['install', '--skills'], { NO_UPDATE_NOTIFIER: '1' })).toEqual(expect.objectContaining({
    exitCode: 0,
  }));

  const skillFile = path.join(test.info().outputPath(), '.claude', 'skills', 'browser', 'SKILL.md');
  fs.writeFileSync(skillFile, fs.readFileSync(skillFile, 'utf8').replace(/\r?\n/g, '\r\n'));

  expect(await runCli(['--help'], { CI: '', NO_UPDATE_NOTIFIER: '' })).toEqual(expect.objectContaining({
    error: expect.not.stringContaining('does not match the tool version'),
  }));
});
