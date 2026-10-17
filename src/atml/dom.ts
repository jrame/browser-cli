// Runs inside Playwright's isolated utility world. Do not import Node modules here.
export type DomOptions = {
  keep_attrs: string[]; keep_tags: string[]; remove_selectors: string[]; class_regex?: string;
  testIdAttribute: string; boxes?: boolean;
};
export type AtmlNode = {
  tag?: string; text?: string; attrs?: Record<string, string>; classes?: string[];
  kept?: boolean; actionable?: boolean; nativeRef?: string; documentId?: string; key?: number;
  children?: AtmlNode[]; box?: number[]; block?: boolean; tooltip?: boolean; showTag?: boolean;
};
export type NativeRegistration = { ref: string; documentId: string; key: number };

export function extractAtmlDom(root: Element, options: DomOptions, register: (element: Element) => NativeRegistration): AtmlNode {
  root.dispatchEvent(new Event('__browser_atml_refresh__', { bubbles: true, composed: true }));
  const alwaysKeep = new Set('button a input select textarea form img label table tr td th thead tbody video audio iframe frame dialog details summary option optgroup header footer'.split(' '));
  const stateClasses = new Set('active disabled hidden open closed selected checked error warning success focused collapsed expanded current loading highlighted'.split(' '));
  const componentClasses = new Set('nav menu sidebar header footer breadcrumb submit close toggle form input field img'.split(' '));
  const omitted = new Set('meta link style script noscript svg path g circle rect'.split(' '));
  // Filter the original names before shortening aria-* (as the historical
  // HTML extractor did), so bare label/expanded/etc. are not implicitly kept.
  const allowedAttrs = new Set('id name alt role type value data-testid placeholder for disabled checked onclick aria-label aria-labelledby aria-describedby aria-expanded aria-controls aria-haspopup aria-selected aria-current aria-orientation class'.split(' '));
  const usefulRoles = new Set('button link navigation nav dialog alert tab tabpanel tablist menu menuitem menubar checkbox radio switch slider spinbutton textbox combobox searchbox option progressbar tree treeitem grid row cell columnheader rowheader toolbar tooltip banner main complementary contentinfo form search region status log marquee timer alertdialog figure img heading separator'.split(' '));
  const redundantRoles: Record<string, string> = {
    button: 'button', a: 'link', nav: 'navigation', input: 'textbox', select: 'combobox', option: 'option',
    textarea: 'textbox', table: 'grid', tr: 'row', td: 'cell', th: 'columnheader', form: 'form',
    main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary', dialog: 'dialog',
    img: 'img', figure: 'figure', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
    h5: 'heading', h6: 'heading', hr: 'separator', progress: 'progressbar',
  };
  const interactiveListeners = new Set('click dblclick mousedown mouseup pointerdown pointerup touchstart touchend keydown keyup keypress input change submit focus blur'.split(' '));
  const interactiveRoles = new Set('button link tab menuitem menuitemcheckbox menuitemradio checkbox radio switch slider spinbutton textbox combobox searchbox option treeitem'.split(' '));
  for (const attr of options.keep_attrs) allowedAttrs.add(attr);
  allowedAttrs.add(options.testIdAttribute);
  const classPattern = options.class_regex ? new RegExp(options.class_regex) : undefined;
  // Validate once so a typo never silently hides a site-specific rule.
  for (const selector of options.remove_selectors) root.ownerDocument.querySelector(selector);
  // Python str.split() includes Unicode whitespace and preserves duplicate
  // classes, unlike DOMTokenList. FEFF is not whitespace in Python.
  const relevantClasses = (element: Element, tag: string): string[] => (element.getAttribute('class') || '')
    .split(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u).filter(Boolean).filter(value => {
    if (classPattern?.test(value)) return true;
    const parts = value.toLowerCase().split(/[-_]/);
    return parts.some(part => stateClasses.has(part) || (!['button', 'a'].includes(tag) && componentClasses.has(part)));
  });
  const visit = (node: Node): AtmlNode | undefined => {
    if (node.nodeType === Node.TEXT_NODE) {
      // These are the actual characters removed by the Python-embedded JS.
      // Keep NBSP intact until the renderer's final normalization step.
      const text = (node.nodeValue || '').replace(/[\u202a\u202c]/g, '');
      return text ? { text } : undefined;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (omitted.has(tag) || options.remove_selectors.some(selector => element.matches(selector))) return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const inlineStyle = element.getAttribute('style') || '';
    if (inlineStyle.includes('display: none') || inlineStyle.includes('display:none') ||
        inlineStyle.includes('visibility: hidden') || inlineStyle.includes('visibility:hidden')) return;
    const attrs: Record<string, string> = {};
    let tooltip = false;
    for (const attr of Array.from(element.attributes)) {
      // Python ATML represents tooltip presence, including empty attributes.
      if (attr.name === 'title' || attr.name.startsWith('data-tooltip')) {
        tooltip = true;
        continue;
      }
      if (attr.name === 'data-has-listener' || attr.name === 'data-browser-atml-listeners') continue;
      if (allowedAttrs.has(attr.name)) attrs[attr.name] = attr.name === 'onclick' ? '' : attr.value;
    }
    // Shortening happens after all raw attributes have been collected: an
    // aria-label overrides a configured bare label regardless of DOM order.
    for (const name of Object.keys(attrs)) {
      if (!name.startsWith('aria-')) continue;
      attrs[name.slice(5)] = attrs[name];
      delete attrs[name];
    }
    if ('role' in attrs && (!usefulRoles.has(attrs.role) || redundantRoles[tag] === attrs.role)) delete attrs.role;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      attrs.value = element instanceof HTMLInputElement && element.type === 'password'
        ? (element.value ? '****' : '') : element.value;
      if ('checked' in element) {
        if (element.checked) attrs.checked = 'true';
        else delete attrs.checked;
      }
    }
    if (element instanceof HTMLOptionElement) {
      if (element.selected) attrs.selected = 'true';
      else delete attrs.selected;
    }
    const classes = relevantClasses(element, tag);
    const listeners = [element.getAttribute('data-has-listener'), element.getAttribute('data-browser-atml-listeners')]
      .filter(Boolean).join(',').split(',').filter(value => interactiveListeners.has(value));
    for (const event of interactiveListeners) {
      if (event !== 'click' && element.hasAttribute(`on${event}`)) listeners.push(event);
    }
    // Keep onclick distinct from addEventListener metadata, including on
    // semantic tags; only the renderer suppresses redundant event markers.
    if (listeners.length) attrs.on = [...new Set(listeners)].join(',');
    // Native controls and semantic targets also work with delegated listeners.
    // Do not treat every descendant of a listener as interactive: frameworks
    // commonly delegate at the document or application root.
    const actionable = element.matches('button,input:not([type="hidden"]),select,textarea,summary,option,a[href],area[href],label[for],audio[controls],video[controls]') ||
      interactiveRoles.has(element.getAttribute('role') || '') || 'onclick' in attrs || !!attrs.on ||
      (element instanceof HTMLElement && (element.isContentEditable ||
        (element.hasAttribute('tabindex') && element.tabIndex >= 0)));
    const kept = alwaysKeep.has(tag) || options.keep_tags.includes(tag) || 'id' in attrs || 'role' in attrs ||
      options.testIdAttribute in attrs || 'onclick' in attrs || !!attrs.on || tooltip || !!classes.length ||
      actionable || options.keep_attrs.some(attr => attr in attrs);
    // The outer display controls text boundaries; inline-block/flex/grid do not
    // introduce spaces, while BR remains a line break even with inline display.
    const block = tag === 'br' || !/^(inline($|[- ])|contents$)/.test(style.display);
    const showTag = alwaysKeep.has(tag) || options.keep_tags.includes(tag);
    const result: AtmlNode = { tag, attrs, classes, kept, actionable, tooltip, block, showTag, children: [] };
    if (kept) {
      const identity = register(element);
      result.nativeRef = identity.ref;
      result.documentId = identity.documentId;
      result.key = identity.key;
      if (options.boxes) {
        const rect = element.getBoundingClientRect();
        result.box = [rect.x, rect.y, rect.width, rect.height].map(Math.round);
      }
    }
    const assigned = element.tagName === 'SLOT' ? (element as HTMLSlotElement).assignedNodes({ flatten: true }) : [];
    const children = assigned.length ? assigned : element.shadowRoot ? Array.from(element.shadowRoot.childNodes) : Array.from(element.childNodes);
    for (const child of children) {
      const extracted = visit(child);
      if (extracted) result.children!.push(extracted);
    }
    // Match JS trim(), including NBSP, only on whitespace-only boundary nodes.
    // Interior whitespace and whitespace around actual text remain untouched.
    while (result.children!.length && result.children![0].text !== undefined && !result.children![0].text!.trim()) result.children!.shift();
    while (result.children!.length && result.children![result.children!.length - 1].text !== undefined && !result.children![result.children!.length - 1].text!.trim()) result.children!.pop();
    return result;
  };
  return visit(root) || { children: [] };
}
