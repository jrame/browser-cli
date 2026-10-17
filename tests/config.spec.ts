import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loadAtmlConfig, navigationUrlAllowed, normalizeMatchUrl, parseAtmlConfig, resolveAtmlConfig, urlMatches } from '../src/atml/config';

test('navigation allowlist is optional, canonicalizes URLs and defaults to deny when configured', () => {
  expect(navigationUrlAllowed('https://anywhere.test/', parseAtmlConfig('').allowed_urls)).toBe(true);
  const { allowed_urls } = parseAtmlConfig(`[navigation]\nallowed_urls = ["HTTPS://EXAMPLE.COM:443/app/**", "https://other.test/one/*"]`);
  expect(allowed_urls).toEqual(['https://example.com/app/**', 'https://other.test/one/*']);
  for (const url of ['https://example.com/app/one/two?q=1#top', 'https://other.test/one/two'])
    expect(navigationUrlAllowed(url, allowed_urls), url).toBe(true);
  for (const url of ['http://example.com/app/one', 'https://example.com/app/../private', 'https://example.com.evil.test/app/one', 'https://example.com@evil.test/app/one', 'https://example.com:444/app/one', 'https://other.test/one/two/three', 'file:///tmp/page.html', 'data:text/html,hello', 'javascript:alert(1)', 'invalid'])
    expect(navigationUrlAllowed(url, allowed_urls), url).toBe(false);
  expect(navigationUrlAllowed('https://example.com/', [])).toBe(false);
  expect(navigationUrlAllowed('about:blank', [])).toBe(true);
  expect(parseAtmlConfig('[navigation]\nallowed_urls = []').allowed_urls).toEqual([]);
});

test('navigation allowlist rejects malformed and ambiguous configuration', () => {
  expect(() => parseAtmlConfig('[navigation]\nallow_urls = []')).toThrow(/Unknown navigation setting/);
  for (const source of ['navigation = false', '[navigation]\nallowed_urls = "https://example.com"', '[navigation]\nallowed_urls = [42]', '[navigation]\nallowed_urls = [""]', '[navigation]\nallowed_urls = ["example.com"]', '[navigation]\nallowed_urls = ["file:///tmp/page"]', '[navigation]\nallowed_urls = ["https://*.example.com/**"]', '[navigation]\nallowed_urls = ["https://user:pass@example.com/**"]', '[navigation]\nallowed_urls = ["https://example.com/?query=1"]'])
    expect(() => parseAtmlConfig(source), source).toThrow(/navigation/);
});

test('URL matching preserves segment boundaries and ignores query and fragment', () => {
  expect(normalizeMatchUrl('HTTPS://EXAMPLE.COM?x=1#test')).toBe('https://example.com/');
  expect(urlMatches('https://example.com/app/*', 'https://example.com/app/one?x=2#test')).toBe(true);
  expect(urlMatches('https://example.com/app/*', 'https://example.com/app/one/two')).toBe(false);
  expect(urlMatches('https://example.com/app/**', 'https://example.com/app/one/two')).toBe(true);
  expect(urlMatches('https://example.com/app/**', 'https://another.example.com/app/one')).toBe(false);
});

test('rules merge lists, remove duplicates and override scalars by specificity', () => {
  const config = parseAtmlConfig(`
[atml]
keep_attrs = ["data-global"]
remove_selectors = [".cookie-banner"]
class_regex = "global"
[atml.rules.site]
url = "https://example.com/**"
keep_attrs = ["data-site", "data-global"]
class_regex = "site"
[atml.rules.issues]
url = "https://example.com/*/*/issues/**"
keep_attrs = ["data-issue-id"]
remove_selectors = [".sidebar"]
class_regex = "issue"
`);
  expect(resolveAtmlConfig('https://example.com/a/b/issues/1?state=open#top', config)).toEqual({
    keep_attrs: ['data-global', 'data-site', 'data-issue-id'], keep_tags: [], remove_selectors: ['.cookie-banner', '.sidebar'], class_regex: 'issue',
  });
  expect(resolveAtmlConfig('https://elsewhere.test/', config).keep_attrs).toEqual(['data-global']);
});

test('equal specificity requires distinct priorities', () => {
  const config = parseAtmlConfig(`
[atml.rules.first]
url = "https://example.com/*/x"
class_regex = "first"
[atml.rules.second]
url = "https://example.com/a/*"
class_regex = "second"
`);
  expect(() => resolveAtmlConfig('https://example.com/a/x', config)).toThrow(/equal specificity.*priority/);
  config.rules[1].priority = 1;
  expect(resolveAtmlConfig('https://example.com/a/x', config).class_regex).toBe('second');
});

test('configuration discovery prefers browser-cli TOML and supports explicit paths', ({}, info) => {
  const cwd = info.outputPath();
  const directory = path.join(cwd, '.config', 'browser-cli');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'config.toml'), '[atml]\nkeep_tags = ["article"]');
  expect(loadAtmlConfig(cwd).keep_tags).toEqual(['article']);
  fs.writeFileSync(path.join(cwd, 'other.toml'), '[atml]\nkeep_attrs = ["data-other"]');
  expect(loadAtmlConfig(cwd, 'other.toml').keep_attrs).toEqual(['data-other']);
  expect(() => loadAtmlConfig(cwd, 'missing.toml')).toThrow(/not found/);
});

test('invalid TOML, regexes and rule types produce useful errors', () => {
  expect(() => parseAtmlConfig('[atml]\nkeep_attrs = "no"')).toThrow(/array of strings/);
  expect(() => parseAtmlConfig('[atml]\nclass_regex = "["')).toThrow();
  expect(() => parseAtmlConfig('[atml.rules.bad]\npriority = 1')).toThrow(/requires a URL/);
  expect(() => parseAtmlConfig('[atml.rules.bad]\nurl = "**"\npriority = 1.5')).toThrow(/integer/);
});
