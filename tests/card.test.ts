import test from 'node:test';
import assert from 'node:assert/strict';

import { blockIndent, cardBlock, findCardBlock, findUrlTarget, imageAllowed, parseFlat, toCard, wikilinkTarget } from '../src/card.ts';

test('parseFlat reads quoted and bare values, including an unquoted wikilink', () => {
  const r = parseFlat('url: https://example.com\ntitle: "He said \\"hi\\""\ndescription: \'it\'\'s\'\nimage: [[pic.png]]\nhost: example.com');
  assert.deepEqual(r, { url: 'https://example.com', title: 'He said "hi"', description: "it's", image: '[[pic.png]]', host: 'example.com' });
});

test('parseFlat keeps a colon inside a value', () => {
  assert.equal(parseFlat('title: "Part 1: the start"').title, 'Part 1: the start');
  assert.equal(parseFlat('url: https://example.com:8080/x').url, 'https://example.com:8080/x');
});

test('toCard needs url and title and a web address', () => {
  assert.equal(toCard({ url: 'https://a.com' }).ok, false);
  assert.equal(toCard('text').ok, false);
  assert.equal(toCard(null).ok, false);
  const bad = toCard({ url: 'javascript:alert(1)', title: 'x' });
  assert.equal(bad.ok, false);
  const ok = toCard({ url: 'https://a.com', title: 'T', description: '', image: 'https://a.com/i.png', host: 'a.com' }, 4);
  assert.deepEqual(ok, { ok: true, card: { url: 'https://a.com', title: 'T', image: 'https://a.com/i.png', host: 'a.com', indent: 4 } });
});

test('blockIndent counts the leading whitespace of the first line', () => {
  assert.equal(blockIndent('  url: x\n  title: y'), 2);
  assert.equal(blockIndent('\nurl: x'), 0);
});

test('wikilinks and image safety', () => {
  assert.equal(wikilinkTarget('[[Folder/pic.png|alt]]'), 'Folder/pic.png');
  assert.equal(wikilinkTarget('https://a.com'), null);
  assert.equal(imageAllowed('[[pic.png]]'), true);
  assert.equal(imageAllowed('https://a.com/i.png'), true);
  assert.equal(imageAllowed('http://10.0.0.2/i.png'), false);
  assert.equal(imageAllowed('data:image/png;base64,AAAA'), false);
});

test('cardBlock matches the layout cardlink readers expect', () => {
  const block = cardBlock({ url: 'https://example.com/a', title: 'A "quoted"\ntitle', description: 'd', host: 'example.com', favicon: 'https://example.com/f.ico', image: 'https://example.com/i.png' });
  assert.equal(
    block,
    ['```cardlink', 'url: "https://example.com/a"', 'title: "A \\"quoted\\" title"', 'description: "d"', 'host: example.com', 'favicon: "https://example.com/f.ico"', 'image: "https://example.com/i.png"', '```'].join('\n'),
  );
  assert.equal(cardBlock({ url: 'https://a.com', title: 'T' }, '  '), '  ```cardlink\n  url: "https://a.com"\n  title: "T"\n  ```');
});

test('cardBlock round-trips through parseFlat', () => {
  const meta = { url: 'https://a.com/x?y=1#z', title: 'He said "hi": ok', description: 'Back\\slash', host: 'a.com' };
  const back = toCard(parseFlat(cardBlock(meta).split('\n').slice(1, -1).join('\n')));
  assert.ok(back.ok && back.card.title === meta.title && back.card.description === meta.description && back.card.url === meta.url);
});

test('findUrlTarget: bare address alone, in a list, mid-sentence, as a link', () => {
  assert.deepEqual(findUrlTarget('https://a.com/x', 3), { from: 0, to: 15, url: 'https://a.com/x', prefix: '', alone: true });
  const li = findUrlTarget('- [ ] https://a.com/x', 0);
  assert.equal(li?.prefix, '- [ ] ');
  assert.equal(li?.alone, true);
  const mid = findUrlTarget('See https://a.com/x, it is good', 8);
  assert.equal(mid?.url, 'https://a.com/x');
  assert.equal(mid?.alone, false);
  const link = findUrlTarget('[A page](https://a.com/x)', 2);
  assert.equal(link?.label, 'A page');
  assert.equal(link?.alone, true);
});

test('findUrlTarget picks by cursor or selection, and the only address when the cursor is elsewhere', () => {
  const line = 'one https://a.com two https://b.com';
  assert.equal(findUrlTarget(line, 25)?.url, 'https://b.com');
  assert.equal(findUrlTarget(line, 0), null);
  assert.equal(findUrlTarget(line, 0, { from: 4, to: 17 })?.url, 'https://a.com');
  assert.equal(findUrlTarget('text https://a.com', 0)?.url, 'https://a.com');
  assert.equal(findUrlTarget('no address', 0), null);
  assert.equal(findUrlTarget('<https://a.com>', 3), null);
});

test('findCardBlock finds the cardlink block around a line and ignores other fences', () => {
  const lines = ['text', '```cardlink', 'url: x', 'title: y', '```', 'after', '```js', 'const a = 1;', '```', '  ```cardlink', '  url: z', '  ```'];
  assert.deepEqual(findCardBlock(lines, 3), { start: 1, end: 4 });
  assert.deepEqual(findCardBlock(lines, 1), { start: 1, end: 4 });
  assert.equal(findCardBlock(lines, 0), null);
  assert.equal(findCardBlock(lines, 7), null);
  assert.deepEqual(findCardBlock(lines, 10), { start: 9, end: 11 });
});
