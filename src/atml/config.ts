import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'smol-toml';

export type AtmlOptions = {
  keep_attrs: string[];
  keep_tags: string[];
  remove_selectors: string[];
  class_regex?: string;
};
export type AtmlRule = Partial<AtmlOptions> & { name: string; url: string; priority?: number };
export type AtmlConfig = AtmlOptions & { rules: AtmlRule[]; allowed_urls?: string[] };
const lists = ['keep_attrs', 'keep_tags', 'remove_selectors'] as const;

export function normalizeMatchUrl(value: string): string {
  const withoutSuffix = value.trim().split(/[?#]/, 1)[0];
  const match = withoutSuffix.match(/^([a-z][a-z\d+.-]*):\/\/([^/]+)(.*)$/i);
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3] || '/'}` : withoutSuffix;
}

export function urlMatches(pattern: string, url: string): boolean {
  const glob = normalizeMatchUrl(pattern);
  let expression = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*') {
      const recursive = glob[i + 1] === '*';
      expression += recursive ? '.*' : '[^/]*';
      if (recursive) i++;
    } else {
      expression += glob[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`).test(normalizeMatchUrl(url));
}

function specificity(rule: AtmlRule): number[] {
  const glob = normalizeMatchUrl(rule.url);
  return [glob.replace(/\*/g, '').length, -(glob.match(/\*\*|\*/g)?.length || 0), rule.priority || 0];
}

export function resolveAtmlConfig(url: string, config: AtmlConfig): AtmlOptions {
  const result: AtmlOptions = { keep_attrs: [...config.keep_attrs], keep_tags: [...config.keep_tags], remove_selectors: [...config.remove_selectors], class_regex: config.class_regex };
  const matching = config.rules.filter(rule => urlMatches(rule.url, url)).sort((a, b) => {
    const aa = specificity(a), bb = specificity(b);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
  });
  for (let i = 0; i < matching.length; i++) {
    const rule = matching[i];
    if (i && specificity(rule).every((value, j) => value === specificity(matching[i - 1])[j]))
      throw new Error(`ATML rules ${JSON.stringify(matching[i - 1].name)} and ${JSON.stringify(rule.name)} have equal specificity for ${normalizeMatchUrl(url)}; set distinct priority values.`);
    for (const key of lists)
      result[key] = [...new Set([...result[key], ...(rule[key] || [])])];
    if (rule.class_regex !== undefined) result.class_regex = rule.class_regex;
  }
  return result;
}

export function parseAtmlConfig(source: string): AtmlConfig {
  const document = parse(source);
  const raw = (document.atml || {}) as Record<string, any>;
  const navigation = document.navigation as Record<string, any> | undefined;
  let allowed_urls: string[] | undefined;
  if (navigation !== undefined) {
    if (!navigation || typeof navigation !== 'object' || Array.isArray(navigation))
      throw new Error('navigation must be a table');
    for (const key of Object.keys(navigation)) {
      if (key !== 'allowed_urls') throw new Error(`Unknown navigation setting: ${key}; expected allowed_urls`);
    }
    if (navigation.allowed_urls !== undefined) {
      if (!Array.isArray(navigation.allowed_urls) || navigation.allowed_urls.some((entry: unknown) => typeof entry !== 'string' || !entry.trim()))
        throw new Error('navigation.allowed_urls must be an array of nonempty URL strings');
      allowed_urls = navigation.allowed_urls.map((entry: string) => {
        let url: URL;
        try { url = new URL(entry.trim()); }
        catch { throw new Error(`Invalid navigation.allowed_urls URL: ${entry}`); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.host.includes('*') || url.search || url.hash)
          throw new Error(`navigation.allowed_urls requires HTTP(S) URLs with an exact host and optional path wildcards: ${entry}`);
        return url.origin + url.pathname;
      });
    }
  }
  const options = (value: Record<string, any>, label: string): Partial<AtmlOptions> => {
    const result: Partial<AtmlOptions> = {};
    for (const key of lists) {
      if (value[key] === undefined) continue;
      if (!Array.isArray(value[key]) || value[key].some((entry: unknown) => typeof entry !== 'string'))
        throw new Error(`${label}.${key} must be an array of strings`);
      result[key] = value[key];
    }
    if (value.class_regex !== undefined) {
      if (typeof value.class_regex !== 'string') throw new Error(`${label}.class_regex must be a string`);
      new RegExp(value.class_regex);
      result.class_regex = value.class_regex;
    }
    return result;
  };
  const rules: AtmlRule[] = [];
  for (const [name, value] of Object.entries(raw.rules || {}) as [string, any][]) {
    if (!value || typeof value.url !== 'string' || !value.url.trim()) throw new Error(`ATML rule ${name} requires a URL`);
    if (value.priority !== undefined && !Number.isInteger(value.priority)) throw new Error(`ATML rule ${name} priority must be an integer`);
    rules.push({ name, url: value.url.trim(), priority: value.priority || 0, ...options(value, `atml.rules.${name}`) });
  }
  return { keep_attrs: [], keep_tags: [], remove_selectors: [], ...options(raw, 'atml'), rules, ...(allowed_urls === undefined ? {} : { allowed_urls }) };
}

export function navigationUrlAllowed(url: string, patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined || url === 'about:blank') return true;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return patterns.some(pattern => urlMatches(pattern, parsed.origin + parsed.pathname));
  } catch {
    return false;
  }
}

export function loadAtmlConfig(cwd: string, explicitPath?: string): AtmlConfig {
  const requested = explicitPath || process.env.BROWSER_ATML_CONFIG;
  const candidates = requested ? [path.resolve(cwd, requested)] : [
    path.join(cwd, '.config', 'browser-cli', 'config.toml'),
    path.join(os.homedir(), '.config', 'browser-cli', 'config.toml'),
  ];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file && requested) throw new Error(`ATML configuration not found: ${candidates[0]}`);
  return parseAtmlConfig(file ? fs.readFileSync(file, 'utf8') : '');
}
