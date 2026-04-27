const KORTEX_HOST_ID = 'kortex-shadow-host';
const MIN_CAPTURE_LENGTH = 80;

let sidebarVisible = false;
let shadowRoot = null;
let lastSearchQuery = '';
let searchTimer = null;
let captureTimer = null;
let capturedTexts = new Set();
let observerStarted = false;

// ── Context detection ─────────────────────────────────────────────────────────
function detectContext() {
  const url = window.location.href;
  const host = window.location.hostname;
  if (url.includes('github.com') && url.includes('/pull/')) {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
    return { type: 'github-pr', repo: m ? m[2] : '', site: 'GitHub' };
  }
  if (url.includes('github.com')) return { type: 'github', repo: '', site: 'GitHub' };
  if (url.includes('linear.app')) return { type: 'linear', repo: '', site: 'Linear' };
  if (url.includes('atlassian.net')) return { type: 'jira', repo: '', site: 'Jira' };
  if (url.includes('notion.so')) return { type: 'notion', repo: '', site: 'Notion' };
  if (url.includes('office.com') || url.includes('sharepoint.com') || url.includes('outlook.')) return { type: 'outlook', repo: '', site: 'Outlook' };
  if (url.includes('docs.google.com')) return { type: 'google-docs', repo: '', site: 'Google Docs' };
  if (url.includes('mail.google.com')) return { type: 'gmail', repo: '', site: 'Gmail' };
  if (url.includes('claude.ai')) return { type: 'claude', repo: '', site: 'Claude' };
  if (url.includes('slack.com')) return { type: 'slack-web', repo: '', site: 'Slack' };
  return { type: 'generic', repo: '', site: host };
}

// ── Extract typed text ────────────────────────────────────────────────────────
function extractTypedText() {
  const active = document.activeElement;
  if (active && active.id !== KORTEX_HOST_ID && !active.closest('#' + KORTEX_HOST_ID)) {
    if (active.tagName === 'TEXTAREA') return active.value.slice(0, 800);
    if (active.tagName === 'INPUT' && active.type !== 'password') return active.value.slice(0, 400);
    if (active.isContentEditable) return active.innerText?.trim().slice(0, 800) ?? '';
  }
  const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
    .filter(el => !el.closest('#' + KORTEX_HOST_ID));
  if (editables.length) {
    const longest = editables.sort((a, b) => (b.innerText?.length ?? 0) - (a.innerText?.length ?? 0))[0];
    if ((longest.innerText?.length ?? 0) > 20) return longest.innerText.trim().slice(0, 800);
  }
  const textareas = Array.from(document.querySelectorAll('textarea'));
  if (textareas.length) {
    const longest = textareas.sort((a, b) => b.value.length - a.value.length)[0];
    if (longest.value.length > 20) return longest.value.slice(0, 800);
  }
  return '';
}

// ── Decision detection ────────────────────────────────────────────────────────
function looksLikeDecision(text) {
  if (text.length < MIN_CAPTURE_LENGTH) return false;
  const phrases = ['we should','we will','we decided','we chose','we use','we need to','the reason','because','in order to','this allows','this ensures','architecture','approach','decision','strategy','implement','we switched','we are using','going forward','as a team'];
  return phrases.some(p => text.toLowerCase().includes(p));
}

// ── Shadow DOM sidebar ────────────────────────────────────────────────────────
const SIDEBAR_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #kortex-panel {
    position: fixed; top: 0; right: 0; width: 340px; height: 100vh;
    background: #050810; color: #e8edf2; z-index: 2147483647;
    box-shadow: -4px 0 24px rgba(0,0,0,0.6);
    transform: translateX(100%); transition: transform 0.25s ease;
    display: flex; flex-direction: column; overflow: hidden;
  }
  #kortex-panel.visible { transform: translateX(0); }
  .k-header { display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);background:#050810;flex-shrink:0; }
  .k-logo { display:flex;align-items:center;gap:8px; }
  .k-mark { width:22px;height:22px;background:rgba(0,196,255,0.15);border:1px solid rgba(0,196,255,0.3);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#00C4FF; }
  .k-title { font-size:13px;font-weight:700;color:#e8edf2; }
  .k-badge { font-size:9px;font-weight:600;padding:2px 6px;background:rgba(0,196,255,0.1);color:#00C4FF;border-radius:4px;text-transform:uppercase; }
  .k-close { background:none;border:none;color:#7a909e;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;line-height:1; }
  .k-close:hover { background:rgba(255,255,255,0.08);color:#e8edf2; }
  .k-tabs { display:flex;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0; }
  .k-tab { flex:1;padding:9px;background:none;border:none;color:#7a909e;font-size:11px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.15s; }
  .k-tab.active { color:#00C4FF;border-bottom-color:#00C4FF; }
  .k-search { display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0; }
  .k-search input { flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:7px 10px;color:#e8edf2;font-size:11px;outline:none; }
  .k-search input:focus { border-color:rgba(0,196,255,0.4); }
  .k-search button { background:#00C4FF;color:#050810;border:none;border-radius:8px;width:30px;cursor:pointer;font-size:14px;font-weight:700; }
  .k-results { flex:1;overflow-y:auto;padding:8px; }
  .k-empty { display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;text-align:center;color:#7a909e;gap:6px;font-size:12px; }
  .k-empty-icon { font-size:28px; }
  .k-card { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:default; }
  .k-card:hover { background:rgba(255,255,255,0.06); }
  .k-card-meta { display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap; }
  .k-type { font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;text-transform:uppercase; }
  .k-proj { font-size:9px;color:#4a5568;font-family:monospace;margin-left:auto; }
  .k-conf { font-size:9px;font-family:monospace; }
  .k-sym { font-size:9px;color:#a78bfa;font-family:monospace; }
  .k-title-text { font-size:11px;font-weight:600;color:#e8edf2;margin-bottom:3px; }
  .k-content { font-size:10px;color:#7a909e;line-height:1.5; }
  .k-actions { display:flex;gap:4px;margin-top:7px; }
  .k-affirm { font-size:9px;font-weight:600;padding:3px 8px;border-radius:4px;cursor:pointer;border:1px solid rgba(52,211,153,0.3);background:rgba(52,211,153,0.08);color:#34d399; }
  .k-deny { font-size:9px;font-weight:600;padding:3px 8px;border-radius:4px;cursor:pointer;border:1px solid rgba(255,77,77,0.3);background:rgba(255,77,77,0.08);color:#FF4D4D; }
  .k-loading { text-align:center;padding:24px;color:#7a909e;font-size:11px; }
  .k-error { color:#FF4D4D;font-size:10px;padding:8px; }
  .k-limit { background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);color:#f59e0b;padding:8px 12px;border-radius:6px;font-size:10px;margin:8px; }
  .k-qa-messages { flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px; }
  .k-qa-input { display:flex;gap:6px;padding:10px 12px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0; }
  .k-qa-input input { flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:7px 10px;color:#e8edf2;font-size:11px;outline:none; }
  .k-qa-input input:focus { border-color:rgba(0,196,255,0.4); }
  .k-qa-input button { background:#00C4FF;color:#050810;border:none;border-radius:8px;width:30px;cursor:pointer;font-size:14px; }
  .k-qa-q { align-self:flex-end;background:rgba(0,196,255,0.1);border:1px solid rgba(0,196,255,0.2);border-radius:10px 10px 2px 10px;padding:8px 10px;font-size:11px;max-width:85%;line-height:1.5; }
  .k-qa-a { align-self:flex-start;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:2px 10px 10px 10px;padding:8px 10px;font-size:11px;max-width:95%;line-height:1.6;white-space:pre-wrap; }
  .k-qa-thinking { color:#7a909e;font-size:10px;padding:4px 0; }
  .k-tab-content { display:none;flex-direction:column;flex:1;overflow:hidden;min-height:0; }
  .k-tab-content.active { display:flex; }
`;

const SIDEBAR_HTML = `
  <style>${SIDEBAR_CSS}</style>
  <div id="kortex-panel">
    <div class="k-header">
      <div class="k-logo">
        <div class="k-mark">K</div>
        <span class="k-title">Kortex</span>
        <span class="k-badge" id="k-ctx-badge"></span>
      </div>
      <button class="k-close" id="k-close">✕</button>
    </div>
    <div class="k-tabs">
      <button class="k-tab active" data-tab="memory">Memory</button>
      <button class="k-tab" data-tab="qa">Ask</button>
    </div>
    <div class="k-tab-content active" id="k-tab-memory">
      <div class="k-search">
        <input type="text" id="k-search-input" placeholder="Search codebase memory..." />
        <button id="k-search-btn">→</button>
      </div>
      <div class="k-results" id="k-results">
        <div class="k-empty"><div class="k-empty-icon">🧠</div><span>Kortex is watching this page</span><span style="font-size:10px;color:#4a5568;">Memory will surface automatically</span></div>
      </div>
    </div>
    <div class="k-tab-content" id="k-tab-qa">
      <div class="k-qa-messages" id="k-qa-messages">
        <div class="k-empty"><div class="k-empty-icon">💬</div><span>Ask your codebase anything</span><span style="font-size:10px;color:#4a5568;">Grounded in affirmed memory</span></div>
      </div>
      <div class="k-qa-input">
        <input type="text" id="k-qa-input" placeholder="Why do we use Redis for sessions?" />
        <button id="k-qa-btn">→</button>
      </div>
    </div>
  </div>
`;

function injectSidebar() {
  if (document.getElementById(KORTEX_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = KORTEX_HOST_ID;
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = SIDEBAR_HTML;

  const panel = shadowRoot.getElementById('kortex-panel');
  host.style.pointerEvents = 'auto';

  // Tabs
  shadowRoot.querySelectorAll('.k-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      shadowRoot.querySelectorAll('.k-tab').forEach(t => t.classList.remove('active'));
      shadowRoot.querySelectorAll('.k-tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      shadowRoot.getElementById(`k-tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Close
  shadowRoot.getElementById('k-close').addEventListener('click', () => {
    sidebarVisible = false;
    panel.classList.remove('visible');
  });

  // Search
  shadowRoot.getElementById('k-search-btn').addEventListener('click', () => {
    doSearch(shadowRoot.getElementById('k-search-input').value);
  });
  shadowRoot.getElementById('k-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(e.target.value);
  });

  // Q&A
  shadowRoot.getElementById('k-qa-btn').addEventListener('click', () => {
    doQA(shadowRoot.getElementById('k-qa-input').value);
  });
  shadowRoot.getElementById('k-qa-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doQA(e.target.value);
  });

  // Set context badge
  const ctx = detectContext();
  if (ctx.site) shadowRoot.getElementById('k-ctx-badge').textContent = ctx.site;
}

function toggleSidebar() {
  if (!shadowRoot) injectSidebar();
  const panel = shadowRoot?.getElementById('kortex-panel');
  if (!panel) return;
  sidebarVisible = !sidebarVisible;
  panel.classList.toggle('visible', sidebarVisible);
}

// ── Search ────────────────────────────────────────────────────────────────────
const TYPE_COLOURS = { decision: '#a78bfa', note: '#34d399', context: '#fb923c' };

async function doSearch(query) {
  if (!query?.trim()) return;
  const resultsEl = shadowRoot?.getElementById('k-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="k-loading">Searching memory...</div>';
  const ctx = detectContext();
  const res = await chrome.runtime.sendMessage({ type: 'SEARCH', query: query.trim(), context: ctx.type, repo: ctx.repo });
  renderResults(res);
  lastSearchQuery = query.trim();
}

function renderResults(res) {
  const resultsEl = shadowRoot?.getElementById('k-results');
  if (!resultsEl) return;
  if (res?.limitReached) { resultsEl.innerHTML = `<div class="k-limit">${res.error}</div>`; return; }
  if (res?.error) { resultsEl.innerHTML = `<div class="k-error">${res.error}</div>`; return; }
  const results = res?.results ?? [];
  if (!results.length) { resultsEl.innerHTML = '<div class="k-empty"><div class="k-empty-icon">🔍</div><span>No memories found</span></div>'; return; }
  resultsEl.innerHTML = results.map(r => {
    const colour = TYPE_COLOURS[r.type] ?? '#7a909e';
    const conf = Math.round(r.confidence * 100);
    const confColour = conf >= 70 ? '#34d399' : conf >= 40 ? '#f59e0b' : '#FF4D4D';
    return `<div class="k-card">
      <div class="k-card-meta">
        <span class="k-type" style="color:${colour};background:${colour}18">${r.type}</span>
        ${r.symbol ? `<span class="k-sym">${r.symbol}</span>` : ''}
        <span class="k-conf" style="color:${confColour}">${conf}%</span>
        <span class="k-proj">${r.projectName}</span>
      </div>
      <div class="k-title-text">${r.title ?? 'Untitled'}</div>
      <div class="k-content">${r.content.slice(0, 120)}${r.content.length > 120 ? '…' : ''}</div>
      ${r.status === 'proposed' ? `<div class="k-actions">
        <button class="k-affirm" data-id="${r.id}" data-token="">✓ Affirm</button>
        <button class="k-deny" data-id="${r.id}" data-token="">✕ Deny</button>
      </div>` : ''}
    </div>`;
  }).join('');

  resultsEl.querySelectorAll('.k-affirm').forEach(btn => {
    btn.addEventListener('click', async () => {
      chrome.runtime.sendMessage({ type: 'AFFIRM', memoryId: btn.dataset.id, status: 'affirmed', token: btn.dataset.token });
      btn.closest('.k-actions').innerHTML = '<span style="color:#34d399;font-size:9px;">✓ Affirmed</span>';
    });
  });
  resultsEl.querySelectorAll('.k-deny').forEach(btn => {
    btn.addEventListener('click', async () => {
      chrome.runtime.sendMessage({ type: 'AFFIRM', memoryId: btn.dataset.id, status: 'denied', token: btn.dataset.token });
      btn.closest('.k-actions').innerHTML = '<span style="color:#FF4D4D;font-size:9px;">✕ Denied</span>';
    });
  });
}

// ── Q&A ───────────────────────────────────────────────────────────────────────
async function doQA(question) {
  if (!question?.trim()) return;
  const q = question.trim();
  const inputEl = shadowRoot?.getElementById('k-qa-input');
  const msgsEl = shadowRoot?.getElementById('k-qa-messages');
  if (!msgsEl) return;
  if (inputEl) inputEl.value = '';
  msgsEl.querySelector('.k-empty')?.remove();

  const qEl = document.createElement('div');
  qEl.className = 'k-qa-q';
  qEl.textContent = q;
  msgsEl.appendChild(qEl);

  const thinkEl = document.createElement('div');
  thinkEl.className = 'k-qa-thinking';
  thinkEl.textContent = 'Kortex is thinking...';
  msgsEl.appendChild(thinkEl);
  msgsEl.scrollTop = msgsEl.scrollHeight;

  const res = await chrome.runtime.sendMessage({ type: 'QA', question: q });
  thinkEl.remove();

  const aEl = document.createElement('div');
  aEl.className = 'k-qa-a';
  aEl.textContent = res?.answer ?? res?.error ?? 'No answer found.';
  msgsEl.appendChild(aEl);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ── Toast notification ────────────────────────────────────────────────────────
function showCaptureProposal(text) {
  if (document.getElementById('kortex-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'kortex-toast';
  toast.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#0d1318;border:1px solid rgba(0,196,255,0.35);border-radius:12px;padding:12px 14px;max-width:300px;box-shadow:0 4px 24px rgba(0,0,0,0.6);font-family:-apple-system,sans-serif;';
  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="min-width:20px;height:20px;background:rgba(0,196,255,0.15);border:1px solid rgba(0,196,255,0.3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#00C4FF;">K</div>
      <div style="flex:1;">
        <p style="font-size:11px;font-weight:600;color:#e8edf2;margin:0 0 4px;">Kortex spotted a potential decision</p>
        <p style="font-size:10px;color:#7a909e;margin:0 0 8px;line-height:1.4;">"${text.slice(0,90)}${text.length>90?'…':''}"</p>
        <div style="display:flex;gap:6px;">
          <button id="k-toast-save" style="background:#00C4FF;color:#050810;border:none;border-radius:6px;padding:5px 12px;font-size:10px;font-weight:700;cursor:pointer;">Save to memory</button>
          <button id="k-toast-dismiss" style="background:rgba(255,255,255,0.06);color:#7a909e;border:none;border-radius:6px;padding:5px 10px;font-size:10px;cursor:pointer;">Dismiss</button>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(toast);
  toast.querySelector('#k-toast-save').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_MEMORY', text, context: detectContext() });
    toast.remove();
  });
  toast.querySelector('#k-toast-dismiss').addEventListener('click', () => toast.remove());
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
}

// ── Text watching ─────────────────────────────────────────────────────────────
function onTextChange() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const text = extractTypedText();
    if (text.length > 15 && text !== lastSearchQuery) {
      lastSearchQuery = text;
      const ctx = detectContext();
      chrome.runtime.sendMessage({ type: 'SEARCH', query: text.slice(0,300), context: ctx.type, repo: ctx.repo })
        .then(res => renderResults(res))
        .catch(() => {});
    }
  }, 1000);

  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    const text = extractTypedText();
    const key = text.slice(0, 50);
    if (looksLikeDecision(text) && !capturedTexts.has(key)) {
      capturedTexts.add(key);
      showCaptureProposal(text);
    }
  }, 3000);
}

function startWatching() {
  if (observerStarted) return;
  observerStarted = true;
  document.addEventListener('input', onTextChange, true);
  document.addEventListener('keyup', onTextChange, true);
  new MutationObserver(onTextChange).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  injectSidebar();
  startWatching();
  setTimeout(() => {
    const q = `${document.title} ${document.querySelector('h1')?.textContent ?? ''}`.trim();
    if (q.length > 5) {
      chrome.runtime.sendMessage({ type: 'SEARCH', query: q.slice(0,200), context: detectContext().type, repo: '' })
        .then(res => { if (res?.results?.length) renderResults(res); })
        .catch(() => {});
    }
  }, 2500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
