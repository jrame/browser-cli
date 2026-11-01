import fs from 'fs';
import path from 'path';
import { test, expect } from './helpers';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'input-actionability.html'), 'utf8');

test('local technical input reproduces a resolved click failure and successful keyboard focus', async ({ cli }) => {
  await cli.open(fixture);
  const snapshot = JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot;
  expect(snapshot).toContain(':technical textarea label="Editor input" value');
  expect(snapshot.split('\n').find(line => line.includes(':technical '))).toContain('[pointer-box=none]');
  expect(snapshot).toContain(':ordinary input label="Ordinary input" value');
  expect(snapshot).toContain(':disabled input disabled value');
  expect(snapshot).toContain(':offscreen input label="Offscreen input" value');
  expect(snapshot).toContain(':covered input label="Covered input" value');
  expect(snapshot).not.toMatch(/option[^\n]*pointer-box/);
  for (const id of ['display-hidden', 'visibility-hidden', 'hidden-type']) expect(snapshot).not.toContain(id);
  const measurements = await cli.run('run-code', 'default', `async page => {
    const input = page.locator('#technical');
    const before = await input.evaluate(el => {
      const r = el.getBoundingClientRect(), outer = el.parentElement.getBoundingClientRect();
      return { width: r.width, height: r.height, editorWidth: outer.width, editorHeight: outer.height };
    });
    let clickError;
    try { await input.click({ trial: true, timeout: 300 }); } catch (e) { clickError = e.message; }
    await input.focus();
    return { before, clickError, focused: await input.evaluate(el => el === document.activeElement) };
  }`, '--inline', '--json');
  const result = JSON.parse(JSON.parse(measurements).result);
  expect(result.before).toEqual({ width: 0, height: 0, editorWidth: 578, editorHeight: 300 });
  expect(result.clickError).toContain('not visible');
  expect(result.focused).toBe(true);
  await cli.run('eval', 'default', 'Object.assign(document.querySelector("#technical").style, {width:"200px",height:"40px"})');
  const resized = JSON.parse(await cli.run('snapshot', 'default', '#technical', '--boxes', '--inline', '--json')).snapshot;
  expect(resized).not.toContain('pointer-box=none');
  expect(resized).toMatch(/\[box=\d+,\d+,200,40\]/);
});

test('focus and typing preserve targets, named sessions and chain snapshot behavior', async ({ cli }) => {
  await cli.open(fixture, [], 'editor');
  const output = await cli.run('focus', 'editor', ':technical', '--then', 'type', 'keyboard text', '--inline', '--json');
  expect(JSON.parse(output.slice(output.indexOf('{'))).snapshot).toContain(':technical textarea label="Editor input" value="keyboard text" [pointer-box=none]');
  expect(await cli.run('eval', 'editor', 'document.activeElement.id')).toContain('"technical"');
  expect(await cli.run('eval', 'editor', 'document.querySelector("#ordinary").value')).toContain('""');
  await cli.run('focus', 'editor', '#ordinary', '--then', 'type', 'normal');
  expect(JSON.parse(await cli.run('snapshot', 'editor', ':ordinary', '--inline', '--json')).snapshot).toBe(':ordinary input label="Ordinary input" value=normal');
  await cli.run('fill', 'editor', ':ordinary', 'filled');
  await cli.run('click', 'editor', ':ordinary');
  expect(await cli.run('eval', 'editor', 'document.activeElement.value')).toContain('"filled"');
});

test('failed clicks report observed geometry and never focus or continue typing', async ({ cli }) => {
  const config = path.join(cli.cwd, '.config', 'browser-cli', 'cli.config.json');
  const options = JSON.parse(fs.readFileSync(config, 'utf8'));
  options.timeouts.action = 700;
  fs.writeFileSync(config, JSON.stringify(options));
  await cli.open(fixture);
  await cli.run('focus', 'default', ':ordinary');
  const result = await cli.result('click', 'default', ':technical', '--then', 'type', 'must not run');
  expect(result.exitCode).toBe(1);
  const message = result.output + result.error;
  expect(message).toContain('Click target :technical resolved');
  expect(message).toContain('"width":0,"height":0,"pointerBox":false');
  expect(message).toContain('focus :technical');
  expect(message).not.toContain('stale');
  expect(await cli.run('eval', 'default', 'document.activeElement.id')).toContain('"ordinary"');
  expect(await cli.run('eval', 'default', 'Array.from(document.querySelectorAll("input,textarea"), el => el.value).join("")')).toContain('""');
});

test('focus rejects disabled, inert, hidden and non-focusable targets before a chain can type', async ({ cli }) => {
  await cli.open(fixture);
  for (const target of [':disabled', ':fieldset-disabled', ':inert-input', '#display-hidden', '#visibility-hidden', '#hidden-type', '#editor']) {
    await cli.run('focus', 'default', ':ordinary');
    const result = await cli.result('focus', 'default', target, '--then', 'type', 'must not run');
    expect(result.exitCode, target).toBe(1);
    expect(result.output + result.error, target).toContain('did not receive keyboard focus');
    expect(await cli.run('eval', 'default', 'document.querySelector("#ordinary").value')).toContain('""');
  }
});

test('numeric focus refs keep identity through snapshots and fail explicitly after replacement', async ({ cli }) => {
  await cli.open('<textarea aria-label="Technical" style="width:0;height:0;padding:0;border:0"></textarea>');
  const snapshot = JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot;
  const ref = snapshot.match(/^:\d+/)![0];
  await cli.run('focus', 'default', ref, '--then', 'type', 'first');
  await cli.run('snapshot', 'default', '--inline');
  await cli.run('focus', 'default', ref, '--then', 'type', ' second');
  expect(await cli.run('eval', 'default', 'document.querySelector("textarea").value')).toContain('"first second"');
  await cli.run('eval', 'default', 'document.querySelector("textarea").outerHTML = "<textarea></textarea>"');
  for (const command of ['focus', 'click']) {
    const result = await cli.result(command, 'default', ref);
    expect(result.exitCode).toBe(1);
    expect(result.output + result.error).toContain(`ATML ref ${ref} is stale`);
    expect(result.output + result.error).not.toContain('DOM observations');
  }
});

test('offscreen and temporarily covered fields retain ordinary snapshots and click retries', async ({ cli }) => {
  await cli.open(fixture);
  const fullSnapshot = JSON.parse(await cli.run('snapshot', 'default', '--inline', '--json')).snapshot;
  for (const id of ['ordinary', 'disabled', 'offscreen', 'covered']) {
    const line = fullSnapshot.split('\n').find(line => line.trimStart().startsWith(':' + id + ' '));
    expect(line).toBeDefined();
    expect(line).not.toContain('pointer-box');
  }
  await cli.run('click', 'default', ':offscreen', '--then', 'type', 'scrolled');
  expect(await cli.run('eval', 'default', 'document.querySelector("#offscreen").value')).toContain('"scrolled"');
  await cli.run('run-code', 'default', `async page => {
    await page.locator('#covered').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      setTimeout(() => document.querySelector('#cover')?.remove(), 2000);
    });
  }`);
  await cli.run('click', 'default', ':covered', '--then', 'type', 'uncovered');
  expect(await cli.run('eval', 'default', 'document.querySelector("#covered").value')).toContain('"uncovered"');
});

test('disabled and covered click failures keep pointer boxes distinct from enabled and hit-target checks', async ({ cli }) => {
  const config = path.join(cli.cwd, '.config', 'browser-cli', 'cli.config.json');
  const options = JSON.parse(fs.readFileSync(config, 'utf8'));
  options.timeouts.action = 700;
  fs.writeFileSync(config, JSON.stringify(options));
  await cli.open(fixture);
  for (const target of [':disabled', ':covered']) {
    const result = await cli.result('click', 'default', target);
    expect(result.exitCode).toBe(1);
    const message = result.output + result.error;
    expect(message).toContain(`Click target ${target} resolved`);
    expect(message).toContain('"pointerBox":true');
    expect(message).toContain(`"disabled":${target === ':disabled'}`);
    expect(message).not.toContain('No positive-area');
    expect(message).toContain(target === ':disabled' ? 'not enabled' : 'intercepts pointer events');
  }
});

test('focus routes frame and open shadow-root references to the correct input', async ({ cli }) => {
  await cli.open(`<input id="ordinary"><iframe srcdoc='<textarea id="framed" style="width:0;height:0;padding:0;border:0"></textarea>'></iframe>
    <div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<textarea id="shadowed" style="width:0;height:0;padding:0;border:0"></textarea>'</script>`);
  await cli.run('focus', 'default', ':framed', '--then', 'type', 'frame text');
  await cli.run('focus', 'default', ':shadowed', '--then', 'type', 'shadow text');
  expect(await cli.run('eval', 'default', 'document.querySelector("iframe").contentDocument.querySelector("textarea").value')).toContain('"frame text"');
  expect(await cli.run('eval', 'default', 'document.querySelector("#host").shadowRoot.activeElement.value')).toContain('"shadow text"');
});

test('focus rejects an input whose focus handler redirects keyboard input outside its frame', async ({ cli }) => {
  await cli.open(`<input id="ordinary"><iframe srcdoc='<textarea id="redirected" onfocus="parent.document.querySelector(\`#ordinary\`).focus()"></textarea>'></iframe>`);
  const result = await cli.result('focus', 'default', ':redirected', '--then', 'type', 'must not run');
  expect(result.exitCode).toBe(1);
  expect(result.output + result.error).toContain('did not receive keyboard focus');
  expect(await cli.run('eval', 'default', 'document.querySelector("iframe").contentDocument.querySelector("textarea").value')).toContain('""');
  expect(await cli.run('eval', 'default', 'document.querySelector("#ordinary").value')).toContain('""');
});
