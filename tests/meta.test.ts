import test from 'node:test';
import assert from 'node:assert/strict';

import { asBareUrl, bareCard, decodeEntities, extractCard, isPrivateHost, isWebUrl } from '../src/meta.ts';

test('asBareUrl accepts one public web address only', () => {
  assert.equal(asBareUrl(' https://example.com/a?b=1 \n'), 'https://example.com/a?b=1');
  assert.equal(asBareUrl('see https://example.com'), null);
  assert.equal(asBareUrl('http://localhost:3000'), null);
  assert.equal(asBareUrl('http://192.168.1.4/x'), null);
  assert.equal(asBareUrl('ftp://example.com'), null);
});

test('private hosts', () => {
  for (const h of ['localhost', 'a.local', '10.0.0.1', '127.0.0.1', '172.20.1.1', '169.254.1.1', '::1', '[fd00::1]']) assert.equal(isPrivateHost(h), true, h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) assert.equal(isPrivateHost(h), false, h);
});

test('isWebUrl blocks other schemes and private hosts', () => {
  assert.equal(isWebUrl('https://example.com/i.png'), true);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
  assert.equal(isWebUrl('file:///etc/passwd'), false);
  assert.equal(isWebUrl('http://127.0.0.1/x.png'), false);
});

test('decodeEntities', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#8212; &#x41;&nbsp;&bogus;'), 'Tom & Jerry — A &bogus;');
});

const PAGE = `<html><head><!-- <title>no</title> -->
<title>Plain title</title>
<meta property="og:title" content="OG &amp; Title">
<meta property='og:description' content='A  long
 description'>
<meta name="twitter:image" content="/img/card.png">
<link rel="icon" href="/static/fav.ico">
<link rel="apple-touch-icon" href="/touch.png">
</head><body></body></html>`;

test('extractCard prefers Open Graph and resolves relative addresses', () => {
  const c = extractCard(PAGE, 'https://www.example.com/post', 'https://www.example.com/post');
  assert.deepEqual(c, {
    url: 'https://www.example.com/post',
    title: 'OG & Title',
    host: 'example.com',
    description: 'A long description',
    favicon: 'https://www.example.com/static/fav.ico',
    image: 'https://www.example.com/img/card.png',
  });
});

test('extractCard resolves against the final address after a redirect', () => {
  const c = extractCard('<title>T</title><meta property="og:image" content="pic.jpg">', 'https://short.example/x', 'https://long.example/a/b');
  assert.equal(c?.image, 'https://long.example/a/pic.jpg');
  assert.equal(c?.host, 'short.example');
  assert.equal(c?.favicon, 'https://long.example/favicon.ico');
});

test('extractCard falls back to the plain title and drops unsafe images', () => {
  const c = extractCard('<title> Just  a title </title><meta property="og:image" content="javascript:alert(1)"><meta name="description" content="d">', 'https://example.com/');
  assert.equal(c?.title, 'Just a title');
  assert.equal(c?.description, 'd');
  assert.equal(c?.image, undefined);
});

test('extractCard returns null without a title; bareCard names the host', () => {
  assert.equal(extractCard('<html><body>hi</body></html>', 'https://example.com'), null);
  assert.deepEqual(bareCard('https://www.example.com/x'), { url: 'https://www.example.com/x', title: 'example.com', host: 'example.com' });
});

test('long titles and descriptions are capped', () => {
  const c = extractCard(`<title>${'a'.repeat(500)}</title><meta name="description" content="${'b '.repeat(400)}">`, 'https://example.com');
  assert.equal(c?.title.length, 200);
  assert.ok((c?.description?.length ?? 0) <= 300);
});
