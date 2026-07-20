const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let agentProcess = null;
let currentWorkspace = process.cwd();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
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
    killAgentProcess();
  });
}

function findAgentBinary() {
  const possiblePaths = [
    path.join(__dirname, '../../../target/release/xai-grok-pager.exe'),
    path.join(__dirname, '../../../target/release/xai-grok-pager'),
    path.join(__dirname, '../../../target/debug/xai-grok-pager.exe'),
    path.join(__dirname, '../../../target/debug/xai-grok-pager'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function spawnAgentProcess() {
  let binCommand = findAgentBinary();
  let binArgs = ['--acp'];
  let repoRoot = path.join(__dirname, '../../../');

  if (!binCommand) {
    console.log('[Grok Desktop] No compiled binary in target/. Spawning Rust agent core via `cargo run -p xai-grok-pager-bin -- --acp`...');
    binCommand = 'cargo';
    binArgs = ['run', '-p', 'xai-grok-pager-bin', '--', '--acp'];
  } else {
    console.log(`[Grok Desktop] Spawning precompiled agent sidecar from: ${binCommand}`);
  }

  try {
    agentProcess = spawn(binCommand, binArgs, {
      cwd: currentWorkspace || repoRoot,
      env: { ...process.env, RUST_LOG: 'info' },
    });

    agentProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (mainWindow) {
        mainWindow.webContents.send('agent:stdout', text);
      }
    });

    agentProcess.stderr.on('data', (data) => {
      const text = data.toString();
      if (mainWindow) {
        mainWindow.webContents.send('agent:stderr', text);
      }
    });

    agentProcess.on('exit', (code) => {
      console.log(`[Grok Desktop] Agent process exited with code ${code}`);
      if (mainWindow) {
        mainWindow.webContents.send('agent:status', { active: false, code });
      }
    });
  } catch (err) {
    console.error('[Grok Desktop] Failed to spawn agent:', err);
  }
}

function killAgentProcess() {
  if (agentProcess) {
    try {
      agentProcess.kill();
    } catch (e) {
      // ignore
    }
    agentProcess = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  spawnAgentProcess();

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
    killAgentProcess();
    spawnAgentProcess();
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

ipcMain.handle('agent:send', async (event, { prompt, model }) => {
  if (agentProcess && agentProcess.stdin.writable) {
    const acpMessage = JSON.stringify({
      jsonrpc: "2.0",
      method: "agent/prompt",
      params: { prompt, model },
      id: Date.now(),
    }) + "\n";
    agentProcess.stdin.write(acpMessage);
    return { status: 'sent' };
  } else {
    // Return success event for bridge UI integration
    return { status: 'bridge_mode', prompt, model };
  }
});

ipcMain.handle('agent:cancel', async () => {
  if (agentProcess) {
    killAgentProcess();
    spawnAgentProcess();
    return { status: 'cancelled' };
  }
  return { status: 'idle' };
});
