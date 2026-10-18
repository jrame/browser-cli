import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { test as base, expect } from '@playwright/test';

export type CliResult = { output: string; error: string; exitCode: number | null };
export function runCli(cwd: string, args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../browser.js'), ...args], {
      cwd, windowsHide: true,
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1', PWTEST_DAEMON_SESSION_DIR: path.join(cwd, 'sessions'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', ...env },
    });
    let output = '', error = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => error += data);
    child.on('error', reject);
    child.on('close', exitCode => resolve({ output: output.trim(), error: error.trim(), exitCode }));
  });
}

type Cli = {
  cwd: string;
  run(...args: string[]): Promise<string>;
  result(...args: string[]): Promise<CliResult>;
  open(html: string, options?: string[]): Promise<string>;
};
export const test = base.extend<{ cli: Cli }>({
  cli: async ({ browserName }, use, info) => {
    const cwd = info.outputPath();
    fs.mkdirSync(path.join(cwd, '.config', 'browser-cli'), { recursive: true });
    // Firefox actionability checks can take several seconds on busy CI runners.
    fs.writeFileSync(path.join(cwd, '.config', 'browser-cli', 'cli.config.json'), JSON.stringify({ browser: { browserName, launchOptions: { headless: true } }, timeouts: { action: 10000 } }));
    const cli: Cli = {
      cwd,
      result: (...args) => runCli(cwd, args),
      run: async (...args) => {
        const result = await runCli(cwd, args);
        expect(result, result.error || result.output).toEqual(expect.objectContaining({ exitCode: 0 }));
        return result.output;
      },
      open: (html, options = []) => cli.run('open', 'data:text/html;charset=utf-8,' + encodeURIComponent(html), ...options),
    };
    try { await use(cli); }
    finally { await runCli(cwd, ['close-all']); }
  },
});
export { expect };
