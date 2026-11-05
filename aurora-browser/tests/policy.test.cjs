const test = require('node:test');
const assert = require('node:assert/strict');
const { destination, safeURL, isTracker, searchURL } = require('../desktop/policy.cjs');
const { regionalShortcut } = require('../desktop/jogos-region.cjs');
const { items } = require('../desktop/jstech-catalog.js');
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
test('Jogos opens only the operator site listed for the detected country', async () => {
  const { signal } = new AbortController();
  const session = trace => ({ fetch: async () => ({ ok: true, text: async () => trace }) });
  const cases = [
    ['Betano', 'PT', 'https://www.betano.pt/'],
    ['Novibet', 'CY', 'https://www.novibet.com.cy/'],
    ['Bet365', 'GB', 'https://www.bet365.com/'],
    ['Bet365', 'CY', 'https://www.bet365.com.cy/']
  ];
  const shortcuts = items.filter(item => item.cat === 'Jogos' && item.regionalUrls);
  for (const [name, country, url] of cases) {
    const entry = shortcuts.find(item => item.name === name);
    assert.deepEqual(await regionalShortcut(entry, session(`colo=GRU\r\nloc=${country}\r\n`), signal), { country, url });
  }
  for (const entry of shortcuts) {
    assert.deepEqual(await regionalShortcut(entry, session('colo=LIS\nloc=BR\n'), signal), { country: 'BR', url: null });
  }
  const betano = shortcuts.find(item => item.name === 'Betano');
  assert.deepEqual(await regionalShortcut(betano, session('colo=LIS\n'), signal), { country: null, url: null });
  assert.deepEqual(await regionalShortcut(betano, session('loc=XX\n'), signal), { country: null, url: null });
  const offline = { fetch: async () => { throw new Error('offline'); } };
  assert.deepEqual(await regionalShortcut(betano, offline, signal), { country: null, url: null });
});

