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

  // Load active workspace path
  if (window.grokAPI) {
    window.grokAPI.getCurrentWorkspace().then(path => {
      if (path) workspacePathEl.textContent = path;
    });

    btnChangeWorkspace.addEventListener('click', async () => {
      const selected = await window.grokAPI.selectWorkspace();
      if (selected) workspacePathEl.textContent = selected;
    });

    // Listen to agent stdout/stderr
    window.grokAPI.onAgentStdout((text) => {
      handleAgentOutput(text);
    });

    window.grokAPI.onAgentStderr((text) => {
      handleAgentLog('stderr', text);
    });

    window.grokAPI.onAgentStatus(({ active }) => {
      if (active) {
        setAgentStatus('ready', 'Agent Ready');
      } else {
        setAgentStatus('thinking', 'Agent Reconnecting...');
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

    // Remove welcome card if present
    const welcomeCard = chatStream.querySelector('.welcome-card');
    if (welcomeCard) welcomeCard.remove();

    // Render User message
    appendUserMessage(text);
    promptInput.value = '';
    promptInput.style.height = 'auto';

    setAgentStatus('thinking', 'Agent Thinking...');

    // Send via API
    if (window.grokAPI) {
      window.grokAPI.sendPrompt({
        prompt: text,
        model: modelSelect.value,
      }).then(res => {
        if (res.status === 'bridge_mode') {
          // Desktop Bridge Mode (Simulated ACP response stream for UI validation)
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

  function handleAgentLog(type, text) {
    console.log(`[Agent ${type}]`, text);
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

  function setAgentStatus(state, label) {
    statusDot.className = `status-dot ${state}`;
    statusText.textContent = label;
  }

  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
});
