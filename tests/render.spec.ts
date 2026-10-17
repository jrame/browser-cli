import { test, expect } from '@playwright/test';
import { renderAtml } from '../src/atml/render';
import type { AtmlNode } from '../src/atml/dom';

const text = (value: string): AtmlNode => ({ text: value });
const element = (tag: string, id: string, children: AtmlNode[] = []): AtmlNode => ({
  tag, attrs: { id }, kept: true, children,
});
const flatten = (children: AtmlNode[]): AtmlNode => ({ tag: 'div', kept: false, children });
const render = (tree: AtmlNode, depth?: number) => {
  const refs = new WeakMap<AtmlNode, string>();
  const visit = (node: AtmlNode) => {
    if (['button', 'input'].includes(node.tag || '') && node.attrs?.id) refs.set(node, ':' + node.attrs.id);
    node.children?.forEach(visit);
  };
  visit(tree);
  return renderAtml(tree, refs, depth);
};

test('merges inline elements and adjacent text nodes under a kept counter', () => {
  const strong: AtmlNode = { tag: 'strong', children: [text('2')] };
  const counter: AtmlNode = {
    tag: 'span', kept: true, attrs: { 'data-testid': 'todo-count' },
    children: [strong, text(' item'), text('s'), text(' left')],
  };
  const refs = new WeakMap([[counter, ':1']]);
  expect(renderAtml(counter, refs)).toBe(':1 data-testid=todo-count\n  : 2 items left');
  strong.children = [text('1')];
  counter.children = [strong, text(' item left')];
  expect(renderAtml(counter, refs)).toBe(':1 data-testid=todo-count\n  : 1 item left');
  expect(renderAtml(counter, refs, 1)).toBe(':1 data-testid=todo-count');
  expect(renderAtml(counter, refs, 2)).toBe(':1 data-testid=todo-count\n  : 1 item left');

  strong.kept = true;
  strong.showTag = true;
  expect(renderAtml(counter, refs)).toBe(':1 data-testid=todo-count\n  strong\n    : 1\n  :  item left');
});

test('keeps nested references and block boundaries inside flattened inline wrappers', () => {
  const children: AtmlNode[] = [{ tag: 'span', children: [
    text('Avant '), element('button', 'action', [text('Go')]), text(' après'),
    flatten([text('Bloc')]), text('Fin'),
  ] }];
  expect(render(element('div', 'content', children))).toBe('id=content\n  : Avant \n  :action button\n    : Go\n  :  après\n  : Bloc\n  : Fin');
  expect(render(flatten(children))).toBe(': Avant \n:action button\n  : Go\n: après\n: Bloc\n: Fin');
});

test('starts root elements at column zero and indents text alongside child elements', () => {
  const form = element('form', 'login', [
    text('Connexion'),
    element('input', 'email'),
    element('button', 'submit', [text('Envoyer')]),
  ]);
  const tree: AtmlNode = { tag: 'body', children: [form, element('button', 'cancel', [text('Annuler')])] };
  expect(render(tree)).toBe('form id=login\n  : Connexion\n  :email input\n  :submit button\n    : Envoyer\n:cancel button\n  : Annuler');
  expect(render(form)).toBe('form id=login\n  : Connexion\n  :email input\n  :submit button\n    : Envoyer');
});

test('indents merged text through flattened wrappers and keeps text boundaries', () => {
  const tree = element('div', 'content', [flatten([
    { tag: 'span', children: [text('Bon')] },
    { tag: 'span', children: [text('jour ')] },
    element('button', 'action', [text('Go')]),
    text(' après'),
    flatten([text('Bloc')]),
  ])]);
  expect(render(tree)).toBe('id=content\n  : Bonjour \n  :action button\n    : Go\n  : après\n  : Bloc');
  expect(render(flatten([text('Avant '), element('button', 'action'), text(' après')]))).toBe(': Avant \n:action button\n: après');
});

test('uses indentation without blank separators between siblings or after returning to a parent', () => {
  const tree = element('form', 'content', [
    element('button', 'first', [text('Go')]),
    text('Suite'),
    element('button', 'second'),
    flatten([flatten([text('Bloc')])]),
    flatten([element('button', 'third')]),
    element('button', 'fourth', [text('Fin')]),
  ]);
  expect(render(tree)).toBe('form id=content\n  :first button\n    : Go\n  : Suite\n  :second button\n  : Bloc\n  :third button\n  :fourth button\n    : Fin');
  expect(render(tree, 2)).toBe('form id=content\n  :first button\n  : Suite\n  :second button\n  : Bloc\n  :third button\n  :fourth button');
});

test('adds indentation without consuming meaningful text spaces or special characters', () => {
  expect(render(element('button', 'special', [text('  Été & <code> "你好" \\ fin\u00a0\u00a0')]))).toBe(':special button\n  :  Été & <code> "你好" \\ fin  ');
  expect(render(element('button', 'code', [flatten([text('\u00a0\u00a0code')])]))).toBe(':code button\n  :   code');
});

test('marks direct root text and text resembling element syntax', () => {
  expect(render({ tag: 'body', children: [text('div'), text(': 2 items left'), text(':123 button'), text(':submit button'), text('  ')] })).toBe(': div\n: : 2 items left\n: :123 button\n: :submit button');
});

test('retains numeric test IDs as attributes even when they match the ref number', () => {
  const button: AtmlNode = { tag: 'button', kept: true, attrs: { 'data-testid': '13' } };
  expect(renderAtml(button, new WeakMap([[button, ':13']]))).toBe(':13 button data-testid=13');
});

test('retains numeric HTML IDs even when they match the numeric ref', () => {
  const button: AtmlNode = { tag: 'button', kept: true, attrs: { id: '13' } };
  expect(renderAtml(button, new WeakMap([[button, ':13']]))).toBe(':13 button id=13');
});

test('preserves one-based depth limits after removing initial indentation', () => {
  const tree = element('form', 'login', [text('Label'), element('button', 'submit', [text('Go')])]);
  expect(render(tree, 1)).toBe('form id=login');
  expect(render(tree, 2)).toBe('form id=login\n  : Label\n  :submit button');
  expect(render(tree, 3)).toBe('form id=login\n  : Label\n  :submit button\n    : Go');
  expect(render({ tag: 'body', children: [flatten([text('Root')])] }, 1)).toBe(': Root');
  expect(render({ tag: 'body', children: [] })).toBe('(empty page)');
});
