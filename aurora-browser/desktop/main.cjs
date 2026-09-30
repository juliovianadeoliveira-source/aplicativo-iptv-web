'use strict';
const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { destination, safeURL, isTracker } = require('./policy.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-private-'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,MediaRouter');
const HOME = pathToFileURL(path.join(__dirname, 'index.html')).href;
const domains = fs.readFileSync(path.join(__dirname, 'trackers.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
let win, browserSession, selected, nextId = 1, blocked = 0, quitting = false;
const tabs = new Map();
const BAR_HEIGHT = 132;
function state() {
  if (!win || win.isDestroyed()) return;
  const current = tabs.get(selected);
  win.webContents.send('aurora-state', {
    tabs: [...tabs.values()].map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading })),
    selected, blocked, home: !current || current.home,
    url: current?.url || '',
    back: current?.view.webContents.navigationHistory.canGoBack() || false,
    forward: current?.view.webContents.navigationHistory.canGoForward() || false
  });
}
function arrange() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  for (const tab of tabs.values()) {
    const visible = tab.id === selected && !tab.home;
    tab.view.setVisible(visible);
    if (visible) tab.view.setBounds({ x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) });
  }
}
function activate(id) { if (!tabs.has(id)) return; selected = id; arrange(); state(); }
function createTab(url) {
  if (tabs.size >= 30) { dialog.showMessageBox(win, { message: 'Feche uma aba antes de abrir outra (limite de 30).', type: 'info' }); return; }
  const view = new WebContentsView({ webPreferences: {
    session: browserSession, nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
    safeDialogs: true, navigateOnDragDrop: false, spellcheck: false
  } });
  const tab = { id: nextId++, view, title: 'Nova aba', url: '', loading: false, home: true };
  tabs.set(tab.id, tab);
  win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: target }) => { if (safeURL(target)) createTab(target); return { action: 'deny' }; });
  wc.on('will-navigate', (event, target) => { if (!safeURL(target)) event.preventDefault(); });
  wc.on('will-redirect', (event, target) => { if (!safeURL(target)) event.preventDefault(); });
  wc.on('page-title-updated', (_event, title) => { tab.title = title.slice(0, 160); state(); });
  wc.on('did-start-loading', () => { tab.loading = true; state(); });
  wc.on('did-stop-loading', () => { tab.loading = false; state(); });
  const update = (_event, target) => { if (safeURL(target)) { tab.url = target; tab.home = false; arrange(); state(); } };
  wc.on('did-navigate', update);
  wc.on('did-navigate-in-page', update);
  wc.on('did-fail-load', (_event, code, description, _url, main) => {
    if (main && code !== -3 && tab.id === selected) dialog.showMessageBox(win, { type: 'info', message: 'Não foi possível abrir a página.', detail: description });
  });
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && ['l', 't', 'w'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      if (input.key.toLowerCase() === 'l') win.webContents.send('aurora-focus');
      if (input.key.toLowerCase() === 't') createTab();
      if (input.key.toLowerCase() === 'w') closeTab(selected);
    }
  });
  activate(tab.id);
  if (url) navigate(tab, url);
  return tab;
}
function navigate(tab, url) {
  if (!safeURL(url)) throw new Error('Endereço não permitido.');
  tab.home = false; tab.url = url; arrange(); state();
  tab.view.webContents.loadURL(url).catch(() => {});
}
function closeTab(id) {
  const tab = tabs.get(id); if (!tab) return;
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close(); tabs.delete(id);
  if (!tabs.size) createTab();
  else if (id === selected) activate([...tabs.keys()].at(-1));
  state();
}
async function clean() {
  for (const t of [...tabs.values()]) { win.contentView.removeChildView(t.view); t.view.webContents.close(); }
  tabs.clear(); blocked = 0;
  await browserSession.clearStorageData(); await browserSession.clearCache();
  await browserSession.clearAuthCache(); await browserSession.closeAllConnections();
  createTab();
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  browserSession = session.fromPartition('aurora-private', { cache: false });
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    let cancel = false;
    try { cancel = details.resourceType !== 'mainFrame' && isTracker(new URL(details.url).hostname, domains); } catch {}
    if (cancel) { blocked++; state(); }
    callback({ cancel });
  });
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers.DNT = '1'; headers['Sec-GPC'] = '1';
    callback({ requestHeaders: headers });
  });
  browserSession.on('will-download', (event) => { event.preventDefault(); dialog.showMessageBox(win, { type: 'info', message: 'Downloads estão bloqueados nesta versão privada.' }); });
  win = new BrowserWindow({ width: 1280, height: 850, minWidth: 700, minHeight: 480, title: 'Aurora', backgroundColor: '#101827', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('resize', arrange);
  win.webContents.on('did-finish-load', async () => {
    if (!tabs.size) createTab(); else state();
    if (process.env.AURORA_SMOKE_TEST === '1') {
      const timeout = setTimeout(() => { console.error('Aurora smoke timed out'); app.exit(1); }, 45000);
      try {
        await require('./smoke.cjs')({ createTab, tabs, closeTab, clean, getSession: () => browserSession, getBlocked: () => blocked, getWindow: () => win });
        clearTimeout(timeout); app.quit();
      } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1); }
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { for (const tab of tabs.values()) { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } tabs.clear(); win = null; });
});
ipcMain.handle('aurora-command', async (event, payload) => {
  if (!win || event.sender !== win.webContents || event.senderFrame?.url !== HOME) return { error: 'Origem não autorizada.' };
  const action = payload?.action, value = payload?.value;
  const tab = tabs.get(selected);
  try {
    switch (action) {
      case 'navigate': {
        if (!value || typeof value.text !== 'string') throw new Error('Endereço inválido.');
        const url = destination(value.text, value.engine, value.category); if (url) navigate(tab, url); break;
      }
      case 'new': createTab(); break;
      case 'select': activate(Number(value)); break;
      case 'close': closeTab(Number(value)); break;
      case 'back': if (tab.view.webContents.navigationHistory.canGoBack()) { tab.home = false; arrange(); tab.view.webContents.navigationHistory.goBack(); } break;
      case 'forward': if (tab.view.webContents.navigationHistory.canGoForward()) { tab.home = false; arrange(); tab.view.webContents.navigationHistory.goForward(); } break;
      case 'reload': if (!tab.home) tab.view.webContents.reload(); break;
      case 'home': tab.view.webContents.stop(); tab.home = true; arrange(); state(); break;
      case 'clean': await clean(); break;
      case 'ready': state(); break;
      case 'about': {
        for (const t of tabs.values()) t.view.setVisible(false);
        await dialog.showMessageBox(win, { title: 'Aurora 0.1.0', message: 'Aurora · Navegação privada', detail: 'Abas e dados ficam nesta sessão. Ao fechar, o perfil temporário é removido. Bloqueio básico por domínio, sem analytics próprios. Não oculta seu IP, não impede todo rastreamento e não elimina registros dos sites. Câmera, microfone, localização e downloads estão bloqueados nesta versão.' }); arrange(); break;
      }
      default: throw new Error('Ação inválida.');
    }
    return { ok: true };
  } catch (error) { return { error: error.message }; }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !browserSession) return;
  event.preventDefault(); quitting = true;
  Promise.allSettled([browserSession.clearStorageData(), browserSession.clearCache(), browserSession.clearAuthCache()]).finally(() => app.quit());
});
app.on('quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
