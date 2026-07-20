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

  // Process Logs Drawer
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
  let activeAgentBubble = null;

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

    // Listen to real grok.exe stdout/stderr
    window.grokAPI.onAgentStdout((text) => {
      logTerminal(stripAnsi(text));
    });

    window.grokAPI.onAgentStderr((text) => {
      logTerminal(stripAnsi(text));
    });

    window.grokAPI.onAgentStatus(({ active, code }) => {
      setAgentStatus('ready', 'Agent Sandboxed');
      logTerminal(`[Status] Process finished with exit code ${code}`);
      activeAgentBubble = null;
    });

    window.grokAPI.onAgentAcpEvent((msg) => {
      handleAcpEvent(msg);
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
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
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
    activeAgentBubble = null;
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
    activeAgentBubble = null;

    setAgentStatus('thinking', 'Agent Thinking...');
    logTerminal(`[Prompt] Executing sandboxed grok.exe -p "${text}"`);

    if (window.grokAPI) {
      window.grokAPI.sendPrompt({
        prompt: text,
        model: modelSelect.value,
      }).then(res => {
        if (res.binary) {
          logTerminal(`[Agent Subprocess] Sandboxed binary: ${res.binary} (Workspace: ${res.workspace})`);
        }
      });
    }
  }

  function handleAcpEvent(msg) {
    if (!msg) return;

    // Filter tracing logs
    if (typeof msg === 'string' && (msg.includes('\u001b') || msg.includes('INFO') || msg.includes('timing'))) {
      logTerminal(stripAnsi(msg));
      return;
    }

    // Handle real x.AI API Error / Usage Limit
    if (msg.type === 'error' || msg.message) {
      const errMsg = msg.message || JSON.stringify(msg);
      if (!errMsg.includes('INFO') && !errMsg.includes('timing')) {
        appendErrorMessage(errMsg);
      } else {
        logTerminal(stripAnsi(errMsg));
      }
      setAgentStatus('ready', 'Agent Sandboxed');
      return;
    }

    // Handle Subagent Invocation Event
    if (msg.type === 'subagent_start' || msg.type === 'invoke_subagent' || msg.subagent) {
      appendSubagentCard(msg.subagent || 'Subagent Worker', msg.prompt || msg.role || 'Executing subagent task...');
      return;
    }

    // Handle Tool Execution Event
    if (msg.type === 'tool_call' || msg.tool) {
      appendToolCard(msg.tool || 'system_tool', msg.output || msg.input || 'Executing tool...');
      return;
    }

    // Handle Agent Message / Stream Text
    let textChunk = "";
    if (typeof msg === 'string') {
      textChunk = msg;
    } else if (msg.text) {
      textChunk = msg.text;
    } else if (msg.delta) {
      textChunk = msg.delta;
    } else if (msg.result && msg.result.text) {
      textChunk = msg.result.text;
    }

    if (textChunk && !textChunk.includes('timing') && !textChunk.includes('\u001b')) {
      appendToActiveAgentMessage(textChunk);
    }
  }

  function appendUserMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message user';
    msgDiv.innerHTML = `<div class="message-body">${escapeHTML(text)}</div>`;
    chatStream.appendChild(msgDiv);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendToActiveAgentMessage(text) {
    if (!activeAgentBubble) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message agent';
      msgDiv.innerHTML = `<div class="message-body"></div>`;
      chatStream.appendChild(msgDiv);
      activeAgentBubble = msgDiv.querySelector('.message-body');
    }
    activeAgentBubble.innerHTML += formatMarkdown(text);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendErrorMessage(errorText) {
    const card = document.createElement('div');
    card.className = 'tool-card error';
    card.innerHTML = `
      <div class="tool-header" style="color: #ef4444;">
        ⚠️ <span>Grok Engine Status</span>
      </div>
      <div class="tool-output">${escapeHTML(stripAnsi(errorText))}</div>
    `;
    chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendSubagentCard(roleName, promptText) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.style.borderColor = 'rgba(139, 92, 246, 0.4)';
    card.style.background = 'rgba(139, 92, 246, 0.08)';
    card.innerHTML = `
      <div class="tool-header" style="color: #a78bfa;">
        🤖 <span>Subagent Spawned: ${escapeHTML(roleName)}</span>
      </div>
      <div class="tool-output">${escapeHTML(stripAnsi(promptText))}</div>
    `;
    chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendToolCard(toolName, outputText) {
    const toolIcons = {
      grep_search: '🔍',
      read_file: '📄',
      write_to_file: '✏️',
      execute_command: '🐚',
      git: '📦',
    };
    const icon = toolIcons[toolName] || '🛠️';

    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-header">
        <span>${icon} Tool Call: ${escapeHTML(toolName)}</span>
      </div>
      <div class="tool-output">${escapeHTML(stripAnsi(outputText))}</div>
    `;
    chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function logTerminal(msg) {
    if (!msg || !msg.trim()) return;
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${stripAnsi(msg.trim())}`;
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

  function stripAnsi(str) {
    return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
  }

  function formatMarkdown(str) {
    return escapeHTML(str)
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  }
});
