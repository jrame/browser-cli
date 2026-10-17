import type { AtmlNode } from './dom';

const alwaysKeep = new Set('button a input select textarea form img label table tr td th thead tbody video audio iframe frame dialog details summary option optgroup header footer'.split(' '));
// This is deliberately the Python renderer's tag list, independent of CSS display.
const inlineTags = new Set('span b i strong em code a abbr mark small var bdo cite dfn kbd q samp sub sup time tt'.split(' '));
const roleSuppressedTags = new Set('button a input select textarea'.split(' '));
const redundantRoles: Record<string, string> = { button: 'button', a: 'link', nav: 'navigation', input: 'textbox', select: 'combobox', textarea: 'textbox', form: 'form', img: 'img', dialog: 'dialog', table: 'grid', tr: 'row', td: 'cell', th: 'columnheader', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary' };
const interactiveListeners = new Set('click dblclick mousedown mouseup pointerdown pointerup touchstart touchend keydown keyup keypress input change submit focus blur'.split(' '));
const renderedAttrs = new Set('id role label type name placeholder for disabled data-testid alt checked expanded selected controls haspopup current orientation describedby labelledby value'.split(' '));

export type AtmlRenderOptions = {
  testIdAttribute?: string;
  // URL-specific rules can differ for nodes extracted from child frames.
  keepTags?: WeakMap<AtmlNode, readonly string[]>;
  keepAttrs?: WeakMap<AtmlNode, readonly string[]>;
};

const normalizeText = (text: string, trimStartOnly = false): string => {
  let normalized = text.replace(/[ \t\n\r\f\v]+/gu, ' ').replace(/^[ \t\n\r\f\v]+/u, '');
  if (!trimStartOnly) normalized = normalized.replace(/[ \t\n\r\f\v]+$/u, '');
  return normalized.replace(/\u00a0/gu, ' ');
};
// Match Python str.strip(), including NEL and the ASCII information separators.
const hasText = (text: string): boolean => /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(text);

/** Render ATML with CLI action references and limits. */
export function renderAtml(tree: AtmlNode, refs: WeakMap<AtmlNode, string>, depth?: number, options: AtmlRenderOptions = {}): string {
  const lines: string[] = [];
  const testIdAttribute = options.testIdAttribute || 'data-testid';
  const renderChildren = (children: AtmlNode[], indent: number, keptParent = false): void => {
    if (depth !== undefined && indent > depth) return;
    const prefix = '  '.repeat(indent - 1);
    let accumulatedText = '';
    const flush = (beforeKeptNode = false) => {
      const normalized = keptParent
        ? accumulatedText.replace(/[ \t\n\r\f\v]+/gu, ' ').replace(/\u00a0/gu, ' ')
        : normalizeText(accumulatedText, beforeKeptNode);
      if (hasText(normalized)) lines.push(prefix + ': ' + normalized);
      accumulatedText = '';
    };
    const visit = (child: AtmlNode, insideInline = false): void => {
      if (child.text !== undefined) {
        if (keptParent || insideInline || hasText(child.text)) accumulatedText += child.text;
      } else if (!child.kept && inlineTags.has(child.tag || '')) {
        // Flatten inline wrappers in place, retaining boundaries and references
        // belonging to any kept descendants instead of extracting only text.
        for (const nested of child.children || []) visit(nested, true);
      } else {
        flush(!!child.kept);
        render(child, indent);
      }
    };
    for (const child of children) visit(child);
    flush();
  };
  const render = (node: AtmlNode, indent: number): void => {
    if (depth !== undefined && indent > depth) return;
    // Depth remains one-based; displayed indentation starts at column zero.
    const prefix = '  '.repeat(indent - 1);
    if (node.text !== undefined) {
      if (hasText(node.text)) lines.push(prefix + ': ' + node.text.replace(/[ \t\n\r\f\v]+/gu, ' ').replace(/\u00a0/gu, ' '));
      return;
    }
    const children = node.children || [];
    if (!node.kept) {
      renderChildren(children, indent);
      return;
    }

    const tag = node.tag || '';
    const attrs = node.attrs || {};
    const ref = refs.get(node);
    const parts: string[] = [];
    if (ref) parts.push(ref);
    if (node.showTag ?? (alwaysKeep.has(tag) || options.keepTags?.get(node)?.includes(tag))) parts.push(tag);
    if (!ref && 'id' in attrs) parts.push(`id=${attrs.id.includes(' ') ? `"${attrs.id}"` : attrs.id}`);
    if (!('id' in attrs)) parts.push(...(node.classes || []).map(value => `.${value}`));
    if (node.tooltip) parts.push('tooltip');
    if (!roleSuppressedTags.has(tag) && attrs.role !== 'button') {
      if ('onclick' in attrs) parts.push('onclick');
      for (const event of (attrs.on || '').split(',')) {
        if (interactiveListeners.has(event)) parts.push(`on:${event}`);
      }
    }
    for (const attr of Object.keys(attrs).sort()) {
      const value = attrs[attr];
      if (attr === 'class' || attr === 'onclick' || attr === 'on') continue;
      if (attr === 'alt' && !value.trim()) continue;
      // Extraction and rendering have separate whitelists in Python. Keep the
      // configured names verbatim: e.g. aria-custom does not authorize custom.
      if (!renderedAttrs.has(attr) && attr !== testIdAttribute && !options.keepAttrs?.get(node)?.includes(attr)) continue;
      if (attr === 'id' && (!ref || (ref === `:${value}` && !/^\d+$/.test(value)))) continue;
      if (attr === 'role' && (roleSuppressedTags.has(tag) || redundantRoles[tag] === value)) continue;
      // Python quotes only values containing a literal space, without JSON escaping.
      parts.push(value === '' || value === 'true' ? attr : `${attr}=${value.includes(' ') ? `"${value}"` : value}`);
    }
    if (node.box) parts.push(`[box=${node.box.join(',')}]`);
    // Focusable/editable generic nodes may have no other visible attributes.
    if (!parts.length) parts.push(tag);
    lines.push(prefix + parts.join(' '));
    renderChildren(children, indent + 1, true);
  };
  // The Python generator omits body even when its attributes would keep it.
  if (tree.tag === 'body') {
    for (const child of tree.children || []) render(child, 1);
  } else {
    render(tree, 1);
  }
  return lines.join('\n') || '(empty page)';
}
