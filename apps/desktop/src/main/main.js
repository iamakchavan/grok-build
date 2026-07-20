const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');

let mainWindow = null;
let currentWorkspace = process.cwd();
let ptyProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1350,
    height: 900,
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
    killPtyProcess();
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

function spawnPtyProcess(cols = 120, rows = 35) {
  killPtyProcess();

  const grokBin = findSystemGrokBinary();
  console.log(`[Grok Desktop PTY] Spawing real Grok TUI at: ${grokBin} (cwd: ${currentWorkspace})`);

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const repoRoot = path.join(__dirname, '../../../');

  try {
    // If system grok binary exists, launch it directly in PTY
    if (fs.existsSync(grokBin)) {
      ptyProcess = pty.spawn(grokBin, [], {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: currentWorkspace,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      });
    } else {
      // Fall back to cargo run
      ptyProcess = pty.spawn('cargo', ['run', '-p', 'xai-grok-pager-bin'], {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: repoRoot,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      });
    }

    ptyProcess.onData((data) => {
      if (mainWindow) {
        mainWindow.webContents.send('pty:data', data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[Grok Desktop PTY] Process exited with code ${exitCode}`);
      ptyProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('pty:exit', exitCode);
      }
    });

    if (mainWindow) {
      mainWindow.webContents.send('pty:ready', { binary: grokBin, workspace: currentWorkspace });
    }
  } catch (err) {
    console.error('[Grok Desktop PTY] Failed to spawn PTY:', err);
  }
}

function killPtyProcess() {
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {
      // ignore
    }
    ptyProcess = null;
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
ipcMain.handle('pty:init', (event, { cols, rows }) => {
  spawnPtyProcess(cols, rows);
  return { status: 'spawned' };
});

ipcMain.handle('pty:write', (event, data) => {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

ipcMain.handle('pty:resize', (event, { cols, rows }) => {
  if (ptyProcess) {
    try {
      ptyProcess.resize(cols, rows);
    } catch (e) {
      // ignore
    }
  }
});

ipcMain.handle('workspace:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Workspace Directory',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    currentWorkspace = result.filePaths[0];
    spawnPtyProcess();
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

ipcMain.handle('agent:send-command', (event, commandStr) => {
  if (ptyProcess) {
    ptyProcess.write(commandStr + '\r');
  } else {
    spawnPtyProcess();
    setTimeout(() => {
      if (ptyProcess) ptyProcess.write(commandStr + '\r');
    }, 1000);
  }
});
