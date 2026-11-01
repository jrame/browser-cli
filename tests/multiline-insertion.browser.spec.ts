import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import { installAtmlEventTracking } from '../src/atml/events';
import { test, expect } from './helpers';

const scenario = require('./fixtures/multiline-scenario.cjs');
const published = require('playwright-core');
const patched = require('../.artifacts/playwright-core');
const version = require('../upstream.json').playwright.version;
const original = fs.readFileSync(path.join(__dirname, 'fixtures/multiline-source.txt'), 'utf8').replace(/\r\n/g, '\n');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/multiline-insertion.html'));

function monacoDirectory(): string | undefined {
  if (process.env.MONACO_EDITOR_PATH) {
    const directory = path.resolve(process.env.MONACO_EDITOR_PATH);
    if (!fs.existsSync(path.join(directory, 'min/vs/loader.js')))
      throw new Error('MONACO_EDITOR_PATH must point to a monaco-editor package with min/vs/loader.js');
    return directory;
  }
  for (const root of [path.resolve(__dirname, '..'), path.resolve(__dirname, '../.upstream/playwright')]) {
    try {
      return path.dirname(createRequire(path.join(root, 'package.json')).resolve('monaco-editor/package.json'));
    } catch {}
  }
}

for (const target of ['textarea', 'contenteditable', 'monaco']) {
  for (const [payload, content] of [
    ['original', original], ['unicode', '\tÉté 你好 😀 e\u0301 "quotes" `code` \\ $ literal\n'],
  ]) {
    for (const eol of ['LF', 'CRLF']) {
      test(`${target} ${payload} ${eol} insertion matches direct Playwright through CLI`, async ({ cli, browserName }, info) => {
        test.setTimeout(180000);
        const monaco = monacoDirectory();
        test.skip(target === 'monaco' && !monaco, 'Local monaco-editor unavailable; set MONACO_EDITOR_PATH to its package directory');
        const source = content.replace(/\n/g, eol === 'CRLF' ? '\r\n' : '\n');
        if (payload === 'original') expect(source.length).toBe(eol === 'CRLF' ? 1001 : 962);
        const server = http.createServer((request, response) => {
          const pathname = new URL(request.url!, 'http://localhost').pathname;
          if (pathname.startsWith('/vs/') && monaco) {
            const filename = path.resolve(monaco, 'min', '.' + decodeURIComponent(pathname));
            const allowed = path.resolve(monaco, 'min/vs') + path.sep;
            if (!filename.startsWith(allowed) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
              response.writeHead(404).end();
              return;
            }
            response.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : 'application/javascript');
            response.end(fs.readFileSync(filename));
            return;
          }
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(fixture);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/` + (target === 'monaco' ? '?monaco' : '');
        cli.configure('', [new URL(url).origin + '/**']);
        const observations: Record<string, any> = {};
        const browsers: Record<string, string> = {};
        try {
          expect(require('playwright-core/package.json').version).toBe(version);
          expect(require('../.artifacts/playwright-core/package.json').version).toBe(version);
          for (const [mode, engine, tracking] of [
            ['published', published, false], ['patched', patched, false], ['patched-atml', patched, true],
          ] as const) {
            const browser = await engine[browserName].launch({ headless: true });
            try {
              browsers[mode] = browser.version();
              const context = await browser.newContext();
              if (tracking) await context.addInitScript(installAtmlEventTracking);
              const page = await context.newPage();
              await page.goto(url);
              observations[mode] = await scenario(page, { target, source });
            } finally {
              await browser.close();
            }
          }
          // A separate run-code execution and a later eval check capture any changes
          // caused by the automatic ATML snapshot after the function returns.
          for (const mode of ['cli-inline', 'cli-file']) {
            await cli.run(mode === 'cli-inline' ? 'open' : 'goto', 'default', url);
            const code = `async page => (${scenario.toString()})(page, ${JSON.stringify({ target, source })})`;
            let args: string[];
            if (mode === 'cli-file') {
              fs.writeFileSync(path.join(cli.cwd, 'insertion.js'), code);
              args = ['--filename', 'insertion.js'];
            } else {
              args = [code];
            }
            const response = JSON.parse(await cli.run('run-code', 'default', ...args, '--json'));
            observations[mode] = JSON.parse(response.result);
            const after = JSON.parse(await cli.run('eval', 'default', `() => ({
              value: ${target === 'monaco' ? 'window.editor.getModel().getValue()' : target === 'textarea' ? 'document.querySelector("#textarea").value' : 'document.querySelector("#contenteditable").innerText'},
              executions: window.insertionProbe.executions,
              listenerInstallations: window.insertionProbe.listenerInstallations
            })`, '--raw'));
            observations[mode].afterSnapshot = after;
          }
        } finally {
          // Close the CLI before the HTTP server, including Monaco worker requests.
          await cli.result('close-all');
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          const report = info.outputPath('insertion-observations.json');
          const monacoVersion = monaco ? JSON.parse(fs.readFileSync(path.join(monaco, 'package.json'), 'utf8')).version : null;
          fs.writeFileSync(report, JSON.stringify({ version, browsers, monacoVersion, target, payload, eol, source, observations }, null, 2));
          await info.attach('insertion-observations', { path: report, contentType: 'application/json' });
        }
        const baseline = observations.published;
        for (const [mode, result] of Object.entries(observations) as [string, any][]) {
          expect(result.probe, mode).toEqual({ executions: 1, listenerInstallations: 1 });
          expect(result.userAgent, mode).toBe(baseline.userAgent);
          expect(result.states, mode).toEqual(baseline.states);
          for (const state of result.states) {
            const normalized = content.replace(/\n/g, result.modelEOL ?? '\n');
            let expected = normalized.repeat(state.phase === 'append' ? 2 : 1);
            if (target === 'contenteditable') {
              // Native limitations of the pinned browsers, also reproduced without
              // the CLI or ATML. Preserve these observations rather than repair text.
              if (browserName === 'firefox' && state.phase === 'append')
                expected = normalized.slice(0, -1) + normalized + '\n';
              if (browserName === 'chromium') {
                // After replacing existing text with CRLF, subsequent identical
                // insertText calls emit beforeinput but do not change the DOM.
                if (eol === 'CRLF') expected = normalized;
                // Full innerText has extra presentation LFs for empty block lines.
                expected = expected.replace(/\n\n/g, '\n\n\n') + '\n';
                if (eol === 'CRLF' && state.phase !== 'replace')
                  expect(state.events.map((event: any) => event.type), mode).toEqual(['beforeinput']);
              }
            }
            expect(state.value, `${mode}: ${state.phase}`).toBe(expected);
          }
          if (result.afterSnapshot) {
            expect(result.afterSnapshot, mode).toEqual({ value: result.states[2].value, executions: 1, listenerInstallations: 1 });
          }
        }
        expect(new Set(Object.values(browsers)).size).toBe(1);
      });
    }
  }
}
