const test = require('node:test');
const assert = require('node:assert/strict');
const { destination, safeURL, isTracker, searchURL } = require('../desktop/policy.cjs');
test('blocks executable and local URLs', () => {
  for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'intent://test', 'vbscript:hello']) {
    assert.equal(safeURL(u), false); assert.throws(() => destination(u));
  }
});
test('address and search use safe protocols and encode query text', () => {
  assert.equal(destination('example.com/path'), 'https://example.com/path');
  const u = new URL(destination('antena & câmera #1')); assert.equal(u.searchParams.get('q'), 'antena & câmera #1');
  assert.equal(destination('https://example.com/a'), 'https://example.com/a');
});
test('domain blocking cannot match unrelated suffixes', () => {
  const domains = ['doubleclick.net'];
  assert.ok(isTracker('ads.doubleclick.net', domains)); assert.ok(isTracker('DOUBLECLICK.NET.', domains));
  assert.equal(isTracker('notdoubleclick.net', domains), false);
  assert.equal(isTracker('doubleclick.net.example.org', domains), false);
});
test('search categories route to chosen provider', () => {
  const d = new URL(searchURL('tv', 'duckduckgo', 'images')); assert.equal(d.searchParams.get('ia'), 'images');
  const g = new URL(searchURL('tv', 'google', 'videos')); assert.equal(g.searchParams.get('tbm'), 'vid');
  assert.ok(searchURL('Nova Venécia', 'google', 'maps').startsWith('https://www.google.com/maps/search/'));
});
