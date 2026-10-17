import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { renderAtml } from '../src/atml/render';
import type { AtmlNode } from '../src/atml/dom';

const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-atml.json'), 'utf8')) as {
  cases: { name: string; origin: string; renderTree: AtmlNode; config: { keep_attrs?: string[] }; expected: string }[];
};

for (const fixture of oracle.cases) {
  test(`Python renderer content parity: ${fixture.name}`, () => {
    // Python's own flatten/class/attribute decisions are recorded in renderTree
    // so this isolates rendering from DOM extraction and requires no engine build.
    const keepAttrs = new WeakMap<AtmlNode, string[]>();
    const visit = (node: AtmlNode) => {
      keepAttrs.set(node, fixture.config.keep_attrs || []);
      node.children?.forEach(visit);
    };
    visit(fixture.renderTree);
    // The CLI adds text markers, changes indentation and omits historical blank separators.
    // Keep the oracle for content; render.spec.ts checks exact layout.
    const content = (value: string) => value.split('\n').filter(line => line.trim()).map(line => line.replace(/^ +/, '')).join('\n');
    const snapshot = renderAtml(fixture.renderTree, new WeakMap(), undefined, { keepAttrs });
    expect(snapshot.split('\n').every(line => line.trim().length > 0), fixture.origin).toBe(true);
    const historical = snapshot.replace(/^(?! *: )(.*)\bid=("[^"]*"|\S+)/gm, '$1#$2').replace(/^( *): /gm, '$1');
    expect(content(historical), fixture.origin).toBe(content(fixture.expected));
  });
}
