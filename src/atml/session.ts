import { loadAtmlConfig, resolveAtmlConfig } from './config';
import type { AtmlNode, DomOptions } from './dom';
import { renderAtml } from './render';
import type * as playwright from '../../../..';

type Target = { frame: playwright.Frame; documentId: string; nativeRef: string; alias: string };
type Bridge = {
  documentId: string;
  extract(root: Element, options: DomOptions): AtmlNode;
};
const safeName = (value: string) => !!value && !/[\s"'`\\\[\]<>]/u.test(value);
// Purely numeric names belong exclusively to DOM-identity aliases.
const safeAlias = (value: string) => safeName(value) && !/^\d+$/.test(value);

export class AtmlSession {
  private _nextAlias = 0;
  private _nextFrame = 0;
  private _frameIds = new WeakMap<playwright.Frame, number>();
  private _identities = new Map<string, Target>();
  private _numbers = new Map<string, Target>();
  private _named = new Map<string, Target>();
  private _ambiguous = new Set<string>();

  constructor(private _page: playwright.Page, private _testIdAttribute: string) {}

  async resolve(target: string): Promise<playwright.Locator | undefined> {
    if (this._ambiguous.has(target)) throw new Error(`Ambiguous ATML target ${target}; use its numeric : reference.`);
    const entry = this._numbers.get(target) || this._named.get(target);
    if (!entry) {
      if (target.startsWith(':')) throw new Error(`Unknown ATML ref ${target}. Try capturing a new snapshot.`);
      return;
    }
    let documentId: string | undefined;
    if (!entry.frame.isDetached()) {
      documentId = await entry.frame.evaluate(() => (globalThis as any)[Symbol.for('browser.atml')]?.documentId, undefined, { world: 'utility' }).catch(() => undefined);
    }
    const locator = entry.frame.locator(`aria-ref=${entry.nativeRef}`);
    if (documentId !== entry.documentId || await locator.count() !== 1)
      throw new Error(`ATML ref ${target} is stale. Try capturing a new snapshot.`);
    return locator;
  }

  async capture(cwd: string, root?: playwright.Locator, depth?: number, boxes?: boolean, configPath?: string): Promise<string> {
    if (depth !== undefined && (!Number.isInteger(depth) || depth < 1)) throw new Error('Snapshot depth must be a positive integer.');
    const config = loadAtmlConfig(cwd, configPath);
    // The native snapshot initializes frame routing and the aria-ref registry.
    await this._page.ariaSnapshot({ mode: 'ai' });
    const owners = new WeakMap<AtmlNode, playwright.Frame>();
    const keepTags = new WeakMap<AtmlNode, readonly string[]>();
    const keepAttrs = new WeakMap<AtmlNode, readonly string[]>();
    const extract = async (frame: playwright.Frame, locator?: playwright.Locator): Promise<AtmlNode> => {
      const options: DomOptions = { ...resolveAtmlConfig(frame.url(), config), testIdAttribute: this._testIdAttribute, boxes };
      const read = (element: Element, opts: DomOptions): AtmlNode => {
        const bridge = (globalThis as any)[Symbol.for('browser.atml')] as Bridge | undefined;
        if (!bridge) throw new Error('ATML engine is unavailable; run npm run build.');
        return bridge.extract(element, opts);
      };
      const tree = locator
        ? await locator.evaluate(read, options, { world: 'utility' })
        : await frame.evaluate(opts => {
          const bridge = (globalThis as any)[Symbol.for('browser.atml')] as Bridge | undefined;
          if (!bridge) throw new Error('ATML engine is unavailable; run npm run build.');
          return bridge.extract(document.body || document.documentElement, opts);
        }, options, { world: 'utility' });
      const attach = async (node: AtmlNode): Promise<void> => {
        owners.set(node, frame);
        keepTags.set(node, options.keep_tags);
        keepAttrs.set(node, options.keep_attrs);
        if (['iframe', 'frame'].includes(node.tag || '') && node.nativeRef) {
          const handle = await frame.locator(`aria-ref=${node.nativeRef}`).elementHandle();
          try {
            const child = await handle?.contentFrame();
            if (child && !child.isDetached()) {
              // Also initialize documents omitted by the accessibility tree.
              await child.locator('body,frameset').first().ariaSnapshot({ mode: 'ai' });
              const subtree = await extract(child);
              node.children = subtree.kept ? [subtree] : subtree.children || [];
            }
          } finally {
            await handle?.dispose();
          }
        } else {
          for (const child of node.children || []) await attach(child);
        }
      };
      await attach(tree);
      return tree;
    };
    let rootFrame = this._page.mainFrame();
    if (root) {
      const handle = await root.elementHandle();
      try { rootFrame = await handle!.ownerFrame() || rootFrame; }
      finally { await handle?.dispose(); }
    }
    const tree = await extract(rootFrame, root);
    const nodes: AtmlNode[] = [];
    const collect = (node: AtmlNode) => {
      if (node.kept) nodes.push(node);
      for (const child of node.children || []) collect(child);
    };
    collect(tree);
    const count = (attr: string) => {
      const result = new Map<string, number>();
      for (const node of nodes) {
        const value = node.attrs?.[attr];
        if (value) result.set(value, (result.get(value) || 0) + 1);
      }
      return result;
    };
    const ids = count('id');
    this._named.clear();
    this._ambiguous.clear();
    for (const [value, total] of ids) {
      if (total > 1) {
        this._ambiguous.add(`#${value}`);
        if (safeAlias(value)) this._ambiguous.add(`:${value}`);
      }
    }
    const refs = new WeakMap<AtmlNode, string>();
    for (const node of nodes) {
      const frame = owners.get(node)!;
      let frameId = this._frameIds.get(frame);
      if (!frameId) this._frameIds.set(frame, frameId = ++this._nextFrame);
      const key = `${frameId}:${node.documentId}:${node.key}`;
      let entry = this._identities.get(key);
      if (!entry) {
        entry = { frame, documentId: node.documentId!, nativeRef: node.nativeRef!, alias: `:${++this._nextAlias}` };
        this._identities.set(key, entry);
        this._numbers.set(entry.alias, entry);
      }
      entry.nativeRef = node.nativeRef!;
      const id = node.attrs?.id;
      // Preserve exact-ID lookup for existing #id commands, including IDs that
      // would need escaping as CSS selectors. Only actionable nodes show :refs.
      if (id && safeName(id) && ids.get(id) === 1) this._named.set(`#${id}`, entry);
      if (node.actionable) {
        const ref = id && safeAlias(id) && ids.get(id) === 1 ? `:${id}` : entry.alias;
        refs.set(node, ref);
        if (ref !== entry.alias) this._named.set(ref, entry);
      }
    }
    return renderAtml(tree, refs, depth, { testIdAttribute: this._testIdAttribute, keepTags, keepAttrs });
  }
}
