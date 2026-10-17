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
import { runCli as runBrowser } from './helpers';

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

test('open data URL', async ({}) => {
  expect(await runCli(['open', 'data:text/html,hello', '--persistent', '--inline'])).toEqual(expect.objectContaining({
    output: expect.stringContaining('hello'),
    exitCode: 0,
  }));

  expect(await runCli(['delete-data'])).toEqual(expect.objectContaining({
    output: expect.stringContaining('Deleted user data for'),
    exitCode: 0,
  }));
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
