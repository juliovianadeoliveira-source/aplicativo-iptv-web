'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
module.exports = async function smoke({ createTab, tabs, closeTab, clean, getSession, getBlocked, getWindow }) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Aurora smoke page</title><h1>Browser test</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  try {
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
    console.log('Aurora smoke passed: tabs, engine, IPC isolation, tracker blocking, cookie/storage cleanup');
  } finally { server.close(); }
};
