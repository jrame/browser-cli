import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { test as base, expect } from '@playwright/test';

// Keep the installed browser cache when isolating HOME for policy discovery.
export const browserCacheDirectory: string = require('../.artifacts/playwright-core/lib/coreBundle').registry.registryDirectory;

export type CliResult = { output: string; error: string; exitCode: number | null };
export function runCli(cwd: string, args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../browser.js'), ...args], {
      cwd, windowsHide: true,
      env: { ...process.env, HOME: cwd, USERPROFILE: cwd, PLAYWRIGHT_BROWSERS_PATH: browserCacheDirectory, BROWSER_ATML_CONFIG: '', NO_UPDATE_NOTIFIER: '1', PWTEST_DAEMON_SESSION_DIR: path.join(cwd, 'sessions'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', ...env },
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
  open(html: string, options?: string[], session?: string): Promise<string>;
  url(html: string): string;
  configure(source?: string, allowedUrls?: string[]): void;
};
export const test = base.extend<{ cli: Cli }>({
  cli: async ({ browserName }, use, info) => {
    const cwd = info.outputPath();
    fs.mkdirSync(path.join(cwd, '.config', 'browser-cli'), { recursive: true });
    const pages = new Map<string, string>();
    const server = http.createServer((request, response) => {
      const html = pages.get(request.url!);
      response.writeHead(html === undefined ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html === undefined || /^\s*<!doctype\s/i.test(html) ? html : '<!DOCTYPE html>' + html);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
      url: html => {
        const pathname = `/fixture/${pages.size + 1}`;
        pages.set(pathname, html);
        return origin + pathname;
      },
      configure: (source = '', allowedUrls = [origin + '/**']) => {
        fs.writeFileSync(path.join(cwd, '.config', 'browser-cli', 'config.toml'), `[navigation]\nallowed_urls = ${JSON.stringify(allowedUrls)}\n${source}`);
      },
      open: (html, options = [], session = 'default') => cli.run('open', session, cli.url(html), ...options),
    };
    cli.configure();
    try { await use(cli); }
    finally {
      await runCli(cwd, ['close-all']);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
});
export { expect };
