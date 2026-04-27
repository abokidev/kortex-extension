const KORTEX_SIDEBAR_ID = 'kortex-sidebar-iframe';
const SEARCH_DEBOUNCE_MS = 1000;
const CAPTURE_DEBOUNCE_MS = 3000;
const MIN_CAPTURE_LENGTH = 80;

let sidebarInjected = false;
let sidebarVisible = false;
let lastSearchQuery = '';
let searchDebounceTimer = null;
let captureDebounceTimer = null;
let capturedTexts = new Set();

// ── Page context detection ────────────────────────────────────────────────────
function detectContext() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  if (url.includes('github.com') && url.includes('/pull/')) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
    return { type: 'github-pr', repo: match ? match[2] : '', site: 'GitHub' };
  }
  if (url.includes('github.com') && url.includes('/issues/')) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues/);
    return { type: 'github-issue', repo: match ? match[2] : '', site: 'GitHub' };
  }
  if (url.includes('linear.app')) return { type: 'linear', repo: '', site: 'Linear' };
  if (url.includes('atlassian.net')) return { type: 'jira', repo: '', site: 'Jira' };
  if (url.includes('notion.so')) return { type: 'notion', repo: '', site: 'Notion' };
  if (url.includes('office.com') || url.includes('sharepoint.com')) return { type: 'word-online', repo: '', site: 'Word Online' };
  if (url.includes('docs.google.com')) return { type: 'google-docs', repo: '', site: 'Google Docs' };
  if (url.includes('mail.google.com')) return { type: 'gmail', repo: '', site: 'Gmail' };
  if (url.includes('outlook.')) return { type: 'outlook', repo: '', site: 'Outlook' };
  if (url.includes('slack.com')) return { type: 'slack-web', repo: '', site: 'Slack' };
  return { type: 'generic', repo: '', site: hostname };
}

// ── Toggle sidebar ────────────────────────────────────────────────────────────
function toggleSidebar() {
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  sidebarVisible = !sidebarVisible;
  iframe.style.transform = sidebarVisible ? 'translateX(0px)' : 'translateX(100%)';
}

function showSidebar() {
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  sidebarVisible = true;
  iframe.style.transform = 'translateX(0px)';
}

// ── Extract active paragraph ──────────────────────────────────────────────────
function extractActiveParagraph() {
  try {
    const active = document.activeElement;
    if (!active) return '';
    if (active.getAttribute('contenteditable') === 'true') {
      return active.textContent?.trim().slice(0, 600) ?? '';
    }
    if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
      return active.value.slice(0, 600);
    }
    return '';
  } catch { return ''; }
}

// ── Extract page text ─────────────────────────────────────────────────────────
function extractPageText() {
  try {
    const title = document.title ?? '';
    const h1 = Array.from(document.querySelectorAll('h1')).slice(0, 2).map(h => h.textContent).join(' ');
    const meta = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    return `${title} ${h1} ${meta}`.slice(0, 300);
  } catch { return ''; }
}

// ── Decision detection ────────────────────────────────────────────────────────
function looksLikeDecision(text) {
  if (text.length < MIN_CAPTURE_LENGTH) return false;
  const phrases = ['we should', 'we will', 'we decided', 'we chose', 'we use', 'the reason', 'because', 'in order to', 'this allows', 'this ensures', 'architecture', 'approach', 'decision', 'strategy', 'implement'];
  return phrases.some(p => text.toLowerCase().includes(p));
}

// ── Capture proposal toast ────────────────────────────────────────────────────
function showCaptureProposal(text) {
  if (document.getElementById('kortex-capture-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'kortex-capture-toast';
  toast.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:999998;background:#0d1318;border:1px solid rgba(0,196,255,0.3);border-radius:12px;padding:12px 14px;max-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:-apple-system,sans-serif;';
  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="width:20px;height:20px;background:rgba(0,196,255,0.15);border:1px solid rgba(0,196,255,0.3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#00C4FF;flex-shrink:0;">K</div>
      <div style="flex:1;">
        <p style="font-size:11px;font-weight:600;color:#e8edf2;margin:0 0 3px;">Kortex spotted a potential decision</p>
        <p style="font-size:10px;color:#7a909e;margin:0 0 8px;line-height:1.4;">"${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"</p>
        <div style="display:flex;gap:6px;">
          <button id="kortex-save-btn" style="background:#00C4FF;color:#050810;border:none;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">Save to memory</button>
          <button id="kortex-dismiss-btn" style="background:rgba(255,255,255,0.06);color:#7a909e;border:none;border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer;">Dismiss</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(toast);
  document.getElementById('kortex-save-btn').addEventListener('click', async () => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_MEMORY', text, context: detectContext() });
    toast.remove();
  });
  document.getElementById('kortex-dismiss-btn').addEventListener('click', () => toast.remove());
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 12000);
}

// ── Sidebar injection ─────────────────────────────────────────────────────────
function injectSidebar() {
  if (sidebarInjected) return;
  sidebarInjected = true;

  const iframe = document.createElement('iframe');
  iframe.id = KORTEX_SIDEBAR_ID;
  iframe.src = chrome.runtime.getURL('src/sidebar/sidebar.html');
  iframe.style.cssText = 'position:fixed;top:0;right:0;width:340px;height:100vh;border:none;z-index:999999;box-shadow:-4px 0 24px rgba(0,0,0,0.4);transform:translateX(100%);transition:transform 0.25s ease;';
  document.body.appendChild(iframe);

  // Keyboard shortcut
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Close from sidebar
  window.addEventListener('message', msg => {
    if (msg.data?.type === 'KORTEX_CLOSE') {
      sidebarVisible = false;
      iframe.style.transform = 'translateX(100%)';
    }
    if (msg.data?.type === 'OPEN_SETTINGS') {
      showSidebar();
    }
  });
}

// ── Search trigger ────────────────────────────────────────────────────────────
function triggerSearch(query, context) {
  if (!query || query === lastSearchQuery) return;
  lastSearchQuery = query;
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  iframe.contentWindow?.postMessage({ type: 'SEARCH', query, context }, '*');
}

// ── Watch typing ──────────────────────────────────────────────────────────────
function watchTyping() {
  document.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const para = extractActiveParagraph();
      if (para.length > 15) triggerSearch(para, detectContext());
    }, SEARCH_DEBOUNCE_MS);

    clearTimeout(captureDebounceTimer);
    captureDebounceTimer = setTimeout(() => {
      const para = extractActiveParagraph();
      if (looksLikeDecision(para) && !capturedTexts.has(para)) {
        capturedTexts.add(para);
        showCaptureProposal(para);
      }
    }, CAPTURE_DEBOUNCE_MS);
  }, true);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  injectSidebar();
  watchTyping();

  // Initial page search
  setTimeout(() => {
    const text = extractPageText();
    if (text.trim().length > 10) triggerSearch(text, detectContext());
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Messages from sidebar ─────────────────────────────────────────────────────
window.addEventListener('message', async event => {
  const msg = event.data;
  if (!msg?.type) return;
  if (msg.type === 'KORTEX_SEARCH') {
    const ctx = detectContext();
    const response = await chrome.runtime.sendMessage({ type: 'SEARCH', query: msg.query, context: ctx.type, repo: ctx.repo });
    document.getElementById(KORTEX_SIDEBAR_ID)?.contentWindow?.postMessage({ type: 'SEARCH_RESULTS', ...response }, '*');
  }
  if (msg.type === 'KORTEX_QA') {
    const response = await chrome.runtime.sendMessage({ type: 'QA', question: msg.question });
    document.getElementById(KORTEX_SIDEBAR_ID)?.contentWindow?.postMessage({ type: 'QA_RESULT', ...response }, '*');
  }
  if (msg.type === 'KORTEX_AFFIRM') {
    chrome.runtime.sendMessage({ type: 'AFFIRM', ...msg });
  }
});
