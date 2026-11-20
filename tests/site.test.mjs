import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { contacts, getServices, locales } from '../site/content.mjs';
import { render } from '../site/render.mjs';
import { moveSlide, recommendServices } from '../assets/service-guide.mjs';

test('all guide goals map to available services in both languages', () => {
  const ids = getServices('fa').map(([id]) => id);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(ids, getServices('en').map(([id]) => id));
  for (const [lang, copy] of Object.entries(locales)) {
    assert.equal(copy.goals.length, 4, lang);
    for (const [index] of copy.goals.entries()) {
      assert.equal(recommendServices(index).length, 2);
      assert.ok(recommendServices(index).every((id) => ids.includes(id)));
    }
  }
  for (const bad of [-1, 4, NaN, 2.5, '0', null]) assert.deepEqual(recommendServices(bad), []);
  assert.deepEqual(recommendServices(2), ['creative', 'software']);
  recommendServices(2).pop();
  assert.equal(recommendServices(2).length, 2);
});

test('display navigation wraps in both directions', () => {
  assert.equal(moveSlide(0, -1, 5), 4);
  assert.equal(moveSlide(4, 1, 5), 0);
  assert.equal(moveSlide(2, 1, 5), 3);
  assert.equal(moveSlide(3, 1, 0), 0);
});

for (const [lang, copy] of Object.entries(locales)) {
  test(`${lang}: localized, offline assets and working destinations`, async () => {
    const html = render(lang);
    assert.ok(html.includes(`<html lang="${lang}" dir="${copy.direction}">`));
    assert.match(html, /<details>[\s\S]*?<summary[\s\S]*?<ul>/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate element id');
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
    for (const [, url] of html.matchAll(/(?:\bsrc="|<link[^>]+href=")([^"]+)/g)) {
      assert.doesNotMatch(url, /^(?:[a-z]+:|\/)/i);
      await access(new URL(`../${url}`, import.meta.url));
    }
    for (const contact of contacts) assert.ok(html.includes(`href="${contact.href}"`));
    assert.doesNotMatch(html, /<script(?![^>]+src=)|<form(?! method="dialog")|\bonclick\s*=/i);
  });
}

test('CSS fonts and imported browser modules are local', async () => {
  for (const [filename, matcher] of [['site.css', /url\(['"]?([^)'"\s]+)['"]?\)/g], ['site.mjs', /from ['"]([^'"]+)['"]/g]]) {
    const file = new URL(`../assets/${filename}`, import.meta.url);
    const code = await readFile(file, 'utf8');
    for (const [, asset] of code.matchAll(matcher)) {
      assert.doesNotMatch(asset, /^(?:[a-z]+:|\/)/i);
      await access(new URL(asset, file));
    }
  }
});
