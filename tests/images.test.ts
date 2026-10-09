import test from 'node:test';
import assert from 'node:assert/strict';

import { cardBlock, findCardBlock, findCardBlocks, parseFlat, toCard, unquoteValue, yamlString } from '../src/card.ts';
import {
  IMAGE_EXTENSIONS,
  imageBaseName,
  imageExtension,
  isLocalImage,
  isRemoteImage,
  localImageLink,
  remoteImageFields,
  rewriteImageFields,
  shortHash,
} from '../src/images.ts';

test('imageExtension maps image content types and refuses everything else', () => {
  assert.equal(imageExtension('image/png'), 'png');
  assert.equal(imageExtension('Image/JPEG; charset=binary'), 'jpg');
  assert.equal(imageExtension('image/svg+xml'), 'svg');
  assert.equal(imageExtension('image/x-icon'), 'ico');
  assert.equal(imageExtension('image/vnd.microsoft.icon'), 'ico');
  assert.equal(imageExtension('image/webp'), 'webp');
  assert.equal(imageExtension('text/html'), null);
  assert.equal(imageExtension('image/tiff'), null);
  assert.equal(imageExtension('application/octet-stream'), null);
  assert.equal(imageExtension(''), null);
  assert.equal(imageExtension(undefined), null);
  assert.ok(IMAGE_EXTENSIONS.includes('png') && IMAGE_EXTENSIONS.length === new Set(IMAGE_EXTENSIONS).size);
});

test('shortHash is stable, eight characters and tells addresses apart', () => {
  const a = shortHash('https://example.com/a.png');
  assert.equal(a, shortHash('https://example.com/a.png'));
  assert.match(a, /^[0-9a-z]{8}$/);
  assert.notEqual(a, shortHash('https://example.com/b.png'));
  assert.notEqual(a, shortHash('https://example.com/a.png?x=1'));
  assert.match(shortHash(''), /^[0-9a-z]{8}$/);
});

test('imageBaseName is the domain and the hash, safe as a file name', () => {
  const name = imageBaseName('https://www.Example.com/img/cover.png?v=2');
  assert.match(name, /^example-com-[0-9a-z]{8}$/);
  assert.equal(name, imageBaseName('https://www.Example.com/img/cover.png?v=2'));
  assert.notEqual(name, imageBaseName('https://www.example.com/img/other.png'));
  assert.match(imageBaseName('https://sub.domain.example.co.uk/x'), /^sub-domain-example-co-uk-[0-9a-z]{8}$/);
  assert.match(imageBaseName('not a url'), /^image-[0-9a-z]{8}$/);
  const long = imageBaseName(`https://${'a'.repeat(100)}.com/x`);
  assert.ok(long.length <= 40 + 9);
});

test('local and remote images are told apart', () => {
  assert.equal(isLocalImage('[[cover.png]]'), true);
  assert.equal(isLocalImage('[[Attachments/a-b.png]]'), true);
  assert.equal(isLocalImage('https://example.com/a.png'), false);
  assert.equal(isRemoteImage('https://example.com/a.png'), true);
  assert.equal(isRemoteImage('[[cover.png]]'), false);
  assert.equal(isRemoteImage('http://192.168.1.2/a.png'), false);
  assert.equal(isRemoteImage('javascript:alert(1)'), false);
  assert.equal(isRemoteImage('file:///etc/passwd'), false);
  assert.equal(isRemoteImage(''), false);
});

test('localImageLink writes a wikilink and refuses paths a link cannot hold', () => {
  assert.equal(localImageLink('Attachments/example-com-1a2b3c4d.png'), '[[Attachments/example-com-1a2b3c4d.png]]');
  assert.equal(localImageLink('a b/c.png'), '[[a b/c.png]]');
  assert.equal(localImageLink('a#b/c.png'), null);
  assert.equal(localImageLink('a|b.png'), null);
  assert.equal(localImageLink('a]b.png'), null);
  assert.equal(localImageLink(''), null);
  // The value reads back as the same file.
  const back = toCard(parseFlat(`url: https://a.com\ntitle: T\nimage: ${yamlString(localImageLink('Att/x.png') ?? '')}`));
  assert.ok(back.ok && back.card.image === '[[Att/x.png]]');
});

const NOTE = [
  'Intro',
  '```cardlink',
  'url: "https://a.com/post"',
  'title: "Post"',
  'favicon: "https://a.com/favicon.ico"',
  'image: "https://a.com/cover.png"',
  '```',
  '```js',
  'image: "https://in-code.com/x.png"',
  '```',
  '  ```cardlink',
  '  url: "https://b.com"',
  '  title: "B"',
  "  image: 'https://b.com/i.jpg'",
  '  ```',
  '```cardlink',
  'url: "https://c.com"',
  'title: "C"',
  'image: "[[c-com-12345678.png]]"',
  'favicon: ftp://c.com/f.ico',
  '```',
].join('\n');

test('findCardBlocks lists every cardlink block and skips other code', () => {
  const lines = NOTE.split('\n');
  assert.deepEqual(findCardBlocks(lines), [
    { start: 1, end: 6 },
    { start: 10, end: 14 },
    { start: 15, end: 20 },
  ]);
  assert.deepEqual(findCardBlock(lines, 4), { start: 1, end: 6 });
  assert.equal(findCardBlock(lines, 8), null);
  assert.equal(findCardBlock(lines, 0), null);
});

test('remoteImageFields finds web addresses only, also in an indented block, and leaves vault files alone', () => {
  const lines = NOTE.split('\n');
  const [a, b, c] = findCardBlocks(lines);
  assert.deepEqual(
    remoteImageFields(lines, a).map((f) => [f.line, f.key, f.url]),
    [[4, 'favicon', 'https://a.com/favicon.ico'], [5, 'image', 'https://a.com/cover.png']],
  );
  assert.deepEqual(remoteImageFields(lines, b).map((f) => [f.line, f.key, f.url, f.prefix]), [[13, 'image', 'https://b.com/i.jpg', '  ']]);
  assert.deepEqual(remoteImageFields(lines, c), []);
});

test('rewriteImageFields swaps only the fields that were saved and keeps the indent', () => {
  const lines = NOTE.split('\n');
  const [a, b] = findCardBlocks(lines);
  const saved = new Map([
    ['https://a.com/cover.png', '[[Att/a-com-aaaaaaaa.png]]'],
    ['https://b.com/i.jpg', '[[Att/b-com-bbbbbbbb.jpg]]'],
  ]);
  assert.deepEqual(rewriteImageFields(remoteImageFields(lines, a), saved), [{ line: 5, text: 'image: "[[Att/a-com-aaaaaaaa.png]]"' }]);
  assert.deepEqual(rewriteImageFields(remoteImageFields(lines, b), saved), [{ line: 13, text: '  image: "[[Att/b-com-bbbbbbbb.jpg]]"' }]);
  assert.deepEqual(rewriteImageFields(remoteImageFields(lines, a), new Map()), []);
});

test('a rewritten block still reads as the same card with a local image', () => {
  const lines = ['```cardlink', 'url: "https://a.com"', 'title: "A"', 'image: "https://a.com/i.png"', '```'];
  const block = { start: 0, end: 4 };
  const [edit] = rewriteImageFields(remoteImageFields(lines, block), new Map([['https://a.com/i.png', '[[Att/a.png]]']]));
  lines[edit.line] = edit.text;
  const r = toCard(parseFlat(lines.slice(1, 4).join('\n')));
  assert.ok(r.ok && r.card.image === '[[Att/a.png]]' && r.card.title === 'A');
});

test('unquoteValue reads quoted and bare values', () => {
  assert.equal(unquoteValue('"a \\"b\\""'), 'a "b"');
  assert.equal(unquoteValue("'it''s'"), "it's");
  assert.equal(unquoteValue('bare'), 'bare');
});

test('cardBlock writes a saved image as a single quoted wikilink', () => {
  const block = cardBlock({ url: 'https://a.com', title: 'A', host: 'a.com', favicon: '[[Att/f.png]]', image: '[[Att/i.png]]' });
  assert.ok(block.includes('\nfavicon: "[[Att/f.png]]"\nimage: "[[Att/i.png]]"\n'));
  const r = toCard(parseFlat(block.split('\n').slice(1, -1).join('\n')));
  assert.ok(r.ok && r.card.image === '[[Att/i.png]]' && r.card.favicon === '[[Att/f.png]]');
});
