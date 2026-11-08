'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBoard', {
  isElectron: true,
  setPin: v => ipcRenderer.send('win-pin', v),
  setThrough: v => ipcRenderer.send('win-through', v),
  close: () => ipcRenderer.send('win-close'),
  onThroughChanged: cb => ipcRenderer.on('through-changed', (_e, v) => cb(v)),
  onSetupStep: cb => ipcRenderer.on('setup-step', (_e, s) => cb(s)),
});
