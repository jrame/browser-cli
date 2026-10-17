import fs from 'fs';
import path from 'path';
import http from 'http';
import { installAtmlEventTracking } from '../src/atml/events';
import { test, expect } from './helpers';

test('startup listeners keep generic nodes actionable without changing references or filters', async ({ cli }) => {
  fs.writeFileSync(path.join(cli.cwd, '.config', 'browser-cli', 'config.toml'), '[atml]\nremove_selectors = [".excluded"]\n');
  await cli.open(`<div>Registered</div><span data-testid="action">Test ID</span>
    <section id="custom">ID</section><div>Animation only</div><div class="excluded">Excluded</div>
    <div id="shadow"></div><div data-has-listener="change,animationend">Authored</div>
    <script>
      const nodes = document.querySelectorAll('div,span,section');
      for (const node of [nodes[0],nodes[1],nodes[2],nodes[4]])
        node.addEventListener('click', function() { this.textContent = 'Clicked'; });
      nodes[3].addEventListener('animationend', () => {});
      const root = document.querySelector('#shadow').attachShadow({mode:'open'});
      root.innerHTML = '<span>Shadow action</span>';
      root.firstChild.addEventListener('keydown', () => {});
    </script>`);
  const snapshot = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  expect(snapshot).toMatch(/(:\d+) on:click\n  : Registered/);
  const action = snapshot.match(/(:\d+) on:click data-testid=action\n  : Test ID/)![1];
  expect(snapshot).toContain(':custom on:click\n  : ID');
  expect(snapshot).toMatch(/:\d+ on:keydown\n    : Shadow action/);
  expect(snapshot).toMatch(/:\d+ on:change\n  : Authored/);
  expect(snapshot).not.toContain('on:animationend');
  expect(snapshot).not.toContain('Excluded');
  const ref = snapshot.match(/(:\d+) on:click\n  : Registered/)![1];
  expect(await cli.run('snapshot', '--inline')).toContain(`${ref} on:click\n  : Registered`);
  await cli.run('click', ref);
  expect(await cli.run('snapshot', ref, '--inline')).toContain(`${ref} on:click\n  : Clicked`);
  await cli.run('snapshot', '--inline');
  await cli.run('click', action);
  expect(await cli.run('snapshot', '--inline')).toContain(`${action} on:click data-testid=action\n  : Clicked`);
  expect(await cli.run('snapshot', '--format=yaml', '--inline')).toContain('[ref=');
});

test('removal, capture identity, duplicate options and once clear only the matching hints', async ({ cli }) => {
  await cli.open(`<div id="target">Target</div><div id="once">Once</div><script>
    window.target = document.querySelector('#target'); window.fn = () => {};
    target.addEventListener('click', fn);
    target.addEventListener('click', fn, {once:true});
    target.addEventListener('click', fn, true);
    target.addEventListener('keydown', fn);
    document.querySelector('#once').addEventListener('click', () => {}, {once:true});
  </script>`);
  expect(await cli.run('snapshot', '--inline')).toContain(':target on:click on:keydown');
  await cli.run('eval', '() => { target.removeEventListener("click", fn, true); target.click(); }');
  expect(await cli.run('snapshot', '--inline')).toContain(':target on:click on:keydown');
  await cli.run('eval', '() => { target.removeEventListener("click", fn); target.removeEventListener("keydown", fn); document.querySelector("#once").click(); }');
  const snapshot = await cli.run('snapshot', '--inline');
  expect(snapshot).not.toContain('on:');
  expect(snapshot).not.toContain(':target');
  expect(snapshot).not.toContain(':once');
  expect(snapshot).toContain('id=target');
  expect((await cli.result('click', ':target')).output).toContain('Unknown ATML ref');
  // Native form elements remain concise even when tracked.
  await cli.run('eval', '() => { document.body.innerHTML="<button>Native</button>"; document.querySelector("button").addEventListener("click", () => {}); }');
  expect(await cli.run('snapshot', '--inline')).toMatch(/:\d+ button\n  : Native/);
});

test('aborted and timed out signals leave no persistent hints even when abort events are stopped', async ({ cli }) => {
  await cli.open(`<div id="target">Signal</div><div id="blocked">Blocked</div><div id="timed">Timed</div><script>
    window.controller = new AbortController();
    document.querySelector('#target').addEventListener('click', () => {}, {signal:controller.signal});
    const dead = AbortSignal.abort();
    document.querySelector('#target').addEventListener('keydown', () => {}, {signal:dead});
    window.blockedController = new AbortController();
    blockedController.signal.addEventListener('abort', event => event.stopImmediatePropagation());
    document.querySelector('#blocked').addEventListener('click', () => {}, {signal:blockedController.signal});
  </script>`);
  const before = await cli.run('snapshot', '--inline');
  expect(before).toContain(':target on:click');
  expect(before).not.toContain('on:keydown');
  expect(before).toContain(':blocked on:click');
  await cli.run('eval', `() => { controller.abort(); blockedController.abort();
    document.querySelector('#timed').addEventListener('click', () => {}, {signal:AbortSignal.timeout(1)}); }`);
  await cli.run('run-code', 'async page => { await page.waitForFunction(() => !document.querySelector("#timed").hasAttribute("data-browser-atml-listeners")); }');
  expect(await cli.run('snapshot', '--inline')).not.toContain('on:');
});

test('context instrumentation runs before scripts in new tabs, popups, frames and navigations', async ({ cli }) => {
  const html = (name: string) => `<script>const element=document.createElement('div');element.id='${name}';element.textContent='${name}';element.addEventListener('click',function(){this.textContent='Clicked ${name}'});document.addEventListener('DOMContentLoaded',()=>document.body.append(element));</script>`;
  const child = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html'); response.end(html('frame'));
  });
  await new Promise<void>(resolve => child.listen(0, '127.0.0.1', resolve));
  const childPort = (child.address() as { port: number }).port;
  const parent = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(html('main') + `<iframe src="http://127.0.0.1:${childPort}"></iframe>`);
  });
  await new Promise<void>(resolve => parent.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(parent.address() as { port: number }).port}`;
  try {
    const initial = await cli.run('open', url, '--inline');
    expect(initial).toContain(':main on:click');
    expect(initial).toContain(':frame on:click');
    await cli.run('click', '#frame');
    expect(await cli.run('snapshot', '--inline')).toContain('Clicked frame');
    await cli.run('run-code', `async page => { await page.evaluate(url => { const frame=document.createElement('iframe'); frame.src=url;document.body.append(frame); }, 'http://127.0.0.1:${childPort}/dynamic'); await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2); await page.frames()[2].waitForSelector('#frame'); }`);
    const dynamic = await cli.run('snapshot', '--inline');
    expect(dynamic.match(/on:click id=frame\n    : (?:Clicked )?frame/g)).toHaveLength(2);
    await cli.run('tab-new', url);
    expect(await cli.run('snapshot', '--inline')).toContain(':main on:click');
    await cli.run('goto', url + '/navigation');
    expect(await cli.run('snapshot', '--inline')).toContain(':frame on:click');
    await cli.run('run-code', `async page => { const popup=page.waitForEvent('popup'); await page.evaluate(url => window.open(url), '${url}/popup'); await (await popup).waitForLoadState(); }`);
    await cli.run('tab-select', '2');
    expect(await cli.run('snapshot', '--inline')).toContain(':main on:click');
  } finally {
    child.closeAllConnections(); parent.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => child.close(() => resolve())), new Promise<void>(resolve => parent.close(() => resolve()))]);
  }
});

test('instrumentation preserves native callbacks, options conversion, ordering and cancellation', async ({ browser }) => {
  const results: unknown[] = [];
  for (const tracked of [false, true]) {
    const context = await browser.newContext();
    if (tracked) await context.addInitScript(installAtmlEventTracking);
    const page = await context.newPage();
    results.push(await page.evaluate(() => {
      const target = document.createElement('div'); document.body.append(target);
      const trace: string[] = [], errors: string[] = [];
      const capture = {get capture() { trace.push('remove capture'); return true; }};
      const callback = function(this: EventTarget, event: Event) { trace.push(`fn:${this === target}:${event.currentTarget === target}`); event.preventDefault(); };
      const options = {
        get capture() { trace.push('capture'); return true; },
        get once() { trace.push('once'); return false; },
        get passive() { trace.push('passive'); return false; },
        get signal() { trace.push('signal'); return undefined; },
      };
      target.addEventListener('click', callback, options);
      target.addEventListener('click', callback, { capture: true, once: true, passive: true });
      const object = { handleEvent(this: unknown, event: Event) { trace.push(`object:${this === object}:${event.currentTarget === target}`); }};
      target.addEventListener('click', object);
      object.handleEvent = function() { trace.push(`replaced:${this === object}`); };
      const dispatch = () => target.dispatchEvent(new Event('click', {cancelable:true}));
      const cancelled = [dispatch(), dispatch()];
      target.removeEventListener('click', callback, capture);
      target.removeEventListener('click', object);
      cancelled.push(dispatch());
      target.addEventListener('click', event => event.preventDefault(), {passive:true, once:true});
      cancelled.push(dispatch());
      target.addEventListener('click', event => { trace.push('stop'); event.stopImmediatePropagation(); }, {once:true});
      target.addEventListener('click', () => trace.push('after stop'), {once:true});
      dispatch(); dispatch();
      for (const invoke of [
        () => target.addEventListener('click', null),
        () => target.addEventListener('click', 1 as any),
        () => target.addEventListener(Symbol('type') as any, callback),
        () => target.addEventListener('click', callback, {signal:{} as any}),
        () => target.addEventListener('click', callback, {get capture() {throw new RangeError('capture');}}),
      ]) {
        try { invoke(); errors.push('ok'); } catch (error) { errors.push((error as Error).name); }
      }
      return {trace, cancelled, errors};
    }));
    await context.close();
  }
  expect(results[1]).toEqual(results[0]);
});

test('once reentrancy, exceptions and signal combinations match native listener lifetimes', async ({ browser }) => {
  const results: unknown[] = [];
  for (const tracked of [false, true]) {
    const context = await browser.newContext();
    if (tracked) await context.addInitScript(installAtmlEventTracking);
    const page = await context.newPage();
    results.push(await page.evaluate(() => {
      const target = document.createElement('div'); document.body.append(target);
      const trace: string[] = [];
      const dispatch = () => target.dispatchEvent(new Event('click'));
      const callback = () => { trace.push('once'); dispatch(); target.addEventListener('click', callback, {once:true}); };
      target.addEventListener('click', callback, {once:true}); dispatch(); dispatch();
      target.removeEventListener('click', callback);
      window.addEventListener('error', event => {event.preventDefault(); trace.push('error');});
      target.addEventListener('click', () => {throw Error('listener');}, {once:true}); dispatch(); dispatch();
      const a = new AbortController(), b = new AbortController();
      const signalCallback = () => trace.push('signal');
      target.addEventListener('click', signalCallback, {signal:a.signal});
      target.addEventListener('click', signalCallback, {signal:b.signal,once:true});
      b.abort(); dispatch(); a.abort(); dispatch();
      const stopped = new AbortController();
      stopped.signal.addEventListener('abort', event => event.stopImmediatePropagation());
      target.addEventListener('click', signalCallback, {signal:AbortSignal.any([stopped.signal])});
      stopped.abort(); dispatch();
      document.body.dispatchEvent(new Event('__browser_atml_refresh__', {bubbles:true}));
      return {trace, marker:target.getAttribute('data-browser-atml-listeners')};
    }));
    await context.close();
  }
  expect(results[1]).toEqual(results[0]);
});

test('reinstalling tracking preserves existing callback identities and authored event metadata', async ({ page }) => {
  await page.evaluate(installAtmlEventTracking);
  await page.evaluate(() => {
    const element = document.createElement('div'); element.id = 'action';
    element.setAttribute('data-has-listener', 'change'); document.body.append(element);
    (window as any).calls = 0;
    (window as any).callback = () => (window as any).calls++;
    element.addEventListener('click', (window as any).callback);
  });
  await page.evaluate(installAtmlEventTracking);
  expect(await page.evaluate(() => {
    const element = document.querySelector('#action')!;
    element.addEventListener('click', (window as any).callback);
    element.dispatchEvent(new Event('click'));
    element.removeEventListener('click', (window as any).callback);
    element.dispatchEvent(new Event('click'));
    return {calls:(window as any).calls, tracked:element.getAttribute('data-browser-atml-listeners'), authored:element.getAttribute('data-has-listener')};
  })).toEqual({calls:1, tracked:null, authored:'change'});
});
