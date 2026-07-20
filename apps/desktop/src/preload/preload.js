const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grokAPI', {
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getCurrentWorkspace: () => ipcRenderer.invoke('workspace:get-current'),
  readWorkspaceTree: () => ipcRenderer.invoke('workspace:read-tree'),
  readWorkspaceFile: (filePath) => ipcRenderer.invoke('workspace:read-file', filePath),
  sendPrompt: (data) => ipcRenderer.invoke('agent:send', data),
  cancelTurn: () => ipcRenderer.invoke('agent:cancel'),
  
  onAgentStdout: (callback) => {
    ipcRenderer.on('agent:stdout', (event, text) => callback(text));
  },
  onAgentStderr: (callback) => {
    ipcRenderer.on('agent:stderr', (event, text) => callback(text));
  },
  onAgentStatus: (callback) => {
    ipcRenderer.on('agent:status', (event, status) => callback(status));
  },
  onAgentAcpEvent: (callback) => {
    ipcRenderer.on('agent:acp-event', (event, msg) => callback(msg));
  },
});
