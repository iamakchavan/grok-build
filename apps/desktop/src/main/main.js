const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let currentWorkspace = process.cwd();
let activeProcess = null;
let activeSessionId = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "Grok Build Desktop",
    backgroundColor: "#090a0f",
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    killActiveProcess();
  });
}

function findSystemGrokBinary() {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const candidatePaths = [
    path.join(userHome, '.grok', 'bin', 'grok.exe'),
    path.join(userHome, '.grok', 'bin', 'grok'),
    path.join(__dirname, '../../../target/release/xai-grok-pager.exe'),
    path.join(__dirname, '../../../target/release/xai-grok-pager'),
    path.join(__dirname, '../../../target/debug/xai-grok-pager.exe'),
    path.join(__dirname, '../../../target/debug/xai-grok-pager'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return 'grok';
}

function killActiveProcess() {
  if (activeProcess) {
    try {
      activeProcess.kill();
    } catch (e) {
      // ignore
    }
    activeProcess = null;
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('workspace:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Workspace Directory',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    currentWorkspace = result.filePaths[0];
    return currentWorkspace;
  }
  return null;
});

ipcMain.handle('workspace:get-current', () => {
  return currentWorkspace;
});

ipcMain.handle('workspace:read-tree', () => {
  function scan(dirPath, depth = 0) {
    if (depth > 3) return [];
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = [];
      for (const item of items) {
        if (item.name === 'node_modules' || item.name === 'target' || item.name === '.git') continue;
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          result.push({
            name: item.name,
            path: fullPath,
            isDir: true,
            children: scan(fullPath, depth + 1)
          });
        } else {
          result.push({
            name: item.name,
            path: fullPath,
            isDir: false
          });
        }
      }
      return result;
    } catch (e) {
      return [];
    }
  }
  return scan(currentWorkspace);
});

ipcMain.handle('workspace:read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Real Grok Saved Sessions IPC Handlers
ipcMain.handle('sessions:list', async () => {
  const grokBin = findSystemGrokBinary();
  return new Promise((resolve) => {
    exec(`"${grokBin}" sessions list`, { cwd: currentWorkspace }, (error, stdout, stderr) => {
      if (error) {
        console.error('[Grok Desktop Sessions] Error listing sessions:', error);
        resolve([]);
        return;
      }

      const lines = stdout.split('\n');
      const sessions = [];
      let headerPassed = false;

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.includes('SESSION ID')) {
          headerPassed = true;
          continue;
        }
        if (!headerPassed) continue;

        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 4) {
          sessions.push({
            id: parts[0],
            created: parts[1],
            updated: parts[2],
            status: parts[3],
            summary: parts[4] || 'Untitled Session'
          });
        }
      }

      resolve(sessions);
    });
  });
});

ipcMain.handle('sessions:export', async (event, sessionId) => {
  const grokBin = findSystemGrokBinary();
  activeSessionId = sessionId;
  return new Promise((resolve) => {
    exec(`"${grokBin}" export "${sessionId}"`, { cwd: currentWorkspace }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, sessionId, transcript: stdout });
      }
    });
  });
});

ipcMain.handle('sessions:new', () => {
  activeSessionId = null;
  return { status: 'cleared' };
});

// Real Sandboxed Grok Execution Handler
ipcMain.handle('agent:send', async (event, { prompt, model, sessionId }) => {
  killActiveProcess();

  const grokBin = findSystemGrokBinary();
  const targetModel = (model && model !== 'grok-3.5') ? model : 'grok-4.5';
  const resumeSession = sessionId || activeSessionId;

  console.log(`[Grok Desktop] Executing grok agent (Session: ${resumeSession || 'NEW'}, Workspace: ${currentWorkspace})`);

  const args = [];
  if (resumeSession) {
    args.push('-r', resumeSession);
  }

  args.push('-p', prompt, '--cwd', currentWorkspace, '--always-approve', '-m', targetModel);

  try {
    activeProcess = spawn(grokBin, args, {
      cwd: currentWorkspace,
      env: { ...process.env, RUST_LOG: 'info', GROK_SANDBOX: 'active' },
    });

    let buffer = '';

    activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      buffer += text;

      if (mainWindow) {
        mainWindow.webContents.send('agent:stdout', text);
        // Forward live stream to renderer
        mainWindow.webContents.send('agent:acp-event', text);
      }
    });

    activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      if (mainWindow) {
        mainWindow.webContents.send('agent:stderr', text);
      }
    });

    activeProcess.on('exit', (code) => {
      console.log(`[Grok Desktop] Grok process exited with code ${code}`);

      if (mainWindow) {
        // Parse final buffer for JSON errors or limit notices
        try {
          const parsed = JSON.parse(buffer.trim());
          mainWindow.webContents.send('agent:acp-event', parsed);
        } catch (e) {
          // If plain text, buffer already forwarded
        }
        mainWindow.webContents.send('agent:status', { active: false, code });
      }

      activeProcess = null;
    });

    return { status: 'spawned', binary: grokBin, model: targetModel, sessionId: resumeSession };
  } catch (err) {
    console.error('[Grok Desktop] Failed to execute grok agent:', err);
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('agent:cancel', async () => {
  killActiveProcess();
  if (mainWindow) {
    mainWindow.webContents.send('agent:status', { active: false, code: 0 });
  }
  return { status: 'cancelled' };
});
