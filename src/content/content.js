const KORTEX_SIDEBAR_ID = 'kortex-sidebar-iframe';
const MIN_CAPTURE_LENGTH = 80;

let sidebarVisible = false;
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
  if (url.includes('slack.com')) return { type: 'slack-web', repo: '', site: 'Slack' };
  if (url.includes('claude.ai')) return { type: 'claude', repo: '', site: 'Claude' };
  return { type: 'generic', repo: '', site: host };
}

// ── Extract typed text from any editor ───────────────────────────────────────
function extractTypedText() {
  // 1. Active focused element
  const active = document.activeElement;
  if (active) {
    if (active.tagName === 'TEXTAREA') return active.value.slice(0, 800);
    if (active.tagName === 'INPUT' && active.type !== 'password') return active.value.slice(0, 400);
    if (active.isContentEditable) return active.innerText?.trim().slice(0, 800) ?? '';
  }

  // 2. Find largest contenteditable on page
  const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
    .filter(el => !el.closest('[id*="kortex"]'));
  if (editables.length) {
    const longest = editables.sort((a, b) => (b.innerText?.length ?? 0) - (a.innerText?.length ?? 0))[0];
    if (longest.innerText?.length > 20) return longest.innerText.trim().slice(0, 800);
  }

  // 3. Find largest textarea
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
  const phrases = [
    'we should', 'we will', 'we decided', 'we chose', 'we use', 'we need to',
    'the reason', 'because', 'in order to', 'this allows', 'this ensures',
    'architecture', 'approach', 'decision', 'strategy', 'implement', 'we switched',
    'we are using', 'we have decided', 'going forward', 'as a team'
  ];
  return phrases.some(p => text.toLowerCase().includes(p));
}

// ── Toast notification ────────────────────────────────────────────────────────
function showCaptureProposal(text) {
  if (document.getElementById('kortex-capture-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'kortex-capture-toast';
  toast.style.cssText = [
    'position:fixed', 'bottom:80px', 'right:20px', 'z-index:2147483647',
    'background:#0d1318', 'border:1px solid rgba(0,196,255,0.35)',
    'border-radius:12px', 'padding:12px 14px', 'max-width:300px',
    'box-shadow:0 4px 24px rgba(0,0,0,0.6)',
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
  ].join(';');

  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="min-width:20px;height:20px;background:rgba(0,196,255,0.15);border:1px solid rgba(0,196,255,0.3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#00C4FF;">K</div>
      <div style="flex:1;min-width:0;">
        <p style="font-size:11px;font-weight:600;color:#e8edf2;margin:0 0 4px;">Kortex spotted a potential decision</p>
        <p style="font-size:10px;color:#7a909e;margin:0 0 8px;line-height:1.4;word-break:break-word;">"${text.slice(0, 90)}${text.length > 90 ? '…' : ''}"</p>
        <div style="display:flex;gap:6px;">
          <button id="kortex-save-btn" style="background:#00C4FF;color:#050810;border:none;border-radius:6px;padding:5px 12px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;">Save to memory</button>
          <button id="kortex-dismiss-btn" style="background:rgba(255,255,255,0.06);color:#7a909e;border:none;border-radius:6px;padding:5px 10px;font-size:10px;cursor:pointer;font-family:inherit;">Dismiss</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(toast);

  toast.querySelector('#kortex-save-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_MEMORY', text, context: detectContext() });
    toast.remove();
  });
  toast.querySelector('#kortex-dismiss-btn').addEventListener('click', () => toast.remove());
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function injectSidebar() {
  if (document.getElementById(KORTEX_SIDEBAR_ID)) return;

  const iframe = document.createElement('iframe');
  iframe.id = KORTEX_SIDEBAR_ID;
  iframe.src = chrome.runtime.getURL('src/sidebar/sidebar.html');
  iframe.setAttribute('allowtransparency', 'true');
  iframe.style.cssText = [
    'position:fixed', 'top:0', 'right:0', 'width:340px', 'height:100vh',
    'border:none', 'z-index:2147483646',
    'box-shadow:-4px 0 24px rgba(0,0,0,0.5)',
    'transform:translateX(100%)',
    'transition:transform 0.25s ease',
    'background:transparent',
  ].join(';');
  document.documentElement.appendChild(iframe);
}

function toggleSidebar() {
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) { injectSidebar(); setTimeout(() => showSidebar(), 300); return; }
  sidebarVisible = !sidebarVisible;
  iframe.style.transform = sidebarVisible ? 'translateX(0px)' : 'translateX(100%)';
}

function showSidebar() {
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  sidebarVisible = true;
  iframe.style.transform = 'translateX(0px)';
}

// ── Search trigger ────────────────────────────────────────────────────────────
function triggerSearch(text) {
  if (!text || text === lastSearchQuery) return;
  lastSearchQuery = text;
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  const ctx = detectContext();
  iframe.contentWindow?.postMessage({ type: 'SEARCH', query: text.slice(0, 300), context: ctx }, '*');
}

// ── Unified text change handler ───────────────────────────────────────────────
function onTextChange() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const text = extractTypedText();
    if (text.length > 15) triggerSearch(text);
  }, 1000);

  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    const text = extractTypedText();
    if (looksLikeDecision(text) && !capturedTexts.has(text.slice(0, 50))) {
      capturedTexts.add(text.slice(0, 50));
      showCaptureProposal(text);
    }
  }, 3000);
}

// ── Start watching ────────────────────────────────────────────────────────────
function startWatching() {
  if (observerStarted) return;
  observerStarted = true;

  // Listen to input events on all elements
  document.addEventListener('input', onTextChange, true);
  document.addEventListener('keyup', onTextChange, true);

  // MutationObserver for Outlook, Word Online, canvas editors
  const observer = new MutationObserver(onTextChange);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  injectSidebar();
  startWatching();

  // Initial page context search
  setTimeout(() => {
    const title = document.title;
    const h1 = document.querySelector('h1')?.textContent ?? '';
    const q = `${title} ${h1}`.trim();
    if (q.length > 5) triggerSearch(q);
  }, 2500);
}

// Messages from sidebar iframe
window.addEventListener('message', async event => {
  if (!event.data?.type) return;
  const msg = event.data;

  if (msg.type === 'KORTEX_CLOSE') {
    sidebarVisible = false;
    const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
    if (iframe) iframe.style.transform = 'translateX(100%)';
  }
  if (msg.type === 'OPEN_SETTINGS') showSidebar();
  if (msg.type === 'KORTEX_SEARCH') {
    const ctx = detectContext();
    const res = await chrome.runtime.sendMessage({ type: 'SEARCH', query: msg.query, context: ctx.type, repo: ctx.repo });
    document.getElementById(KORTEX_SIDEBAR_ID)?.contentWindow?.postMessage({ type: 'SEARCH_RESULTS', ...res }, '*');
  }
  if (msg.type === 'KORTEX_QA') {
    const res = await chrome.runtime.sendMessage({ type: 'QA', question: msg.question });
    document.getElementById(KORTEX_SIDEBAR_ID)?.contentWindow?.postMessage({ type: 'QA_RESULT', ...res }, '*');
  }
  if (msg.type === 'KORTEX_AFFIRM') {
    chrome.runtime.sendMessage({ type: 'AFFIRM', ...msg });
  }
});

// Run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
