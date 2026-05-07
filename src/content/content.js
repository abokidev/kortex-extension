const KORTEX_HOST_ID = 'kortex-shadow-host';
const MIN_CAPTURE_LENGTH = 40;

let sidebarVisible = false;
let shadowRoot = null;
let lastSearchQuery = '';
let searchTimer = null;
let captureTimer = null;
let capturedSignals = new Set();
let observerStarted = false;
let projectNames = [];
let projectNamesLoaded = false;

// ── Load project names from background ───────────────────────────────────────
async function loadProjectNames() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_NAMES' });
    projectNames = (res.names ?? []).map(n => n.toLowerCase().trim());
    projectNamesLoaded = true;
  } catch {
    projectNames = [];
    projectNamesLoaded = true;
  }
}

// ── Check if text contains a known project name ───────────────────────────────
function detectProjectTrigger(text) {
  if (!text || !projectNames.length) return null;
  const lower = text.toLowerCase();
  for (const name of projectNames) {
    if (name.length < 3) continue;
    // Match whole word only — avoid partial matches
    const regex = new RegExp(`\\b${name.replace(/[-]/g, '[\\-]')}\\b`, 'i');
    if (regex.test(lower)) return name;
  }
  return null;
}

// ── Extract surrounding paragraph containing the trigger ──────────────────────
function extractSignalContext(text, triggerName) {
  if (!text) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(triggerName.toLowerCase());
  if (idx === -1) return text.slice(0, 600);
  // Get surrounding context — up to 300 chars before and after the trigger
  const start = Math.max(0, idx - 200);
  const end = Math.min(text.length, idx + 400);
  return text.slice(start, end).trim();
}

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
  if (active && !active.closest('#' + KORTEX_HOST_ID)) {
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

// ── Enriched capture toast with inferred memory ───────────────────────────────
async function showCaptureToast(signal, triggerName, inferred, existingThread) {
  if (document.getElementById('kortex-toast')) document.getElementById('kortex-toast').remove();

  const toast = document.createElement('div');
  toast.id = 'kortex-toast';
  toast.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#0d1318;border:1px solid rgba(0,196,255,0.35);border-radius:12px;padding:14px 16px;max-width:340px;box-shadow:0 4px 24px rgba(0,0,0,0.7);font-family:-apple-system,sans-serif;';

  const conf = Math.round((inferred.confidence ?? 0.5) * 100);
  const confColour = conf >= 70 ? '#34d399' : conf >= 40 ? '#f59e0b' : '#FF4D4D';
  const typeColour = inferred.type === 'decision' ? '#a78bfa' : inferred.type === 'note' ? '#34d399' : '#fb923c';

  const threadInfo = existingThread
    ? `<div style="background:rgba(0,196,255,0.06);border:1px solid rgba(0,196,255,0.15);border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:10px;color:#7a909e;">Adds to existing thread: <span style="color:#00C4FF;font-weight:600;">${existingThread.title}</span> (${existingThread.signalCount} signals)</div>`
    : '';

  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <div style="width:20px;height:20px;background:rgba(0,196,255,0.15);border:1px solid rgba(0,196,255,0.3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#00C4FF;flex-shrink:0;">K</div>
      <p style="font-size:11px;font-weight:600;color:#e8edf2;margin:0;">Kortex captured a signal</p>
      <span style="font-size:9px;color:#4a5568;margin-left:auto;">trigger: <span style="color:#00C4FF">${triggerName}</span></span>
    </div>
    ${threadInfo}
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase;color:${typeColour};background:${typeColour}18">${inferred.type ?? 'context'}</span>
        <span style="font-size:9px;font-family:monospace;color:${confColour};margin-left:auto;">${conf}% confidence</span>
      </div>
      <p style="font-size:11px;font-weight:600;color:#e8edf2;margin:0 0 4px;">${inferred.title ?? 'Untitled'}</p>
      <p style="font-size:10px;color:#7a909e;margin:0;line-height:1.4;">${(inferred.content ?? signal).slice(0, 100)}${(inferred.content ?? signal).length > 100 ? '…' : ''}</p>
    </div>
    <div style="display:flex;gap:6px;">
      <button id="k-affirm-btn" style="flex:1;background:#34d399;color:#050810;border:none;border-radius:6px;padding:6px;font-size:10px;font-weight:700;cursor:pointer;">✓ Affirm</button>
      <button id="k-save-btn" style="flex:1;background:#00C4FF;color:#050810;border:none;border-radius:6px;padding:6px;font-size:10px;font-weight:700;cursor:pointer;">Save proposed</button>
      <button id="k-dismiss-btn" style="background:rgba(255,255,255,0.06);color:#7a909e;border:none;border-radius:6px;padding:6px 10px;font-size:10px;cursor:pointer;">✕</button>
    </div>`;

  document.documentElement.appendChild(toast);

  toast.querySelector('#k-affirm-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_MEMORY', text: signal, context: detectContext(), status: 'affirmed' });
    toast.remove();
  });
  toast.querySelector('#k-save-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_MEMORY', text: signal, context: detectContext(), status: 'proposed' });
    toast.remove();
  });
  toast.querySelector('#k-dismiss-btn').addEventListener('click', () => toast.remove());
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 20000);
}

// ── Shadow DOM sidebar ────────────────────────────────────────────────────────
const SIDEBAR_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #kortex-panel { position:fixed;top:0;right:0;width:340px;height:100vh;background:#050810;color:#e8edf2;z-index:2147483647;box-shadow:-4px 0 24px rgba(0,0,0,0.6);transform:translateX(100%);transition:transform 0.25s ease;display:flex;flex-direction:column;overflow:hidden; }
  #kortex-panel.visible { transform:translateX(0); }
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
  .k-card { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px 12px;margin-bottom:6px; }
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
  .k-thread-badge { font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(0,196,255,0.1);color:#00C4FF;margin-left:auto; }
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
      <button class="k-tab active" data-tab="memory">Intelligence</button>
      <button class="k-tab" data-tab="qa">Ask</button>
    </div>
    <div class="k-tab-content active" id="k-tab-memory">
      <div class="k-search">
        <input type="text" id="k-search-input" placeholder="Search codebase intelligence..." />
        <button id="k-search-btn">→</button>
      </div>
      <div class="k-results" id="k-results">
        <div class="k-empty"><div class="k-empty-icon">🧠</div><span>Watching for project signals</span><span style="font-size:10px;color:#4a5568;">Intelligence surfaces when your projects are mentioned</span></div>
      </div>
    </div>
    <div class="k-tab-content" id="k-tab-qa">
      <div class="k-qa-messages" id="k-qa-messages">
        <div class="k-empty"><div class="k-empty-icon">💬</div><span>Ask your codebase anything</span><span style="font-size:10px;color:#4a5568;">Grounded in affirmed intelligence</span></div>
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
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;pointer-events:auto;';
  document.documentElement.appendChild(host);
  shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = SIDEBAR_HTML;

  const panel = shadowRoot.getElementById('kortex-panel');

  shadowRoot.querySelectorAll('.k-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      shadowRoot.querySelectorAll('.k-tab').forEach(t => t.classList.remove('active'));
      shadowRoot.querySelectorAll('.k-tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      shadowRoot.getElementById(`k-tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  shadowRoot.getElementById('k-close').addEventListener('click', () => {
    sidebarVisible = false;
    panel.classList.remove('visible');
  });

  shadowRoot.getElementById('k-search-btn').addEventListener('click', () => {
    doSearch(shadowRoot.getElementById('k-search-input').value);
  });
  shadowRoot.getElementById('k-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(e.target.value);
  });
  shadowRoot.getElementById('k-qa-btn').addEventListener('click', () => {
    doQA(shadowRoot.getElementById('k-qa-input').value);
  });
  shadowRoot.getElementById('k-qa-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doQA(e.target.value);
  });

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
  resultsEl.innerHTML = '<div class="k-loading">Searching intelligence...</div>';
  const ctx = detectContext();
  const res = await chrome.runtime.sendMessage({ type: 'SEARCH', query: query.trim(), context: ctx.type, repo: ctx.repo });
  renderResults(res);
  lastSearchQuery = query.trim();
}

function renderResults(res) {
  const resultsEl = shadowRoot?.getElementById('k-results');
  if (!resultsEl) return;
  if (res?.limitReached) { resultsEl.innerHTML = `<div class="k-limit">${res.error}</div>`; return; }
  if (res?.error && !res?.results) { resultsEl.innerHTML = `<div class="k-error">${res.error}</div>`; return; }
  const results = res?.results ?? [];
  if (!results.length) {
    resultsEl.innerHTML = '<div class="k-empty"><div class="k-empty-icon">🔍</div><span>No intelligence found</span></div>';
    return;
  }
  resultsEl.innerHTML = results.map(r => {
    const colour = TYPE_COLOURS[r.type] ?? '#7a909e';
    const conf = Math.round(r.confidence * 100);
    const confColour = conf >= 70 ? '#34d399' : conf >= 40 ? '#f59e0b' : '#FF4D4D';
    const threadBadge = r.threadPosition > 1 ? `<span class="k-thread-badge">${r.threadPosition} signals</span>` : '';
    return `<div class="k-card">
      <div class="k-card-meta">
        <span class="k-type" style="color:${colour};background:${colour}18">${r.type}</span>
        ${r.symbol ? `<span class="k-sym">${r.symbol}</span>` : ''}
        <span class="k-conf" style="color:${confColour}">${conf}%</span>
        ${threadBadge}
        <span class="k-proj">${r.projectName}</span>
      </div>
      <div class="k-title-text">${r.title ?? 'Untitled'}</div>
      <div class="k-content">${r.content.slice(0, 120)}${r.content.length > 120 ? '…' : ''}</div>
      ${r.status === 'proposed' ? `<div class="k-actions">
        <button class="k-affirm" data-id="${r.id}">✓ Affirm</button>
        <button class="k-deny" data-id="${r.id}">✕ Deny</button>
      </div>` : ''}
    </div>`;
  }).join('');

  resultsEl.querySelectorAll('.k-affirm').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'AFFIRM', memoryId: btn.dataset.id, status: 'affirmed', token: '' });
      btn.closest('.k-actions').innerHTML = '<span style="color:#34d399;font-size:9px;">✓ Affirmed</span>';
    });
  });
  resultsEl.querySelectorAll('.k-deny').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'AFFIRM', memoryId: btn.dataset.id, status: 'denied', token: '' });
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

// ── Text change handler — project name trigger only ───────────────────────────
function onTextChange() {
  if (!projectNamesLoaded || !projectNames.length) return;

  clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    const text = extractTypedText();
    if (text.length < MIN_CAPTURE_LENGTH) return;

    const trigger = detectProjectTrigger(text);
    if (!trigger) return;

    const signalKey = text.slice(0, 60);
    if (capturedSignals.has(signalKey)) return;
    capturedSignals.add(signalKey);

    // Extract surrounding context
    const signal = extractSignalContext(text, trigger);

    // Auto-search sidebar with project name
    if (signal.length > 10 && signal !== lastSearchQuery) {
      lastSearchQuery = signal;
      chrome.runtime.sendMessage({ type: 'SEARCH', query: trigger, context: detectContext().type, repo: '' })
        .then(res => {
          if (res?.results?.length) {
            renderResults(res);
            // Auto-show sidebar
            if (!sidebarVisible && shadowRoot) {
              sidebarVisible = true;
              shadowRoot.getElementById('kortex-panel')?.classList.add('visible');
            }
          }
        })
        .catch(() => {});
    }

    // Run inference on the signal
    try {
      const inferRes = await chrome.runtime.sendMessage({
        type: 'INFER_SIGNAL',
        text: signal,
        trigger,
        context: detectContext(),
      });

      if (inferRes?.inferred) {
        await showCaptureToast(signal, trigger, inferRes.inferred, inferRes.existingThread ?? null);
      }
    } catch {}
  }, 2500);
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
async function init() {
  // Auth gate — do nothing if not signed in
  const auth = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
  if (!auth.authenticated) return;

  await loadProjectNames();
  injectSidebar();
  startWatching();

  // Initial page scan for project names
  setTimeout(() => {
    const pageText = document.title + ' ' + (document.querySelector('h1')?.textContent ?? '');
    const trigger = detectProjectTrigger(pageText);
    if (trigger) {
      chrome.runtime.sendMessage({ type: 'SEARCH', query: trigger, context: detectContext().type, repo: '' })
        .then(res => { if (res?.results?.length) renderResults(res); })
        .catch(() => {});
    }
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Messages from background
window.addEventListener('message', async event => {
  const msg = event.data;
  if (!msg?.type) return;
  if (msg.type === 'KORTEX_CLOSE') {
    sidebarVisible = false;
    shadowRoot?.getElementById('kortex-panel')?.classList.remove('visible');
  }
  if (msg.type === 'OPEN_SETTINGS') {
    sidebarVisible = true;
    shadowRoot?.getElementById('kortex-panel')?.classList.add('visible');
  }
});
