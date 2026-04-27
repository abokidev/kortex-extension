const API_BASE = 'https://kodingo-api.onrender.com';

const TYPE_COLOURS = {
  decision: '#a78bfa',
  note: '#34d399',
  context: '#fb923c',
};

// ── State ─────────────────────────────────────────────────────────────────────
let currentTab = 'memory';
let projects = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const resultsEl = document.getElementById('results');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const qaMessages = document.getElementById('qaMessages');
const qaInput = document.getElementById('qaInput');
const qaBtn = document.getElementById('qaBtn');
const settingsPanel = document.getElementById('settingsPanel');
const loginPanel = document.getElementById('loginPanel');
const projectList = document.getElementById('projectList');
const contextBadge = document.getElementById('contextBadge');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const auth = await sendMessage({ type: 'GET_AUTH' });
  if (!auth.jwt) {
    loginPanel.classList.remove('hidden');
    return;
  }
  loginPanel.classList.add('hidden');
  const data = await sendMessage({ type: 'GET_PROJECTS' });
  projects = data.projects ?? [];
  renderProjects();
}

// ── Message bridge to background ──────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, response => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(response ?? {});
      });
    } catch (e) {
      // Fallback for when running as iframe — relay via parent
      window.parent.postMessage({ type: `KORTEX_${msg.type}`, ...msg }, '*');
      resolve({});
    }
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    document.getElementById(`tab-${currentTab}`).classList.add('active');
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
});
document.getElementById('closeSettings').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sendMessage({ type: 'LOGOUT' });
  location.reload();
});

// ── Close button ──────────────────────────────────────────────────────────────
document.getElementById('closeBtn').addEventListener('click', () => {
  window.parent.postMessage({ type: 'KORTEX_CLOSE' }, '*');
});

// ── Add project ───────────────────────────────────────────────────────────────
document.getElementById('addProjectBtn').addEventListener('click', async () => {
  const name = document.getElementById('projectName').value.trim();
  const token = document.getElementById('projectToken').value.trim();
  if (!name || !token) return;
  const res = await sendMessage({ type: 'ADD_PROJECT', name, token });
  if (res.error) { alert(res.error); return; }
  projects = res.projects ?? [];
  renderProjects();
  document.getElementById('projectName').value = '';
  document.getElementById('projectToken').value = '';
});

function renderProjects() {
  if (!projects.length) {
    projectList.innerHTML = '<p style="color:#4a5568;font-size:10px;padding:10px;">No projects added yet. Add a project token from your Kodingo dashboard.</p>';
    return;
  }
  projectList.innerHTML = projects.map(p => `
    <div class="project-item">
      <div>
        <div class="project-item-name">${p.name}</div>
        <div class="project-item-token">••••${p.token.slice(-6)}</div>
      </div>
      <button class="remove-btn" data-token="${p.token}">Remove</button>
    </div>
  `).join('');
  projectList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await sendMessage({ type: 'REMOVE_PROJECT', token: btn.dataset.token });
      projects = res.projects ?? [];
      renderProjects();
    });
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!email || !password) return;
  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Signing in...';
  btn.disabled = true;
  const res = await sendMessage({ type: 'LOGIN', email, password });
  btn.textContent = 'Sign in';
  btn.disabled = false;
  if (res.error) {
    errEl.textContent = res.error;
    errEl.classList.remove('hidden');
    return;
  }
  loginPanel.classList.add('hidden');
  init();
});

// ── Search ────────────────────────────────────────────────────────────────────
searchBtn.addEventListener('click', () => doSearch(searchInput.value));
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(searchInput.value); });

async function doSearch(query) {
  if (!query.trim()) return;
  resultsEl.innerHTML = '<div class="loading">Searching memory...</div>';
  const res = await sendMessage({ type: 'SEARCH', query: query.trim(), context: '', repo: '' });
  renderResults(res);
}

function renderResults(res) {
  if (res.limitReached) {
    resultsEl.innerHTML = `<div class="limit-msg">${res.error}<br/><a href="https://kodingo.xyz/dashboard/billing" target="_blank" style="color:#00C4FF;">Upgrade →</a></div>`;
    return;
  }
  if (res.error) {
    resultsEl.innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  const results = res.results ?? [];
  if (!results.length) {
    resultsEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No memories found.</p><p class="empty-sub">Try a different search term.</p></div>';
    return;
  }
  resultsEl.innerHTML = results.map(r => {
    const colour = TYPE_COLOURS[r.type] ?? '#7a909e';
    const conf = Math.round(r.confidence * 100);
    const confColour = conf >= 70 ? '#34d399' : conf >= 40 ? '#f59e0b' : '#FF4D4D';
    return `
      <div class="memory-card" data-id="${r.id}" data-token="${projects.find(p => p.token)?.token ?? ''}">
        <div class="card-meta">
          <span class="type-badge" style="color:${colour};background:${colour}18">${r.type}</span>
          ${r.symbol ? `<span class="card-symbol">${r.symbol}</span>` : ''}
          <span class="conf" style="color:${confColour}">${conf}%</span>
          <span class="project-name">${r.projectName}</span>
        </div>
        <div class="card-title">${r.title ?? 'Untitled'}</div>
        <div class="card-content">${r.content.slice(0, 120)}${r.content.length > 120 ? '…' : ''}</div>
        ${r.status === 'proposed' ? `
          <div class="card-actions">
            <button class="action-btn affirm-btn" data-id="${r.id}">✓ Affirm</button>
            <button class="action-btn deny-btn" data-id="${r.id}">✕ Deny</button>
          </div>` : ''}
      </div>`;
  }).join('');

  // Affirm/deny handlers
  resultsEl.querySelectorAll('.affirm-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const token = projects[0]?.token;
      if (!token) return;
      await sendMessage({ type: 'AFFIRM', token, memoryId: btn.dataset.id, status: 'affirmed' });
      btn.closest('.card-actions').innerHTML = '<span style="color:#34d399;font-size:9px;">✓ Affirmed</span>';
    });
  });
  resultsEl.querySelectorAll('.deny-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const token = projects[0]?.token;
      if (!token) return;
      await sendMessage({ type: 'AFFIRM', token, memoryId: btn.dataset.id, status: 'denied' });
      btn.closest('.card-actions').innerHTML = '<span style="color:#FF4D4D;font-size:9px;">✕ Denied</span>';
    });
  });
}

// ── Q&A ───────────────────────────────────────────────────────────────────────
qaBtn.addEventListener('click', () => doQA(qaInput.value));
qaInput.addEventListener('keydown', e => { if (e.key === 'Enter') doQA(qaInput.value); });

async function doQA(question) {
  if (!question.trim()) return;
  const q = question.trim();
  qaInput.value = '';

  // Remove empty state
  qaMessages.querySelector('.empty-state')?.remove();

  // Add question bubble
  const qEl = document.createElement('div');
  qEl.className = 'qa-question';
  qEl.textContent = q;
  qaMessages.appendChild(qEl);

  // Add thinking indicator
  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'qa-thinking';
  thinkingEl.textContent = 'Kortex is thinking...';
  qaMessages.appendChild(thinkingEl);
  qaMessages.scrollTop = qaMessages.scrollHeight;

  const res = await sendMessage({ type: 'QA', question: q });
  thinkingEl.remove();

  const aEl = document.createElement('div');
  aEl.className = 'qa-answer';
  aEl.textContent = res.answer ?? res.error ?? 'No answer found.';
  qaMessages.appendChild(aEl);
  qaMessages.scrollTop = qaMessages.scrollHeight;
}

// ── Listen for messages from content script ───────────────────────────────────
window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg?.type) return;

  if (msg.type === 'SEARCH') {
    // Auto-search from page context
    if (msg.query && msg.query !== searchInput.value) {
      searchInput.value = msg.query.slice(0, 60);
      resultsEl.innerHTML = '<div class="loading">Analysing page...</div>';
      if (contextBadge) contextBadge.textContent = msg.context?.type ?? '';
      const res = await sendMessage({
        type: 'SEARCH',
        query: msg.query,
        context: msg.context?.type ?? '',
        repo: msg.context?.repo ?? '',
      });
      renderResults(res);
    }
  }

  if (msg.type === 'SEARCH_RESULTS') renderResults(msg);
  if (msg.type === 'QA_RESULT') {
    const aEl = document.createElement('div');
    aEl.className = 'qa-answer';
    aEl.textContent = msg.answer ?? msg.error ?? 'No answer.';
    qaMessages.appendChild(aEl);
    qaMessages.scrollTop = qaMessages.scrollHeight;
  }
  if (msg.type === 'KORTEX_CLOSE') {
    window.parent.postMessage({ type: 'KORTEX_CLOSE' }, '*');
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
