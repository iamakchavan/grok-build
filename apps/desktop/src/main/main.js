const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let currentWorkspace = process.cwd();
let activeProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "Grok Build Desktop",
    backgroundColor: "#0d0f17",
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

// Real System Grok Execution IPC Handler
ipcMain.handle('agent:send', async (event, { prompt, model }) => {
  killActiveProcess();

  const grokBin = findSystemGrokBinary();
  const targetModel = (model && model !== 'grok-3.5') ? model : 'grok-4.5';
  console.log(`[Grok Desktop] Spawning real system grok binary: ${grokBin} (model: ${targetModel})`);

  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--cwd', currentWorkspace,
    '--always-approve',
    '-m', targetModel
  ];

  try {
    activeProcess = spawn(grokBin, args, {
      cwd: currentWorkspace,
      env: { ...process.env, RUST_LOG: 'info' },
    });

    let buffer = '';

    activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      buffer += text;

      if (mainWindow) {
        mainWindow.webContents.send('agent:stdout', text);
      }
    });

    activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      if (mainWindow) {
        mainWindow.webContents.send('agent:stderr', text);
      }
    });

    activeProcess.on('exit', (code) => {
      console.log(`[Grok Desktop] Grok process finished with code ${code}`);
      
      let parsedEvent = null;
      try {
        parsedEvent = JSON.parse(buffer.trim());
      } catch (e) {
        parsedEvent = { type: 'text', text: buffer || 'Execution complete.' };
      }

      if (mainWindow) {
        mainWindow.webContents.send('agent:acp-event', parsedEvent);
        mainWindow.webContents.send('agent:status', { active: false, code });
      }

      activeProcess = null;
    });

    return { status: 'spawned', binary: grokBin, model: targetModel };
  } catch (err) {
    console.error('[Grok Desktop] Error executing grok binary:', err);
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
