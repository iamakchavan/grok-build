document.addEventListener('DOMContentLoaded', () => {
  const workspacePathEl = document.getElementById('workspace-path');
  const btnChangeWorkspace = document.getElementById('btn-change-workspace');
  const promptInput = document.getElementById('prompt-input');
  const btnSendPrompt = document.getElementById('btn-send-prompt');
  const btnNewChat = document.getElementById('btn-new-chat');
  const btnRestartPty = document.getElementById('btn-restart-pty');
  const statusDot = document.getElementById('agent-status-dot');
  const statusText = document.getElementById('agent-status-text');

  // Sidebar Tabs (Files vs Quick Actions)
  const tabFiles = document.getElementById('tab-files');
  const tabQuick = document.getElementById('tab-quick');
  const viewFiles = document.getElementById('view-files');
  const viewQuick = document.getElementById('view-quick');
  const fileTreeContainer = document.getElementById('file-tree');
  const btnRefreshFiles = document.getElementById('btn-refresh-files');

  // File Preview Modal
  const fileModal = document.getElementById('file-modal');
  const modalFileTitle = document.getElementById('modal-file-title');
  const modalFileBody = document.getElementById('modal-file-body');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnAttachFile = document.getElementById('btn-attach-file');
  let currentModalPath = '';

  // Tab Switching
  tabFiles.addEventListener('click', () => {
    tabFiles.classList.add('active');
    tabQuick.classList.remove('active');
    viewFiles.classList.add('active');
    viewQuick.classList.remove('active');
  });

  tabQuick.addEventListener('click', () => {
    tabQuick.classList.add('active');
    tabFiles.classList.remove('active');
    viewQuick.classList.add('active');
    viewFiles.classList.remove('active');
  });

  // Initialize Xterm.js Terminal
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 14,
    cursorBlink: true,
    theme: {
      background: '#0d0f17',
      foreground: '#e2e8f0',
      cursor: '#8b5cf6',
      selectionBackground: '#2d314e',
      black: '#1e2136',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#ffffff',
    }
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const xtermContainer = document.getElementById('xterm-view');
  term.open(xtermContainer);
  fitAddon.fit();

  window.addEventListener('resize', () => {
    fitAddon.fit();
    if (window.grokAPI) {
      window.grokAPI.resizePty({ cols: term.cols, rows: term.rows });
    }
  });

  // Bi-directional PTY data streams
  term.onData(data => {
    if (window.grokAPI) {
      window.grokAPI.writePty(data);
    }
  });

  if (window.grokAPI) {
    window.grokAPI.onPtyData(data => {
      term.write(data);
    });

    window.grokAPI.onPtyReady(({ binary, workspace }) => {
      setAgentStatus('ready', 'Grok TUI Active');
      workspacePathEl.textContent = workspace;
      loadWorkspaceTree();
    });

    window.grokAPI.onPtyExit(code => {
      term.write(`\r\n\x1b[33m[Grok Desktop] Process exited with code ${code}. Click Restart Agent to launch again.\x1b[0m\r\n`);
    });

    window.grokAPI.getCurrentWorkspace().then(path => {
      if (path) {
        workspacePathEl.textContent = path;
        loadWorkspaceTree();
      }
    });

    // Initialize PTY session
    window.grokAPI.initPty({ cols: term.cols, rows: term.rows });
  }

  // Workspace Folder Picker
  btnChangeWorkspace.addEventListener('click', async () => {
    if (window.grokAPI) {
      const selected = await window.grokAPI.selectWorkspace();
      if (selected) {
        workspacePathEl.textContent = selected;
        loadWorkspaceTree();
      }
    }
  });

  btnRefreshFiles.addEventListener('click', loadWorkspaceTree);
  btnRestartPty.addEventListener('click', () => {
    if (window.grokAPI) {
      term.clear();
      window.grokAPI.initPty({ cols: term.cols, rows: term.rows });
    }
  });
  btnNewChat.addEventListener('click', () => {
    btnRestartPty.click();
  });

  // Prompt Send Bar
  function sendPromptToTui() {
    const text = promptInput.value.trim();
    if (!text) return;
    if (window.grokAPI) {
      window.grokAPI.sendCommand(text);
    }
    promptInput.value = '';
    promptInput.style.height = 'auto';
    term.focus();
  }

  btnSendPrompt.addEventListener('click', sendPromptToTui);

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPromptToTui();
    }
  });

  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  });

  // Quick Action buttons
  document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (window.grokAPI) {
        window.grokAPI.sendCommand(cmd);
        term.focus();
      }
    });
  });

  // File Tree Explorer
  async function loadWorkspaceTree() {
    fileTreeContainer.innerHTML = '<li class="file-tree-loading">Scanning files...</li>';
    if (!window.grokAPI) return;
    const tree = await window.grokAPI.readWorkspaceTree();
    renderTree(tree, fileTreeContainer);
  }

  function renderTree(nodes, parentEl) {
    parentEl.innerHTML = '';
    if (!nodes || nodes.length === 0) {
      parentEl.innerHTML = '<li class="file-tree-loading">No files found</li>';
      return;
    }

    nodes.sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0));

    nodes.forEach(node => {
      const li = document.createElement('li');
      const nodeEl = document.createElement('div');
      nodeEl.className = `tree-node ${node.isDir ? 'dir' : 'file'}`;
      
      const icon = node.isDir ? '📁' : '📄';
      nodeEl.innerHTML = `<span>${icon}</span> <span>${escapeHTML(node.name)}</span>`;

      if (node.isDir) {
        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children hidden';
        if (node.children) {
          renderTree(node.children, childrenUl);
        }
        nodeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          childrenUl.classList.toggle('hidden');
        });
        li.appendChild(nodeEl);
        li.appendChild(childrenUl);
      } else {
        nodeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openFileModal(node.path, node.name);
        });
        li.appendChild(nodeEl);
      }
      parentEl.appendChild(li);
    });
  }

  async function openFileModal(filePath, fileName) {
    currentModalPath = filePath;
    modalFileTitle.textContent = fileName;
    modalFileBody.textContent = 'Loading content...';
    fileModal.classList.remove('hidden');

    if (window.grokAPI) {
      const res = await window.grokAPI.readWorkspaceFile(filePath);
      if (res.success) {
        modalFileBody.textContent = res.content;
      } else {
        modalFileBody.textContent = `Error reading file: ${res.error}`;
      }
    }
  }

  btnCloseModal.addEventListener('click', () => {
    fileModal.classList.add('hidden');
  });

  btnAttachFile.addEventListener('click', () => {
    if (currentModalPath && window.grokAPI) {
      window.grokAPI.writePty(` ${currentModalPath}`);
      fileModal.classList.add('hidden');
      term.focus();
    }
  });

  function setAgentStatus(state, label) {
    statusDot.className = `status-dot ${state}`;
    statusText.textContent = label;
  }

  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
});
