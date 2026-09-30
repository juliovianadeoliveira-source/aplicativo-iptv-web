'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aurora', {
  command: (action, value) => ipcRenderer.invoke('aurora-command', { action, value }),
  onState: callback => ipcRenderer.on('aurora-state', (_event, state) => callback(state)),
  onFocus: callback => ipcRenderer.on('aurora-focus', () => callback())
});
