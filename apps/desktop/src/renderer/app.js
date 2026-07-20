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

  // Sidebar Tabs
  const tabFiles = document.getElementById('tab-files');
  const tabSessions = document.getElementById('tab-sessions');
  const viewFiles = document.getElementById('view-files');
  const viewSessions = document.getElementById('view-sessions');
  const fileTreeContainer = document.getElementById('file-tree');
  const sessionsList = document.getElementById('sessions-list');
  const btnRefreshFiles = document.getElementById('btn-refresh-files');
  const btnRefreshSessions = document.getElementById('btn-refresh-sessions');

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

  // Autocomplete Popup Elements
  const autocompletePopup = document.getElementById('autocomplete-popup');
  const popupTitle = document.getElementById('popup-title');
  const popupList = document.getElementById('popup-list');
  const hintAt = document.getElementById('hint-at');
  const hintSlash = document.getElementById('hint-slash');

  let currentModalPath = '';
  let activeAgentBubble = null;
  let cachedFilePaths = [];
  let popupActiveIndex = 0;
  let currentAutocompleteMode = null;
  let currentTriggerIndex = -1;
  let currentActiveSessionId = null;

  // Slash commands registry matching TUI
  const slashCommands = [
    { cmd: '/goal', desc: 'Run autonomous agent goal loop' },
    { cmd: '/plan', desc: 'Generate step-by-step task execution plan' },
    { cmd: '/schedule', desc: 'Set one-shot timer or recurring cron schedule' },
    { cmd: '/grill-me', desc: 'Interactive interview to resolve design decisions' },
    { cmd: '/teamwork-preview', desc: 'Launch multi-agent teamwork preview' },
    { cmd: '/learn', desc: 'Persist workflow behavior & instructions' },
    { cmd: '/clear', desc: 'Clear chat session stream' }
  ];

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
    loadSavedSessions();
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
        loadSavedSessions();
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
    if (btnRefreshSessions) {
      btnRefreshSessions.addEventListener('click', loadSavedSessions);
    }

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

  // Load Real Grok Sessions from System Store
  async function loadSavedSessions() {
    if (!window.grokAPI || !sessionsList) return;
    sessionsList.innerHTML = '<li class="session-item">Loading Grok sessions...</li>';

    const sessions = await window.grokAPI.listSessions();
    sessionsList.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      sessionsList.innerHTML = '<li class="session-item">No saved sessions found</li>';
      return;
    }

    sessions.forEach(sess => {
      const li = document.createElement('li');
      li.className = `session-item ${sess.id === currentActiveSessionId ? 'active' : ''}`;
      li.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <div style="display: flex; flex-direction: column; overflow: hidden;">
          <span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(sess.summary)}</span>
          <span style="font-size: 0.68rem; color: var(--text-dim);">${sess.created} • ${sess.id.slice(0, 8)}...</span>
        </div>
      `;

      li.addEventListener('click', async () => {
        currentActiveSessionId = sess.id;
        document.querySelectorAll('.session-item').forEach(item => item.classList.remove('active'));
        li.classList.add('active');

        logTerminal(`[Sessions] Exporting transcript for session ${sess.id}...`);
        const res = await window.grokAPI.exportSession(sess.id);
        if (res.success) {
          chatStream.innerHTML = '';
          appendAgentMessage(`### Resumed Session: **${sess.summary}**\n\`ID: ${sess.id}\``);
          if (res.transcript) {
            renderParsedTranscript(res.transcript);
          }
        }
      });

      sessionsList.appendChild(li);
    });
  }

  async function loadWorkspaceTree() {
    fileTreeContainer.innerHTML = '<li class="file-tree-loading">Scanning files...</li>';
    if (!window.grokAPI) return;
    const tree = await window.grokAPI.readWorkspaceTree();
    cachedFilePaths = [];
    flattenPaths(tree, cachedFilePaths);
    renderTree(tree, fileTreeContainer);
  }

  function flattenPaths(nodes, acc) {
    if (!nodes) return;
    nodes.forEach(node => {
      acc.push({ name: node.name, path: node.path, isDir: node.isDir });
      if (node.children) {
        flattenPaths(node.children, acc);
      }
    });
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

  // Autocomplete Engine (@ and / triggers)
  hintAt.addEventListener('click', () => {
    promptInput.value += ' @';
    promptInput.focus();
    checkAutocomplete();
  });

  hintSlash.addEventListener('click', () => {
    promptInput.value = '/';
    promptInput.focus();
    checkAutocomplete();
  });

  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
    checkAutocomplete();
  });

  function checkAutocomplete() {
    const val = promptInput.value;
    const caret = promptInput.selectionStart;
    const textBeforeCaret = val.slice(0, caret);

    const lastSlashIndex = textBeforeCaret.lastIndexOf('/');
    const lastAtIndex = textBeforeCaret.lastIndexOf('@');

    if (lastSlashIndex !== -1 && (lastSlashIndex === 0 || textBeforeCaret[lastSlashIndex - 1] === ' ' || textBeforeCaret[lastSlashIndex - 1] === '\n')) {
      const query = textBeforeCaret.slice(lastSlashIndex + 1).toLowerCase();
      showSlashAutocomplete(query, lastSlashIndex);
    } else if (lastAtIndex !== -1 && (lastAtIndex === 0 || textBeforeCaret[lastAtIndex - 1] === ' ' || textBeforeCaret[lastAtIndex - 1] === '\n')) {
      const query = textBeforeCaret.slice(lastAtIndex + 1).toLowerCase();
      showAtAutocomplete(query, lastAtIndex);
    } else {
      hideAutocomplete();
    }
  }

  function showSlashAutocomplete(query, triggerIdx) {
    currentAutocompleteMode = 'slash';
    currentTriggerIndex = triggerIdx;
    popupTitle.textContent = 'Slash Commands';

    const matches = slashCommands.filter(item => item.cmd.toLowerCase().includes(query) || item.desc.toLowerCase().includes(query));

    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    popupActiveIndex = 0;
    renderPopupItems(matches.map(m => ({
      icon: '⚡',
      label: m.cmd,
      desc: m.desc,
      value: m.cmd + ' '
    })));
  }

  function showAtAutocomplete(query, triggerIdx) {
    currentAutocompleteMode = 'at';
    currentTriggerIndex = triggerIdx;
    popupTitle.textContent = 'Workspace Files & Folders (@)';

    const matches = cachedFilePaths.filter(item => item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query));

    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    popupActiveIndex = 0;
    renderPopupItems(matches.slice(0, 10).map(m => ({
      icon: m.isDir ? '📁' : '📄',
      label: m.name,
      desc: m.path,
      value: `@[${m.path}] `
    })));
  }

  function renderPopupItems(items) {
    popupList.innerHTML = '';
    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = `popup-item ${index === popupActiveIndex ? 'active' : ''}`;
      li.innerHTML = `
        <span class="item-icon">${item.icon}</span>
        <span class="item-label">${escapeHTML(item.label)}</span>
        <span class="item-desc">${escapeHTML(item.desc)}</span>
      `;
      li.addEventListener('click', () => {
        applyAutocompleteChoice(item.value);
      });
      popupList.appendChild(li);
    });
    autocompletePopup.classList.remove('hidden');
  }

  function applyAutocompleteChoice(choiceValue) {
    const val = promptInput.value;
    const before = val.slice(0, currentTriggerIndex);
    const after = val.slice(promptInput.selectionStart);
    promptInput.value = before + choiceValue + after;
    hideAutocomplete();
    promptInput.focus();
  }

  function hideAutocomplete() {
    autocompletePopup.classList.add('hidden');
    currentAutocompleteMode = null;
    currentTriggerIndex = -1;
  }

  // Keyboard Navigation for Autocomplete & Enter to send
  promptInput.addEventListener('keydown', (e) => {
    if (!autocompletePopup.classList.contains('hidden')) {
      const items = popupList.querySelectorAll('.popup-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        popupActiveIndex = (popupActiveIndex + 1) % items.length;
        updatePopupHighlight(items);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        popupActiveIndex = (popupActiveIndex - 1 + items.length) % items.length;
        updatePopupHighlight(items);
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const activeEl = items[popupActiveIndex];
        if (activeEl) {
          activeEl.click();
        }
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  });

  function updatePopupHighlight(items) {
    items.forEach((item, idx) => {
      if (idx === popupActiveIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  // Quick prompt buttons
  document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      promptInput.value = prompt;
      submitPrompt();
    });
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
    currentActiveSessionId = null;
    if (window.grokAPI) {
      window.grokAPI.newSession();
    }
    btnClearChat.click();
    loadSavedSessions();
  });

  function submitPrompt() {
    hideAutocomplete();
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
        sessionId: currentActiveSessionId,
      }).then(res => {
        if (res.binary) {
          logTerminal(`[Agent Subprocess] Sandboxed binary: ${res.binary} (Session: ${res.sessionId || 'NEW'})`);
          setTimeout(loadSavedSessions, 3000);
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

  function renderParsedTranscript(transcriptText) {
    const lines = transcriptText.split('\n');
    let currentRole = null;
    let buffer = [];
    let isToolSection = false;

    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('## User')) {
        if (buffer.length > 0) flushTranscriptBlock(currentRole, buffer, isToolSection);
        currentRole = 'user';
        buffer = [];
        isToolSection = false;
      } else if (line.startsWith('## Assistant')) {
        if (buffer.length > 0) flushTranscriptBlock(currentRole, buffer, isToolSection);
        currentRole = 'agent';
        buffer = [];
        isToolSection = false;
      } else if (line.startsWith('## Tools')) {
        if (buffer.length > 0) flushTranscriptBlock(currentRole, buffer, isToolSection);
        currentRole = 'tools';
        buffer = [];
        isToolSection = true;
      } else {
        if (line) buffer.push(line);
      }
    }
    if (buffer.length > 0) flushTranscriptBlock(currentRole, buffer, isToolSection);
  }

  function flushTranscriptBlock(role, lines, isTool) {
    const text = lines.join('\n');
    if (!text.trim()) return;

    if (role === 'user') {
      appendUserMessage(text);
    } else if (role === 'tools' || isTool) {
      // Parse individual tool calls into graphical UI cards
      lines.forEach(l => {
        if (l.startsWith('- Read:')) {
          appendToolCard('read_file', l.replace('- Read:', '').trim());
        } else if (l.startsWith('- Search:')) {
          appendToolCard('grep_search', l.replace('- Search:', '').trim());
        } else if (l.startsWith('- Execute:')) {
          appendToolCard('execute_command', l.replace('- Execute:', '').trim());
        } else if (l.startsWith('- ListDir:')) {
          appendToolCard('read_tree', l.replace('- ListDir:', '').trim());
        } else if (l.startsWith('- Edit:')) {
          appendDiffCard('Modified Code File', l.replace('- Edit:', '').trim());
        } else {
          appendToolCard('tool_call', l.replace(/^- /, ''));
        }
      });
    } else {
      appendAgentMessage(text);
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
    msgDiv.innerHTML = `<div class="message-body">${formatMarkdown(text)}</div>`;
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
        ⚠️ <span>Grok Engine Notice</span>
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
      read_tree: '📁',
      write_to_file: '✏️',
      execute_command: '🐚',
      git: '📦',
    };
    const icon = toolIcons[toolName] || '🛠️';

    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-header">
        <span>${icon} Tool Execution: ${escapeHTML(toolName)}</span>
        <span style="font-size: 0.7rem; color: var(--accent-green);">● Active</span>
      </div>
      <div class="tool-output">${escapeHTML(stripAnsi(outputText))}</div>
    `;
    chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  function appendDiffCard(filePath, diffContent) {
    const card = document.createElement('div');
    card.className = 'diff-card';
    
    const lines = diffContent.split('\n');
    let diffLinesHtml = '';

    lines.forEach(l => {
      if (l.startsWith('+')) {
        diffLinesHtml += `<div class="diff-line add">${escapeHTML(l)}</div>`;
      } else if (l.startsWith('-')) {
        diffLinesHtml += `<div class="diff-line del">${escapeHTML(l)}</div>`;
      } else if (l.startsWith('@@')) {
        diffLinesHtml += `<div class="diff-line info">${escapeHTML(l)}</div>`;
      } else {
        diffLinesHtml += `<div class="diff-line">${escapeHTML(l)}</div>`;
      }
    });

    card.innerHTML = `
      <div class="diff-header">
        <span>✏️ Code Modification: ${escapeHTML(filePath)}</span>
        <span style="font-size: 0.72rem; color: #34d399;">Diff View</span>
      </div>
      <div class="diff-body">${diffLinesHtml || `<div class="diff-line">${escapeHTML(diffContent)}</div>`}</div>
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

  // Full GFM Markdown Parser (Tables, Headings, Codeblocks, Lists)
  function formatMarkdown(rawText) {
    if (!rawText) return '';
    const cleanText = stripAnsi(rawText);

    const lines = cleanText.split('\n');
    let html = '';
    let inTable = false;
    let tableHeaderDone = false;
    let tableRows = [];
    let inCodeBlock = false;
    let codeBlockBuffer = [];

    lines.forEach(line => {
      // Codeblocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          html += `<pre class="md-codeblock"><code>${escapeHTML(codeBlockBuffer.join('\n'))}</code></pre>`;
          codeBlockBuffer = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeBlockBuffer = [];
        }
        return;
      }

      if (inCodeBlock) {
        codeBlockBuffer.push(line);
        return;
      }

      // Markdown Tables
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableHeaderDone = false;
          tableRows = [];
        }
        
        // Skip separator line |---|---|
        if (line.includes('---')) {
          tableHeaderDone = true;
          return;
        }

        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        tableRows.push({ isHeader: !tableHeaderDone, cells });
        return;
      } else if (inTable) {
        // Close table
        html += renderHtmlTable(tableRows);
        inTable = false;
        tableRows = [];
      }

      // Headings
      if (line.startsWith('# ')) {
        html += `<h1 class="md-h1">${parseInlineStyles(line.slice(2))}</h1>`;
      } else if (line.startsWith('## ')) {
        html += `<h2 class="md-h2">${parseInlineStyles(line.slice(3))}</h2>`;
      } else if (line.startsWith('### ')) {
        html += `<h3 class="md-h3">${parseInlineStyles(line.slice(4))}</h3>`;
      } else if (line.trim() === '---' || line.trim() === '***') {
        html += `<hr class="md-hr">`;
      } else if (line.trim().startsWith('- ')) {
        html += `<li class="md-li">${parseInlineStyles(line.trim().slice(2))}</li>`;
      } else if (line.trim().startsWith('* ')) {
        html += `<li class="md-li">${parseInlineStyles(line.trim().slice(2))}</li>`;
      } else if (line.trim() !== '') {
        html += `<div>${parseInlineStyles(line)}</div>`;
      } else {
        html += `<br>`;
      }
    });

    if (inTable && tableRows.length > 0) {
      html += renderHtmlTable(tableRows);
    }

    if (inCodeBlock && codeBlockBuffer.length > 0) {
      html += `<pre class="md-codeblock"><code>${escapeHTML(codeBlockBuffer.join('\n'))}</code></pre>`;
    }

    return html;
  }

  function renderHtmlTable(rows) {
    let tHtml = '<div class="md-table-wrapper"><table class="md-table">';
    let hasThead = false;

    rows.forEach(r => {
      if (r.isHeader) {
        if (!hasThead) {
          tHtml += '<thead><tr>';
          r.cells.forEach(c => { tHtml += `<th>${parseInlineStyles(c)}</th>`; });
          tHtml += '</tr></thead><tbody>';
          hasThead = true;
        }
      } else {
        tHtml += '<tr>';
        r.cells.forEach(c => { tHtml += `<td>${parseInlineStyles(c)}</td>`; });
        tHtml += '</tr>';
      }
    });

    if (hasThead) tHtml += '</tbody>';
    tHtml += '</table></div>';
    return tHtml;
  }

  function parseInlineStyles(str) {
    return escapeHTML(str)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="md-inline-code">$1</code>');
  }
});
