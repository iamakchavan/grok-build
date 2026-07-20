const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grokAPI', {
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getCurrentWorkspace: () => ipcRenderer.invoke('workspace:get-current'),
  readWorkspaceTree: () => ipcRenderer.invoke('workspace:read-tree'),
  readWorkspaceFile: (filePath) => ipcRenderer.invoke('workspace:read-file', filePath),

  // PTY Terminal Integration
  initPty: (dimensions) => ipcRenderer.invoke('pty:init', dimensions),
  writePty: (data) => ipcRenderer.invoke('pty:write', data),
  resizePty: (dimensions) => ipcRenderer.invoke('pty:resize', dimensions),
  sendCommand: (commandStr) => ipcRenderer.invoke('agent:send-command', commandStr),

  onPtyData: (callback) => {
    ipcRenderer.on('pty:data', (event, data) => callback(data));
  },
  onPtyReady: (callback) => {
    ipcRenderer.on('pty:ready', (event, info) => callback(info));
  },
  onPtyExit: (callback) => {
    ipcRenderer.on('pty:exit', (event, code) => callback(code));
  },
});
