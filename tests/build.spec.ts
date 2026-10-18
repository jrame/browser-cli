import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { test, expect } from '@playwright/test';

test('engine patches retain LF endings with Windows Git checkout settings', ({}, info) => {
  const root = path.resolve(__dirname, '..');
  const cwd = info.outputPath();
  const patch = 'patches/playwright/0001-browser-atml.patch';
  const original = fs.readFileSync(path.join(root, patch), 'utf8').replace(/\r\n/g, '\n');
  fs.mkdirSync(path.join(cwd, path.dirname(patch)), { recursive: true });
  fs.writeFileSync(path.join(cwd, patch), original);
  const attributes = path.join(root, '.gitattributes');
  if (fs.existsSync(attributes))
    fs.copyFileSync(attributes, path.join(cwd, '.gitattributes'));

  function git(args: string[]) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
  }

  git(['init', '--quiet']);
  git(['-c', 'core.autocrlf=false', 'add', '.']);
  fs.unlinkSync(path.join(cwd, patch));
  git(['-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', 'checkout-index', '--', patch]);
  expect(fs.readFileSync(path.join(cwd, patch), 'utf8')).toBe(original);
});
