'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { nativeImage } = require('electron');
module.exports = async function smoke({ createTab, tabs, closeTab, clean, getSession, getBlocked, getWindow }) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Aurora smoke page</title><h1>Browser test</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    const home = getWindow().webContents;
    const groups = await home.executeJavaScript("[...document.querySelectorAll('.portal-section h2')].map(node => node.textContent)");
    assert.ok(groups.includes('Comunicação') && groups.includes('Redes sociais'), 'The home page must show separate categories.');
    assert.ok(groups.includes('Para crianças e jovens'), 'The educational shortcuts must have their own section.');
    const youthLinks = await home.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('.portal-category')];
      buttons.find(button => button.textContent === 'Para crianças e jovens').click();
      const labels = [...document.querySelectorAll('.portal-card-title')].map(item => item.textContent);
      buttons.find(button => button.textContent === 'Todos').click();
      return labels;
    })()`);
    assert.ok(youthLinks.includes('NASA Kids’ Club') && youthLinks.includes('AEB Escola'));
    assert.ok(!youthLinks.includes('Tor Project · Diretório oficial'));
    const catalogStatus = await home.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('.portal-category')];
      const select = category => buttons.find(button => button.textContent === category).click();
      select('Jogos');
      const jogosCards = [...document.querySelector('.portal-section').querySelectorAll('.portal-card')];
      const opened = [];
      let photoConfirmation = '';
      const confirm = window.confirm;
      const command = window.command;
      try {
        window.confirm = () => true;
        window.command = (action, url) => opened.push({ action, url });
        jogosCards.forEach(card => card.click());
        select('Adulto');
        const photo = document.querySelector('[aria-label="Abrir Atlas of Nudes · Fotos"]');
        window.confirm = message => { photoConfirmation = message; return false; };
        photo.click();
      } finally {
        window.confirm = confirm;
        window.command = command;
        select('Todos');
      }
      return { opened, photoConfirmation };
    })()`);
    assert.equal(catalogStatus.opened.length, 6);
    assert.ok(catalogStatus.opened.every(item => item.action === 'open-shortcut'));
    assert.deepEqual(catalogStatus.opened.map(item => new URL(item.url).hostname), [
      'www.gov.br', 'betano.bet.br', 'novibet.bet.br', 'kto.bet.br', 'betao.bet.br', 'bet365.bet.br'
    ]);
    assert.match(catalogStatus.photoConfirmation, /18\+/);
    assert.equal(tabs.size, 1, 'Declining the adult confirmation must keep the gallery closed.');
    const network = getSession();
    const originalFetch = network.fetch;
    try {
      network.fetch = async () => ({ ok: true, text: async () => 'loc=BR\n' });
      const regional = await home.executeJavaScript("window.aurora.command('open-shortcut', 'https://betano.bet.br/')");
      assert.match(regional.error, /Brasil.*Portugal/);
      const withoutMarket = await home.executeJavaScript("window.aurora.command('open-shortcut', 'https://kto.bet.br/')");
      assert.match(withoutMarket.error, /KTO.*sem confirmação/);
      assert.equal(tabs.size, 1, 'An unsupported region must leave the current tab open.');
    } finally {
      network.fetch = originalFetch;
    }
    const priveStatus = await home.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('.portal-category')];
      const select = category => buttons.find(button => button.textContent === category).click();
      select('Privê 18+');
      const groups = [...document.querySelectorAll('.portal-section')];
      const direct = groups[0].querySelector('[aria-label="Abrir Atlas of Nudes · Fotos"]');
      const confirm = window.confirm;
      const command = window.command;
      let shortcut;
      try {
        window.confirm = () => true;
        window.command = (...args) => { shortcut = args; };
        direct.click();
      } finally {
        window.confirm = confirm;
        window.command = command;
        select('Todos');
      }
      return {
        headings: groups.map(group => group.querySelector('h2').textContent),
        bots: groups[1].querySelectorAll('.portal-card').length,
        shortcut
      };
    })()`);
    assert.deepEqual(priveStatus, {
      headings: ['Abre direto no Aurora', 'Bots do Telegram'],
      bots: 10,
      shortcut: ['open-shortcut', 'https://atlasofnudes.com/explore']
    });
    const results = await home.executeJavaScript(`(() => {
      const input = document.querySelector('#portal-query');
      input.value = 'WhatsApp'; input.dispatchEvent(new Event('input'));
      const labels = [...document.querySelectorAll('.portal-card-title')].map(item => item.textContent);
      input.value = ''; input.dispatchEvent(new Event('input'));
      return labels;
    })()`);
    assert.ok(results.includes('WhatsApp'), 'The imported catalog must be searchable on the home page.');
    const atlas = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'jstech-logos.png')));
    assert.ok(!atlas.isEmpty(), 'The packaged logo atlas must be a valid image.');
    const hasLogo = await home.executeJavaScript(`(() => {
      const mark = document.querySelector('[aria-label="Abrir WhatsApp"] .portal-brand-mark');
      return Boolean(mark && getComputedStyle(mark).backgroundImage.includes('jstech-logos.png'));
    })()`);
    assert.ok(hasLogo, 'The packaged catalog must display the local WhatsApp logo.');
    const unsafe = await home.executeJavaScript("window.aurora.command('open-shortcut', 'http://example.onion/')");
    assert.match(unsafe.error, /precisam do Tor/);
    const initialTabs = tabs.size;
    const opened = await home.executeJavaScript(`window.aurora.command('open-shortcut', ${JSON.stringify(url)})`);
    assert.equal(opened.ok, true);
    assert.equal(tabs.size, initialTabs + 1);
    const shortcutTab = [...tabs.values()].at(-1);
    const shortcutContents = shortcutTab.view.webContents;
    if (shortcutContents.isLoadingMainFrame() || shortcutContents.getURL() !== url) {
      await new Promise((resolve, reject) => {
        shortcutContents.once('did-finish-load', resolve);
        shortcutContents.once('did-fail-load', (_event, code, error) => reject(new Error(`Shortcut load failed: ${code} ${error}`)));
      });
    }
    assert.equal(shortcutContents.getURL(), url);
    closeTab(shortcutTab.id);
    const tab = createTab();
    tab.home = false;
    await tab.view.webContents.loadURL(url);
    assert.equal(tab.view.webContents.getURL(), url);
    assert.equal(await tab.view.webContents.executeJavaScript('typeof require'), 'undefined');
    assert.equal(await tab.view.webContents.executeJavaScript('typeof window.aurora'), 'undefined');
    const count = tabs.size; const extra = createTab();
    assert.equal(tabs.size, count + 1); closeTab(extra.id); assert.equal(tabs.size, count);
    const before = getBlocked();
    await tab.view.webContents.executeJavaScript("fetch('https://www.google-analytics.com/collect').catch(() => null)");
    assert.ok(getBlocked() > before, 'tracker request should be blocked');
    await tab.view.webContents.executeJavaScript("localStorage.setItem('aurora-test','present'); document.cookie='aurora_test=present'");
    assert.ok((await getSession().cookies.get({ url })).length);
    await clean();
    assert.equal((await getSession().cookies.get({ url })).length, 0);
    assert.equal(tabs.size, 1);
    const fresh = [...tabs.values()][0]; await fresh.view.webContents.loadURL(url);
    assert.equal(await fresh.view.webContents.executeJavaScript("localStorage.getItem('aurora-test')"), null);
    assert.equal(await getWindow().webContents.executeJavaScript('document.title'), 'Aurora');
    console.log('Aurora smoke passed: JSTech catalog, shortcuts, tabs, engine, IPC isolation, tracker blocking, cookie/storage cleanup');
  } finally { server.close(); }
};

