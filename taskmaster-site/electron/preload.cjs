const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('taskmasterDesktop', {
  getInfo: () => ipcRenderer.invoke('taskmaster:get-desktop-info'),
  openAccessibilitySettings: () =>
    ipcRenderer.invoke('taskmaster:open-accessibility-settings'),
  playStep: (step) => ipcRenderer.invoke('taskmaster:play-step', step),
})
