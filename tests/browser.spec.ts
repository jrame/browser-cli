import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import { test, expect } from './helpers';

test('navigation allowlist checks open and goto, with browser-wide enforcement on Chromium', async ({ cli, browserName }) => {
  const requests: string[] = [];
  let redirectedHeader: string | undefined;
  const server = http.createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === '/allowed/header-redirect') {
      response.writeHead(302, { Location: '/allowed/header-target' });
      response.end();
      return;
    }
    if (request.url === '/allowed/header-target') redirectedHeader = request.headers['x-policy-test'] as string | undefined;
    if (request.url === '/allowed/redirect') {
      response.writeHead(302, { Location: '/blocked/redirect-target' });
      response.end();
      return;
    }
    if (request.url === '/allowed/redirect-ok') {
      response.writeHead(302, { Location: '/allowed/home' });
      response.end();
      return;
    }
    response.setHeader('Content-Type', request.url === '/external.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/external.js' ? 'window.externalScriptLoaded = true;' : `<title>Allowed</title>
      <script src="/external.js"></script><a id="blocked" href="/blocked/link">Blocked link</a>
      <a id="popup" target="_blank" href="/blocked/popup">Popup</a><button id="frame" onclick="document.body.insertAdjacentHTML('beforeend', '<iframe src=/blocked/frame></iframe>')">Frame</button>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fs.writeFileSync(path.join(cli.cwd, '.config', 'browser-cli', 'config.toml'), `[navigation]\nallowed_urls = ["${origin}/allowed/**"]`);
  try {
    const denied = await cli.result('open', `${origin}/blocked/direct`);
    expect(denied.exitCode).toBe(1);
    expect(denied.output).toContain('navigation.allowed_urls');
    await cli.run('open', `${origin}/allowed/home`);
    expect(await cli.run('eval', 'window.externalScriptLoaded')).toContain('true');
    const deniedGoto = await cli.result('goto', `${origin}/blocked/goto`);
    expect(deniedGoto.exitCode).toBe(1);
    expect(deniedGoto.output).toContain('navigation.allowed_urls');
    expect((await cli.result('goto', 'data:text/html,Blocked')).output).toContain('navigation.allowed_urls');
    expect((await cli.result('goto', 'file:///tmp/blocked.html')).output).toContain('navigation.allowed_urls');
    expect(requests.filter(url => url.startsWith('/blocked/'))).toEqual([]);
    if (browserName === 'firefox') {
      // Firefox accepts the policy with command-level checks only.
      await cli.run('goto', `${origin}/allowed/redirect`);
      expect(await cli.run('eval', 'location.pathname')).toContain('/blocked/redirect-target');
      await cli.run('goto', `${origin}/allowed/home`);
      return;
    }
    expect((await cli.result('goto', `${origin}/allowed/redirect`)).exitCode).toBe(1);
    await cli.run('goto', `${origin}/allowed/redirect-ok`);
    expect(await cli.run('eval', 'location.pathname')).toContain('/allowed/home');
    expect((await cli.result('click', ':blocked')).output).toContain('navigation.allowed_urls');
    await cli.run('goto', `${origin}/allowed/home`);
    await cli.result('click', ':frame');
    await cli.result('click', ':popup');
    await cli.result('snapshot', '--inline');
    expect(requests.filter(url => url.startsWith('/blocked/'))).toEqual([]);
    expect(requests).toContain('/external.js');
    await cli.run('run-code', `async page => { await page.route('**/allowed/header-redirect', route => route.continue({ headers: { ...route.request().headers(), 'x-policy-test': 'preserved' } })); await page.goto('${origin}/allowed/header-redirect'); }`);
    expect(redirectedHeader).toBe('preserved');
    // User route mocks cannot permit an otherwise forbidden navigation.
    expect((await cli.result('run-code', `async page => { await page.route('**/blocked/**', route => route.continue()); await page.goto('${origin}/blocked/code'); }`)).output).toContain('navigation.allowed_urls');
    expect((await cli.result('run-code', `async page => { await page.route('**/allowed/rewrite', route => route.continue({ url: '${origin}/blocked/rewrite' })); await page.goto('${origin}/allowed/rewrite'); }`)).output).toContain('navigation.allowed_urls');
    expect(requests.filter(url => url.startsWith('/blocked/'))).toEqual([]);
  } finally {
    await cli.result('close-all');
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('names snapshots, code logs, screenshots and console logs using the date and sanitized page title', async ({ cli }) => {
  const opened = await cli.open('<title>Mon titre / test: &quot;ok&quot; ? * \\ été</title><button id="ok">Go</button>');
  const snapshot = opened.split('\n').find(line => line.endsWith('.atml'))!;
  const codeLog = snapshot.replace(/\.atml$/, '.js');
  expect(path.dirname(path.resolve(cli.cwd, snapshot))).toBe(path.join(cli.cwd, '.logs', 'browser-cli'));
  expect(path.basename(snapshot)).toMatch(/^\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2}_\d{3}Z_Mon_titre_test_ok_t\.atml$/);
  expect(fs.readFileSync(path.resolve(cli.cwd, codeLog), 'utf8')).toContain('await page.goto(');
  expect(opened).not.toContain('Ran Playwright code');
  expect(opened).not.toContain('Code log');
  expect(opened).not.toContain('```js');
  expect(opened).not.toContain('await page.goto(');

  const screenshot = await cli.run('screenshot');
  const image = screenshot.match(/\[Screenshot of viewport\]\(([^)]+\.png)\)/)![1];
  const screenshotLog = image.replace(/\.png$/, '.js');
  expect(path.basename(image)).toMatch(/^\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2}_\d{3}Z_Mon_titre_test_ok_t\.png$/);
  expect(fs.statSync(path.resolve(cli.cwd, image)).size).toBeGreaterThan(100);
  expect(fs.readFileSync(path.resolve(cli.cwd, screenshotLog), 'utf8')).toContain('await page.screenshot(');
  expect(screenshot).not.toContain('await page.screenshot(');

  const logDir = path.join(cli.cwd, '.logs', 'browser-cli');
  const previousLogs = new Set(fs.readdirSync(logDir));
  const executed = await cli.run('run-code', 'async page => { await page.locator("#ok").click(); }');
  const runLog = path.join(logDir, fs.readdirSync(logDir).find(file => file.endsWith('.js') && !previousLogs.has(file))!);
  expect(fs.readFileSync(path.resolve(cli.cwd, runLog), 'utf8')).toContain('await page.locator("#ok").click()');
  expect(executed).not.toContain('await page.locator');

  const logged = await cli.run('eval', '() => console.warn("Console filename check")');
  const consoleLog = logged.match(/New console entries: (.+\.log)#L/)![1];
  expect(path.dirname(path.resolve(cli.cwd, consoleLog))).toBe(path.join(cli.cwd, '.logs', 'browser-cli'));
  expect(path.basename(consoleLog)).toMatch(/^\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2}_\d{3}Z_Mon_titre_test_ok_t_console\.log$/);
  expect(fs.readFileSync(path.resolve(cli.cwd, consoleLog), 'utf8')).toContain('Console filename check');
  const appended = await cli.run('eval', '() => console.warn("Next console entry")');
  expect(appended.match(/New console entries: (.+\.log)#L/)![1]).toBe(consoleLog);
  expect(fs.readFileSync(path.resolve(cli.cwd, consoleLog), 'utf8')).toContain('Next console entry');
});

test('uses a safe fallback title and saves code logs in raw and JSON modes', async ({ cli }) => {
  await cli.open('<title>/?*😀</title><button>Go</button>');
  const snapshot = JSON.parse(await cli.run('snapshot', '--json')).snapshot.file;
  expect(path.basename(snapshot)).toMatch(/Z_page\.atml$/);
  const before = fs.readdirSync(path.join(cli.cwd, '.logs', 'browser-cli')).filter(file => file.endsWith('.js'));
  expect(await cli.run('eval', '6 * 7', '--raw')).toBe('42');
  expect(JSON.parse(await cli.run('eval', '7 * 8', '--json')).result).toBe('56');
  const after = fs.readdirSync(path.join(cli.cwd, '.logs', 'browser-cli')).filter(file => file.endsWith('.js'));
  expect(after.length).toBe(before.length + 2);
  await cli.run('goto', 'data:text/html,<button>Untitled</button>');
  expect(JSON.parse(await cli.run('snapshot', '--json')).snapshot.file).toMatch(/Z_page\.atml$/);
  const logged = await cli.run('eval', '() => console.warn("Untitled console")');
  expect(logged.match(/New console entries: (.+\.log)#L/)![1]).toMatch(/Z_page_console\.log$/);
});

test('writes ATML by default, supports inline, YAML, JSON and explicit filenames', async ({ cli }) => {
  const opened = await cli.open('<input id="email"><button data-testid="submit">Connexion</button><button>Continuer</button>');
  const filename = opened.split('\n').find(line => line.endsWith('.atml'));
  expect(filename).toBeTruthy();
  const contents = fs.readFileSync(path.resolve(cli.cwd, filename!), 'utf8');
  expect(contents).toMatch(/^url: data:text\/html;charset=utf-8,.*\ntitle: \n\n/);
  expect(contents).toContain(':email input');
  expect(contents).toMatch(/^:email input/m);
  const submit = contents.match(/(:\d+) button data-testid=submit\n  : Connexion/)![1];
  expect(contents).toMatch(/:\d+ button\n  : Continuer/);
  expect(opened).not.toContain(`${submit} button`);
  expect(await cli.run('snapshot', '--inline')).toContain(`${submit} button data-testid=submit`);
  expect(await cli.run('snapshot', '--format=yaml')).toContain('[ref=');
  expect(await cli.run('snapshot', '--format=yaml', '--filename=native.yml')).toContain('native.yml');
  expect(fs.readFileSync(path.join(cli.cwd, 'native.yml'), 'utf8')).toContain('[ref=');
  expect(await cli.run('snapshot', '--filename=custom.atml')).toContain('custom.atml');
  expect(fs.readFileSync(path.join(cli.cwd, 'custom.atml'), 'utf8')).toContain(`${submit} button data-testid=submit`);
  const json = JSON.parse(await cli.run('snapshot', '--json'));
  expect(json.snapshot.file).toMatch(/\.atml$/);
  expect(JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot).toContain(`${submit} button data-testid=submit`);
});

test('default action output is ok and a snapshot path with page metadata in the file', async ({ cli }) => {
  const html = '<title>React • TodoMVC</title><input id="task" onkeydown="if(event.key===\'Enter\') document.title=\'Updated • TodoMVC\'">';
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  await cli.run('-s=compact', 'open', url);
  await cli.run('-s=compact', 'click', ':task');
  const output = await cli.run('-s=compact', 'press', 'Enter');
  const lines = output.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe('ok');
  expect(lines[1]).toMatch(/\.atml$/);
  expect(fs.readFileSync(path.resolve(cli.cwd, lines[1]), 'utf8')).toBe(`url: ${url}\ntitle: Updated • TodoMVC\n\n:task input value`);
  expect(await cli.run('-s=compact', 'snapshot', '#task', '--filename=scoped.atml')).toBe('ok\n./scoped.atml');
  expect(fs.readFileSync(path.join(cli.cwd, 'scoped.atml'), 'utf8')).toContain(`url: ${url}\ntitle: Updated • TodoMVC\n\n`);
  const failure = await cli.result('-s=compact', 'click', ':missing');
  expect(failure.exitCode).toBe(1);
  expect(failure.output).toContain('### Error\n');
  expect(failure.output).not.toMatch(/^ok\n/);
  expect(failure.output).toContain('Unknown ATML ref :missing');
});

test('type captures the entered value without requiring submit', async ({ cli }) => {
  await cli.open('<input id="task">');
  await cli.run('click', ':task');
  const output = await cli.run('type', 'Water flowers');
  const lines = output.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe('ok');
  expect(lines[1]).toMatch(/\.atml$/);
  expect(fs.readFileSync(path.resolve(cli.cwd, lines[1]), 'utf8')).toContain(':task input value="Water flowers"');
  expect(await cli.run('type', ' today', '--inline')).toContain('value="Water flowers today"');
  expect(JSON.parse(await cli.run('type', '!', '--json')).snapshot.file).toMatch(/\.atml$/);
});

test('ID, numeric and native targets work across input, capture and scoped snapshots', async ({ cli }) => {
  await cli.open('<input id="email"><button data-testid="submit" onclick="this.textContent=\'Envoyé\'">Connexion</button><button onclick="this.textContent=\'OK\'">Continuer</button><section id="zone"><span>Texte</span><button id="inside">Dedans</button></section>');
  await cli.run('fill', ':email', 'user@example.com');
  const initial = await cli.run('snapshot', '--inline');
  expect(initial).toContain('value=user@example.com');
  const submit = initial.match(/(:\d+) button data-testid=submit/)![1];
  expect((await cli.result('click', ':submit')).output).toContain('Unknown ATML ref');
  await cli.run('click', submit);
  let snapshot = await cli.run('snapshot', '--inline');
  expect(snapshot).toContain('Envoyé');
  const number = snapshot.match(/(:\d+) button\n  : Continuer/)![1];
  await cli.run('click', number);
  expect(await cli.run('snapshot', '--inline')).toContain('\n  : OK');
  const section = JSON.parse(await cli.run('snapshot', '#zone', '--inline', '--depth=1', '--json')).snapshot;
  expect(section).toContain('id=zone');
  expect(section).not.toContain('section');
  expect(section).not.toContain(':inside button');
  expect(await cli.run('snapshot', '#zone', '--inline')).toContain(':inside button');
  expect(await cli.run('eval', 'el => el.value', '#email')).toContain('user@example.com');
  expect(await cli.run('screenshot', '#email', '--filename=input.png')).toContain('input.png');
  expect(fs.statSync(path.join(cli.cwd, 'input.png')).size).toBeGreaterThan(100);
  const yaml = await cli.run('snapshot', '--format=yaml');
  const native = yaml.match(/button "Envoyé" \[ref=([^\]]+)\]/)?.[1];
  expect(native).toBeTruthy();
  await cli.run('click', native!);
});

test('colon refs work unquoted in a shell and stay distinct from text and old refs', async ({ cli }) => {
  const html = '<div id="static">:123 button</div><button id="named" onclick="this.textContent=\'Named clicked\'">Named</button><button onclick="this.textContent=\'Numeric clicked\'">Numeric</button>';
  const opened = await cli.run('-s=colon', 'open', 'data:text/html,' + encodeURIComponent(html), '--inline');
  expect(opened).toContain('id=static\n  : :123 button\n:named button');
  const numeric = opened.match(/^(:\d+) button\n  : Numeric/m)![1];
  const windows = process.platform === 'win32';
  const quote = (value: string) => windows ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
  for (const ref of [':named', numeric]) {
    const command = `${windows ? '& ' : ''}${quote(process.execPath)} ${quote(path.resolve(__dirname, '../browser.js'))} -s=colon click ${ref}`;
    const result = spawnSync(windows ? 'powershell.exe' : '/bin/sh', windows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command], {
      cwd: cli.cwd, windowsHide: true, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1', PWTEST_DAEMON_SESSION_DIR: path.join(cli.cwd, 'sessions'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    expect(result.status, result.error?.message || result.stderr || result.stdout).toBe(0);
  }
  const snapshot = await cli.run('-s=colon', 'snapshot', '--inline');
  expect(snapshot).toContain('Named clicked');
  expect(snapshot).toContain('Numeric clicked');
  expect((await cli.result('-s=colon', 'click', '@named')).exitCode).toBe(1);
  expect((await cli.result('-s=colon', 'click', '@' + numeric.slice(1))).exitCode).toBe(1);
  expect((await cli.result('-s=colon', 'click', ':missing')).output).toContain('Unknown ATML ref :missing');
});

test('only interactive nodes show refs, including native, semantic, editable and delegated controls', async ({ cli }) => {
  await cli.open(`<header>Header</header><div id="static">Static</div><img alt="Cover">
    <a id="placeholder">Placeholder</a><a id="link" href="#static">Link</a><button id="native">Native</button><input id="field">
    <details><summary id="expand">Expand</summary>Details</details>
    <div id="role" role="button">Delegated</div><div id="edit" contenteditable>Editable</div>
    <span tabindex="0">Focusable</span><div id="inline-event" onkeydown="void 0">Key</div>
    <div id="tracked">Tracked</div><script>
      document.querySelector('#tracked').addEventListener('click', () => {});
      document.addEventListener('click', event => {
        if (event.target.id === 'role') event.target.textContent = 'Delegated clicked';
      });
    </script>`);
  const snapshot = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  expect(snapshot).toContain('header\n  : Header\nid=static\n  : Static\nimg alt=Cover');
  expect(snapshot).not.toMatch(/:(static|\d+).*\n  : Static/);
  expect(snapshot).toContain(':link a\n  : Link');
  expect(snapshot).toContain('a id=placeholder\n  : Placeholder');
  expect(snapshot).not.toContain(':placeholder');
  expect(snapshot).toContain(':native button\n  : Native');
  expect(snapshot).toContain(':field input');
  expect(snapshot).toContain(':expand summary');
  expect(snapshot).toContain(':role');
  expect(snapshot).toContain(':edit');
  expect(snapshot).toMatch(/:\d+\n  : Focusable/);
  expect(snapshot).toContain(':inline-event on:keydown');
  expect(snapshot).toContain(':tracked on:click');
  await cli.run('click', ':role');
  expect(await cli.run('snapshot', ':role', '--inline')).toContain('Delegated clicked');
  expect(await cli.run('snapshot', '#static', '--inline')).toContain('id=static\n  : Static');
});

test('numeric HTML IDs cannot take over numeric DOM references', async ({ cli }) => {
  await cli.open('<button>Original</button>');
  const initial = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  const original = initial.match(/^(:\d+) button/m)![1];
  await cli.run('eval', `() => { const button=document.createElement('button'); button.id='${original.slice(1)}'; button.textContent='Numeric ID'; button.onclick=()=>button.textContent='Numeric clicked'; document.body.append(button); }`);
  const snapshot = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  const numeric = snapshot.match(/^(:\d+) button id=\d+\n  : Numeric ID/m)![1];
  expect(numeric).not.toBe(original);
  await cli.run('click', numeric);
  expect(await cli.run('snapshot', original, '--inline')).toContain('Original');
  expect(await cli.run('snapshot', numeric, '--inline')).toContain('Numeric clicked');
});

test('duplicate IDs, reserved numeric test IDs and unusual IDs fall back safely', async ({ cli }) => {
  const snapshot = await cli.open('<button id="same" data-testid="first">A</button><button id="same" data-testid="second">B</button><button data-testid="13">Numeric</button><button data-testid="dup">D1</button><button data-testid="dup">D2</button><button id="a b">Space</button><button id="quote&quot;id">Quote</button>', ['--inline']);
  expect(snapshot).toMatch(/:\d+ button data-testid=first id=same\n  : A/);
  expect(snapshot).toMatch(/:\d+ button data-testid=second id=same\n  : B/);
  expect(snapshot).toMatch(/:\d+ button data-testid=13\n  : Numeric/);
  expect(snapshot).toMatch(/:\d+ button data-testid=dup\n  : D1/);
  expect(snapshot).toMatch(/:\d+ button id="a b"\n  : Space/);
  expect(snapshot).toMatch(/:\d+ button id=quote"id\n  : Quote/);
  expect((await cli.result('click', '#same')).output).toContain('Ambiguous');
  expect((await cli.result('click', ':same')).output).toContain('Ambiguous');
  expect((await cli.result('click', ':dup')).output).toContain('Unknown ATML ref');
});

test('test IDs never become refs, including duplicate and changing values in scoped snapshots', async ({ cli }) => {
  await cli.open('<section id="zone"><button data-testid="shared" onclick="this.textContent=\'First clicked\'">First</button></section><button data-testid="shared" onclick="this.textContent=\'Second clicked\'">Second</button>');
  const initial = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  const first = initial.match(/(:\d+) button data-testid=shared\n    : First/)![1];
  const second = initial.match(/(:\d+) button data-testid=shared\n  : Second/)![1];
  expect(first).not.toBe(second);
  expect(initial).not.toContain(':shared');
  const scoped = JSON.parse(await cli.run('snapshot', '#zone', '--inline', '--json')).snapshot;
  expect(scoped).toContain(`${first} button data-testid=shared`);
  expect(scoped).not.toContain(':shared');
  await cli.run('click', first);
  await cli.run('snapshot', '--inline');
  await cli.run('click', second);
  await cli.run('eval', 'document.querySelector("#zone button").setAttribute("data-testid", "renamed")');
  const current = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  expect(current).toContain(`${first} button data-testid=renamed\n    : First clicked`);
  expect(current).toContain(`${second} button data-testid=shared\n  : Second clicked`);
  expect((await cli.result('click', ':renamed')).output).toContain('Unknown ATML ref');
});

test('numeric refs preserve DOM identity and never rebind after replacement or navigation', async ({ cli }) => {
  const first = await cli.open('<button>Original</button>', ['--inline']);
  const old = first.match(/(:\d+) button\n  : Original/)![1];
  expect(await cli.run('snapshot', '--inline')).toContain(`${old} button\n  : Original`);
  await cli.run('eval', 'document.querySelector("button").outerHTML = "<button>Replacement</button>"');
  expect((await cli.result('click', old)).exitCode).toBe(1);
  const replaced = await cli.run('snapshot', '--inline');
  expect(replaced).not.toContain(`${old} button\n`);
  const replacement = replaced.match(/(:\d+) button\n  : Replacement/)![1];
  await cli.run('goto', 'data:text/html,' + encodeURIComponent('<button>New page</button>'));
  expect((await cli.result('click', replacement)).output).toContain('stale');
  expect(await cli.run('snapshot', '--inline')).not.toContain(`${replacement} button\n`);
});

test('URL rules filter only the output and keep configured attributes, classes and tags', async ({ cli }) => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<nav class="menu">Excluded menu</nav><article><div data-business="42" class="business-row">Business</div><button id="ok">Go</button></article>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const directory = path.join(cli.cwd, '.config', 'browser-cli');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'config.toml'), `[atml.rules.local]\nurl = "http://127.0.0.1:${port}/app/**"\nremove_selectors = [".menu"]\nkeep_attrs = ["data-business"]\nkeep_tags = ["article"]\nclass_regex = "business"\n`);
    await cli.run('open', `http://127.0.0.1:${port}/app/page?x=1#top`);
    const snapshot = await cli.run('snapshot', '--inline');
    expect(snapshot).not.toContain('Excluded menu');
    expect(snapshot).toContain('article\n');
    expect(snapshot).toContain('.business-row data-business=42');
    expect(await cli.run('eval', 'document.querySelector(".menu").textContent')).toContain('Excluded menu');
    await cli.run('goto', `http://127.0.0.1:${port}/other`);
    expect(await cli.run('snapshot', '--inline')).toContain('Excluded menu');
    fs.writeFileSync(path.join(cli.cwd, 'extra.toml'), '[atml]\nremove_selectors = ["article"]');
    expect(await cli.run('snapshot', '--inline', '--atml-config=extra.toml')).not.toContain('Business');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('cross-origin frames and open shadow roots share uniqueness checks and actionable refs', async ({ cli }) => {
  const child = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<nav class="menu">Frame menu</nav><button id="duplicate" data-frame="inside" data-testid="duplicate-test" onclick="this.textContent=\'Frame clicked\'">Frame</button>');
  });
  await new Promise<void>(resolve => child.listen(0, '127.0.0.1', resolve));
  const port = (child.address() as { port: number }).port;
  const parent = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<nav class="menu">Parent menu</nav><button id="duplicate" data-testid="duplicate-test">Parent</button><iframe src="http://127.0.0.1:${port}/"></iframe><div id="host"></div><script>const shadow=document.querySelector('#host').attachShadow({mode:'open'}); const button=document.createElement('button'); button.id='shadow';button.textContent='Shadow';button.onclick=()=>button.textContent='Shadow clicked';shadow.append(button);const duplicate=document.createElement('button');duplicate.id='duplicate';duplicate.textContent='Shadow duplicate';shadow.append(duplicate);</script>`);
  });
  await new Promise<void>(resolve => parent.listen(0, '127.0.0.1', resolve));
  const parentPort = (parent.address() as { port: number }).port;
  try {
    fs.writeFileSync(path.join(cli.cwd, '.config', 'browser-cli', 'config.toml'), `[atml.rules.frame]\nurl = "http://127.0.0.1:${port}/**"\nremove_selectors = [".menu"]\nkeep_attrs = ["data-frame"]\n`);
    await cli.run('open', `http://127.0.0.1:${parentPort}/`);
    const snapshot = await cli.run('snapshot', '--inline');
    const frame = snapshot.match(/(:\d+) button data-frame=inside data-testid=duplicate-test id=duplicate\n    : Frame/)![1];
    expect(snapshot).toContain(':shadow button');
    expect(snapshot).not.toContain(':duplicate');
    expect(snapshot).not.toContain('Frame menu');
    expect(snapshot).toContain('Parent menu');
    const scoped = await cli.run('snapshot', frame, '--inline');
    expect(scoped).toContain('\n  : Frame');
    expect(scoped).not.toContain('Parent menu');
    await cli.run('click', frame);
    expect(await cli.run('snapshot', '--inline')).toContain('Frame clicked');
    await cli.run('click', '#shadow');
    expect(await cli.run('snapshot', '--inline')).toContain('Shadow clicked');
    await cli.run('eval', 'document.querySelector("iframe").remove()');
    expect((await cli.result('click', frame)).output).toContain('stale');
  } finally {
    child.closeAllConnections(); parent.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => child.close(() => resolve())), new Promise<void>(resolve => parent.close(() => resolve()))]);
  }
});

test('live form state, custom DOM targets, whitespace and hidden content are rendered', async ({ cli }) => {
  await cli.open('<style>.gone {display:none}</style><div class="gone">Secret</div><div><span>Hel</span><span>lo &amp; </span><span>world</span></div><input id="check" type="checkbox"><input id="password" type="password" value="secret"><input id="input" value="old"><div id="custom">Custom target</div><button disabled>Disabled</button>');
  const snapshot = await cli.run('snapshot', '--inline', '--raw');
  expect(snapshot).not.toContain('Secret');
  expect(snapshot).not.toContain('secret');
  expect(snapshot).toContain(':password input type=password value=****');
  expect(snapshot).toContain('Hello & world');
  expect(snapshot).toContain('id=custom\n  : Custom target');
  expect(snapshot).toMatch(/:\d+ button disabled\n  : Disabled/);
  await cli.run('check', '#check');
  await cli.run('eval', 'document.querySelector("#input").value="current"');
  expect(await cli.run('snapshot', '--inline')).toContain('value=current');
  expect(await cli.run('snapshot', '--inline')).toMatch(/:check input checked/);
  expect(await cli.run('eval', 'el => el.textContent', '#custom')).toContain('Custom target');
});

test('password masks distinguish empty and filled live values without exposing their length', async ({ cli }) => {
  await cli.open('<input id="password" type="PASSWORD" value="initial">');
  for (const value of ['x', 'much-longer-password', '']) {
    await cli.run('fill', ':password', value);
    const snapshot = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
    expect(snapshot).toBe(`:password input type=PASSWORD value${value ? '=****' : ''}`);
  }
});

test('find searches ATML text and attributes, supports regex and file output', async ({ cli }) => {
  await cli.open('<button data-testid="business-action">Launch</button><button>Elsewhere</button>');
  expect(await cli.run('find', 'business-action')).toMatch(/:\d+ button data-testid=business-action/);
  expect(await cli.run('find', '--regex=/launch/i')).toContain('data-testid=business-action');
  await cli.run('find', 'Launch', '--filename=find.txt');
  expect(fs.readFileSync(path.join(cli.cwd, 'find.txt'), 'utf8')).toContain('data-testid=business-action');
  expect((await cli.result('find', '--regex=[')).exitCode).toBe(1);
  expect((await cli.result('snapshot', '--inline', '--filename=bad.atml')).exitCode).toBe(1);
  expect((await cli.result('snapshot', '--format=html')).exitCode).toBe(1);
});

test('inline fragments merge under kept and flattened parents', async ({ cli }) => {
  await cli.open('<button id="word"><span>Bon</span><span>jour</span></button><div id="nested">Pré<span>fixe <strong>im<em>bri</em>qué</strong></span> !</div><div><span>Hello</span><span> \n\t </span><span>World</span></div><div><span>Click </span><button id="here"><span>he</span><span>re</span></button><span> please</span></div>');
  const snapshot = await cli.run('snapshot', '--inline', '--raw');
  expect(snapshot).toContain(':word button\n  : Bonjour');
  expect(snapshot).toContain('id=nested\n  : Préfixe imbriqué !');
  expect(snapshot).toContain('HelloWorld');
  expect(snapshot).toContain(': Click \n:here button\n  : here\n: please');
  expect(await cli.run('snapshot', '#word', '--inline', '--depth=1')).toContain(':word button');
});

test('non-interactive counters merge text without a ref and remain targetable by selectors', async ({ cli }) => {
  await cli.open('<span data-testid="todo-count" class="todo-count"><strong>1</strong> item left</span>');
  const initial = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  expect(initial).not.toMatch(/:\d+/);
  const counter = '[data-testid="todo-count"]';
  expect(JSON.parse(await cli.run('snapshot', counter, '--inline', '--json')).snapshot).toBe('data-testid=todo-count\n  : 1 item left');
  await cli.run('eval', `document.querySelector('[data-testid="todo-count"]').innerHTML = '<strong>2</strong> item<!-- -->s<!-- --> left'`);
  expect(JSON.parse(await cli.run('snapshot', counter, '--inline', '--json')).snapshot).toBe('data-testid=todo-count\n  : 2 items left');
});

test('keeps header and footer by default while flattening plain list items', async ({ cli }) => {
  await cli.open('<header id="top">Accueil</header><main><ul><li>Premier</li><li id="second">Deuxième<button id="action">Go</button><ul><li>Enfant</li></ul></li></ul></main><footer>Fin</footer>');
  const snapshot = JSON.parse(await cli.run('snapshot', '--inline', '--json')).snapshot;
  expect(snapshot).toMatch(/^header id=top\n  : Accueil\n: Premier\nid=second\n  : Deuxième\n  :action button\n    : Go\n  : Enfant\nfooter\n  : Fin$/);
  const shallow = JSON.parse(await cli.run('snapshot', '#second', '--depth=1', '--inline', '--json')).snapshot;
  expect(shallow).toBe('id=second');
});

test('text boundaries follow the historical inline tag list regardless of CSS display', async ({ cli }) => {
  await cli.open('<div id="lines">Avant<div><span>Li</span><span>gne 1</span></div><div>Ligne 2</div>Après</div><div id="break">Une<br>Deux</div><div id="inline"><span style="display:inline-block">Bon</span><span style="display:inline-flex">jour</span><div style="display:inline"> !</div></div><span id="css-block"><span style="display:block">A</span><span style="display:block">B</span></span>');
  const snapshot = await cli.run('snapshot', '--inline', '--raw');
  expect(snapshot).toContain('id=lines\n  : Avant\n  : Ligne 1\n  : Ligne 2\n  : Après');
  expect(snapshot).toContain('id=break\n  : Une\n  : Deux');
  expect(snapshot).toContain('id=inline\n  : Bonjour\n  : !');
  expect(snapshot).toContain('id=css-block\n  : AB');
  const shallow = await cli.run('snapshot', '#lines', '--inline', '--depth=1', '--raw');
  expect(shallow.split('\n')).toContain('id=lines');
  expect(shallow).not.toContain('Ligne 1');
});

// Port the Python Monaco regressions through real DOM extraction on both engines.
test('Monaco spans preserve code, non-breaking spaces and separate block lines', async ({ cli }) => {
  await cli.open('<div><div class="view-line"><span><span class="mtk18">import</span><span class="mtk1">&nbsp;</span><span class="mtk1 squiggly-inline-unnecessary">sys</span></span></div><div class="view-line"><span><span class="mtk18">import</span><span class="mtk1">&nbsp;&nbsp;</span><span class="mtk1">math</span></span></div></div><button id="special"><span>&nbsp;&nbsp;Été &amp; </span><strong>&lt;code&gt;</strong><span> &quot;你好&quot; \\ fin&nbsp;&nbsp;</span></button>');
  const snapshot = await cli.run('snapshot', '--inline', '--raw');
  expect(snapshot).toContain(': importsys\n: importmath');
  expect(snapshot).toContain(':special button\n  :   Été & <code> "你好" \\ fin');
  expect(snapshot).not.toContain('mtk18');
});

test('tooltip attributes emit a presence marker without replacing accessible labels', async ({ cli }) => {
  await cli.open('<span title="Private tooltip text"></span><span title=""></span><span data-tooltip-html="&lt;b&gt;Private HTML&lt;/b&gt;"></span><span data-tooltip=""></span><span data-tooltip-content=""></span><button id="tip" class="active" title="Private title" aria-label="Accessible name" aria-expanded="false" onclick="this.textContent=\'Changed\'"><span>Ac</span><span>tion</span></button><span data-testid="tip-test" data-tooltip-placement="top">Help</span><span role="tooltip">Visible help</span><span hidden title="Hidden tip">Secret</span>');
  const snapshot = await cli.run('snapshot', '--inline', '--raw');
  expect(snapshot.match(/^tooltip$/gm)).toHaveLength(5);
  expect(snapshot).toContain(':tip button tooltip expanded=false label="Accessible name"\n  : Action');
  expect(snapshot).toMatch(/tooltip data-testid=tip-test\n  : Help/);
  expect(snapshot).toMatch(/role=tooltip\n  : Visible help/);
  expect(snapshot).not.toContain('Private');
  expect(snapshot).not.toContain('data-tooltip');
  expect(snapshot).not.toContain('Secret');
  await cli.run('click', '#tip');
  expect(await cli.run('snapshot', '#tip', '--inline')).toContain('tooltip expanded=false label="Accessible name"\n  : Changed');
});

// Port the Python Steam row regression: image, nested text, tooltip, then price.
test('nested Steam-like rows preserve text around kept images and empty tooltips', async ({ cli }) => {
  await cli.open('<a id="game"><div class="search_capsule"><img alt="Cover"></div><div class="responsive_search_name_combined"><div><span>Kingdom Come: </span><span>Deliverance II</span><span class="platform_img win"></span></div><div>4 Feb, 2025</div><div><span class="search_review_summary positive" data-tooltip-html="Very Positive..."></span></div><div><span>59,99</span><span>€</span></div></div></a>');
  const snapshot = await cli.run('snapshot', '--inline', '--raw');
  expect(snapshot).toMatch(/a id=game\n  img alt=Cover\n  : Kingdom Come: Deliverance II\n  \.platform_img\n  : 4 Feb, 2025\n  tooltip\n  : 59,99€/);
  expect(snapshot).not.toContain('Very Positive');
  expect(snapshot.split('\n').filter(line => /^ +$/.test(line))).toHaveLength(0);
});

test('tabs keep separate reference registries', async ({ cli }) => {
  await cli.open('<button>First tab</button>');
  const first = (await cli.run('snapshot', '--inline')).match(/(:\d+) button\n  : First tab/)![1];
  await cli.run('tab-new', 'data:text/html,' + encodeURIComponent('<p>No targets</p>'));
  expect((await cli.result('click', first)).exitCode).toBe(1);
  await cli.run('tab-select', '0');
  expect(await cli.run('snapshot', '--inline')).toContain(`${first} button\n  : First tab`);
  await cli.run('click', first);
});

test('configured test attributes, special IDs, element boxes and live selection work', async ({ cli }) => {
  const configuration = path.join(cli.cwd, '.config', 'browser-cli', 'cli.config.json');
  const config = JSON.parse(fs.readFileSync(configuration, 'utf8'));
  config.testIdAttribute = 'data-pw';
  fs.writeFileSync(configuration, JSON.stringify(config));
  await cli.open('<input id="user:email.v2"><button data-pw="custom" onclick="this.textContent=\'Changed\'">Custom</button><select id="pick"><option value="a">A</option><option value="b">B</option></select>');
  const snapshot = await cli.run('snapshot', '--inline', '--boxes');
  const custom = snapshot.match(/(:\d+) button data-pw=custom/)![1];
  expect(snapshot).not.toContain(':custom');
  expect(snapshot).toMatch(/\[box=\d+,\d+,\d+,\d+\]/);
  await cli.run('fill', ':user:email.v2', 'special@example.com');
  await cli.run('click', custom);
  await cli.run('select', ':pick', 'b');
  const current = await cli.run('snapshot', '--inline');
  expect(current).toContain('value=special@example.com');
  expect(current).toContain(`${custom} button data-pw=custom\n  : Changed`);
  expect(current).toMatch(/:\d+ option selected value=b\n    : B/);
});
