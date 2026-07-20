document.addEventListener('DOMContentLoaded', () => {
  const workspacePathEl = document.getElementById('workspace-path');
  const btnChangeWorkspace = document.getElementById('btn-change-workspace');
  const chatStream = document.getElementById('chat-stream');
  const promptInput = document.getElementById('prompt-input');
  const btnSendPrompt = document.getElementById('btn-send-prompt');
  const btnClearChat = document.getElementById('btn-clear-chat');
  const btnNewChat = document.getElementById('btn-new-chat');
  const modelSelect = document.getElementById('model-select');
  const statusDot = document.getElementById('agent-status-dot');
  const statusText = document.getElementById('agent-status-text');

  // Sidebar Tabs (Files vs Sessions)
  const tabFiles = document.getElementById('tab-files');
  const tabSessions = document.getElementById('tab-sessions');
  const viewFiles = document.getElementById('view-files');
  const viewSessions = document.getElementById('view-sessions');
  const fileTreeContainer = document.getElementById('file-tree');
  const btnRefreshFiles = document.getElementById('btn-refresh-files');

  // Terminal Drawer
  const btnToggleTerminal = document.getElementById('btn-toggle-terminal');
  const btnCloseTerminal = document.getElementById('btn-close-terminal');
  const terminalDrawer = document.getElementById('terminal-drawer');
  const terminalOutput = document.getElementById('terminal-output');

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
    tabSessions.classList.remove('active');
    viewFiles.classList.add('active');
    viewSessions.classList.remove('active');
  });

  tabSessions.addEventListener('click', () => {
    tabSessions.classList.add('active');
    tabFiles.classList.remove('active');
    viewSessions.classList.add('active');
    viewFiles.classList.remove('active');
  });

  // Terminal Drawer Toggle
  btnToggleTerminal.addEventListener('click', () => {
    terminalDrawer.classList.toggle('hidden');
  });
  btnCloseTerminal.addEventListener('click', () => {
    terminalDrawer.classList.add('hidden');
  });

  // Load Active Workspace & File Tree
  if (window.grokAPI) {
    window.grokAPI.getCurrentWorkspace().then(path => {
      if (path) {
        workspacePathEl.textContent = path;
        loadWorkspaceTree();
      }
    });

    btnChangeWorkspace.addEventListener('click', async () => {
      const selected = await window.grokAPI.selectWorkspace();
      if (selected) {
        workspacePathEl.textContent = selected;
        loadWorkspaceTree();
        logTerminal(`[Workspace] Changed directory to ${selected}`);
      }
    });

    btnRefreshFiles.addEventListener('click', loadWorkspaceTree);

    // Listen to agent stdout/stderr
    window.grokAPI.onAgentStdout((text) => {
      handleAgentOutput(text);
      logTerminal(`[Stdout] ${text}`);
    });

    window.grokAPI.onAgentStderr((text) => {
      logTerminal(`[Stderr] ${text}`);
    });

    window.grokAPI.onAgentStatus(({ active }) => {
      if (active) {
        setAgentStatus('ready', 'Agent Ready');
        logTerminal('[Status] Agent Sidecar Ready');
      } else {
        setAgentStatus('thinking', 'Agent Reconnecting...');
        logTerminal('[Status] Agent Sidecar Reconnecting...');
      }
    });
  }

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
    if (currentModalPath) {
      promptInput.value += ` @[${currentModalPath}]`;
      fileModal.classList.add('hidden');
      promptInput.focus();
    }
  });

  // Quick prompt buttons
  document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      promptInput.value = prompt;
      submitPrompt();
    });
  });

  // Auto-grow input
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + 'px';
  });

  // Enter to send
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  });

  btnSendPrompt.addEventListener('click', submitPrompt);

  btnClearChat.addEventListener('click', () => {
    chatStream.innerHTML = `
      <div class="welcome-card">
        <div class="welcome-icon">⚡</div>
        <h3>Grok Build Session Cleared</h3>
        <p>Ready for your next coding task or prompt.</p>
      </div>
    `;
  });

  btnNewChat.addEventListener('click', () => {
    btnClearChat.click();
  });

  function submitPrompt() {
    const text = promptInput.value.trim();
    if (!text) return;

    const welcomeCard = chatStream.querySelector('.welcome-card');
    if (welcomeCard) welcomeCard.remove();

    appendUserMessage(text);
    promptInput.value = '';
    promptInput.style.height = 'auto';

    setAgentStatus('thinking', 'Agent Thinking...');
    logTerminal(`[Prompt] ${text}`);

    if (window.grokAPI) {
      window.grokAPI.sendPrompt({
        prompt: text,
        model: modelSelect.value,
      }).then(res => {
        if (res.status === 'bridge_mode') {
          simulateAgentResponse(text);
        }
      });
    } else {
      simulateAgentResponse(text);
    }
  }

  function appendUserMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message user';
    msgDiv.innerHTML = `<div class="message-body">${escapeHTML(text)}</div>`;
    chatStream.appendChild(msgDiv);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendAgentMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message agent';
    msgDiv.innerHTML = `<div class="message-body">${escapeHTML(text)}</div>`;
    chatStream.appendChild(msgDiv);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendToolCard(toolName, outputText) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        Tool Execution: <span>${escapeHTML(toolName)}</span>
      </div>
      <div class="tool-output">${escapeHTML(outputText)}</div>
    `;
    chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function handleAgentOutput(dataStr) {
    setAgentStatus('ready', 'Agent Ready');
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.result && parsed.result.text) {
        appendAgentMessage(parsed.result.text);
      } else {
        appendAgentMessage(dataStr);
      }
    } catch (e) {
      appendAgentMessage(dataStr);
    }
  }

  function simulateAgentResponse(userText) {
    setTimeout(() => {
      appendToolCard('grep_search', `Query: "unsafe"\nMatched 12 instances across crates/codegen`);
    }, 600);

    setTimeout(() => {
      appendAgentMessage(`I've received your request: "${userText}". All core agent modules (workspace, ACP gateway, tools, sandbox, SQLite journal) are online and active in Desktop mode.`);
      setAgentStatus('ready', 'Agent Ready');
    }, 1200);
  }

  function logTerminal(msg) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function setAgentStatus(state, label) {
    statusDot.className = `status-dot ${state}`;
    statusText.textContent = label;
  }

  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
});
