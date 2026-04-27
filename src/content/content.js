const KORTEX_SIDEBAR_ID = 'kortex-sidebar-iframe';
const SEARCH_DEBOUNCE_MS = 1000;
const CAPTURE_DEBOUNCE_MS = 3000;
const MIN_CAPTURE_LENGTH = 80;

let sidebarInjected = false;
let lastSearchQuery = '';
let searchDebounceTimer = null;
let captureDebounceTimer = null;
let isWatching = true;
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
  if (url.includes('linear.app') && url.includes('/issue/')) {
    return { type: 'linear', repo: '', site: 'Linear' };
  }
  if (url.includes('atlassian.net/browse/')) {
    return { type: 'jira', repo: '', site: 'Jira' };
  }
  if (url.includes('notion.so')) {
    return { type: 'notion', repo: '', site: 'Notion' };
  }
  if (url.includes('office.com') || url.includes('sharepoint.com')) {
    return { type: 'word-online', repo: '', site: 'Word Online' };
  }
  if (url.includes('docs.google.com')) {
    return { type: 'google-docs', repo: '', site: 'Google Docs' };
  }
  if (url.includes('mail.google.com')) {
    return { type: 'gmail', repo: '', site: 'Gmail' };
  }
  if (url.includes('outlook.')) {
    return { type: 'outlook', repo: '', site: 'Outlook' };
  }
  if (url.includes('slack.com')) {
    return { type: 'slack-web', repo: '', site: 'Slack' };
  }
  if (url.includes('confluence.')) {
    return { type: 'confluence', repo: '', site: 'Confluence' };
  }
  return { type: 'generic', repo: '', site: hostname };
}

// ── Extract page text for initial search ──────────────────────────────────────
function extractPageText(contextType) {
  try {
    switch (contextType) {
      case 'github-pr':
      case 'github-issue': {
        const title = document.querySelector('.js-issue-title, h1.gh-header-title')?.textContent ?? '';
        const desc = document.querySelector('.comment-body')?.textContent ?? '';
        return `${title} ${desc}`.slice(0, 2000);
      }
      case 'linear': {
        const title = document.querySelector('h1')?.textContent ?? '';
        const desc = document.querySelector('[data-testid="issue-description"]')?.textContent ?? '';
        return `${title} ${desc}`.slice(0, 2000);
      }
      case 'jira': {
        const title = document.querySelector('#summary-val, h1')?.textContent ?? '';
        const desc = document.querySelector('#description-val, .user-content-block')?.textContent ?? '';
        return `${title} ${desc}`.slice(0, 2000);
      }
      case 'gmail': {
        const subject = document.querySelector('h2.hP')?.textContent ?? '';
        const body = document.querySelector('.a3s')?.textContent ?? '';
        return `${subject} ${body}`.slice(0, 2000);
      }
      case 'outlook': {
        const subject = document.querySelector('[aria-label="Message subject"]')?.textContent ?? '';
        const body = document.querySelector('[aria-label="Message body"]')?.textContent ?? '';
        return `${subject} ${body}`.slice(0, 2000);
      }
      default: {
        // Generic — use page title + meta description + h1 headings
        const title = document.title ?? '';
        const meta = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
        const h1 = Array.from(document.querySelectorAll('h1, h2')).slice(0, 3).map(h => h.textContent).join(' ');
        return `${title} ${meta} ${h1}`.slice(0, 500);
      }
    }
  } catch { return ''; }
}

// ── Extract active paragraph being typed ──────────────────────────────────────
function extractActiveParagraph() {
  try {
    const active = document.activeElement;
    if (!active) return '';

    // contenteditable
    if (active.getAttribute('contenteditable') === 'true') {
      const sel = window.getSelection();
      const node = sel?.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel?.anchorNode;
      return (node as Element)?.textContent?.trim().slice(0, 600) ?? '';
    }

    // textarea or input
    if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
      return (active as HTMLInputElement).value.slice(0, 600);
    }

    // Google Docs accessible layer
    const kdoc = document.querySelector('.kix-page-content-block');
    if (kdoc) {
      const sel = window.getSelection();
      const node = sel?.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel?.anchorNode;
      return (node as Element)?.textContent?.trim().slice(0, 600) ?? '';
    }

    return '';
  } catch { return ''; }
}

// ── Should we propose this text as a memory ───────────────────────────────────
function looksLikeDecision(text) {
  if (text.length < MIN_CAPTURE_LENGTH) return false;
  const decisionPhrases = [
    'we should', 'we will', 'we need to', 'we decided', 'we are going to',
    'we chose', 'we use', 'we switched', 'the reason', 'because', 'in order to',
    'this allows', 'this ensures', 'this prevents', 'architecture', 'approach',
    'pattern', 'decision', 'strategy', 'solution', 'implement', 'design',
  ];
  const lower = text.toLowerCase();
  return decisionPhrases.some(phrase => lower.includes(phrase));
}

// ── Show capture proposal notification ───────────────────────────────────────
function showCaptureProposal(text) {
  const existing = document.getElementById('kortex-capture-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'kortex-capture-toast';
  toast.style.cssText = `
    position: fixed; bottom: 80px; right: 20px; z-index: 999998;
    background: #0d1318; border: 1px solid rgba(0,196,255,0.3);
    border-radius: 12px; padding: 12px 14px; max-width: 300px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    font-family: -apple-system, sans-serif;
    animation: kortex-slide-in 0.2s ease;
  `;
  toast.innerHTML = `
    <style>
      @keyframes kortex-slide-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    </style>
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="width:20px;height:20px;background:rgba(0,196,255,0.15);border:1px solid rgba(0,196,255,0.3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#00C4FF;flex-shrink:0;">K</div>
      <div style="flex:1;">
        <p style="font-size:11px;font-weight:600;color:#e8edf2;margin:0 0 3px;">Kortex captured a potential decision</p>
        <p style="font-size:10px;color:#7a909e;margin:0 0 8px;line-height:1.4;">"${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"</p>
        <div style="display:flex;gap:6px;">
          <button id="kortex-save-btn" style="background:#00C4FF;color:#050810;border:none;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">Save to memory</button>
          <button id="kortex-dismiss-btn" style="background:rgba(255,255,255,0.06);color:#7a909e;border:none;border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer;">Dismiss</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(toast);

  document.getElementById('kortex-save-btn').addEventListener('click', async () => {
    const ctx = detectContext();
    await chrome.runtime.sendMessage({
      type: 'CAPTURE_MEMORY',
      text,
      context: ctx,
    });
    toast.remove();
  });

  document.getElementById('kortex-dismiss-btn').addEventListener('click', () => toast.remove());

  // Auto-dismiss after 12 seconds
  setTimeout(() => toast.remove(), 12000);
}

// ── Sidebar injection ─────────────────────────────────────────────────────────
function injectSidebar() {
  if (sidebarInjected) return;
  sidebarInjected = true;

  const iframe = document.createElement('iframe');
  iframe.id = KORTEX_SIDEBAR_ID;
  iframe.src = chrome.runtime.getURL('src/sidebar/sidebar.html');
  iframe.style.cssText = `
    position: fixed; top: 0; right: 0;
    width: 340px; height: 100vh;
    border: none; z-index: 999999;
    box-shadow: -4px 0 24px rgba(0,0,0,0.4);
    transform: translateX(100%);
    transition: transform 0.2s ease;
  `;
  document.body.appendChild(iframe);

  // Toggle with Cmd/Ctrl+Shift+K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
      const el = document.getElementById(KORTEX_SIDEBAR_ID);
      if (el) el.style.transform = el.style.transform === 'translateX(0px)' || el.style.transform === '' ? 'translateX(100%)' : 'translateX(0px)';
    }
  });

  // Listen for close message from sidebar
  window.addEventListener('message', msg => {
    if (msg.data?.type === 'KORTEX_CLOSE') {
      const el = document.getElementById(KORTEX_SIDEBAR_ID);
      if (el) el.style.transform = 'translateX(100%)';
    }
  });
}

// ── Trigger sidebar search ────────────────────────────────────────────────────
function triggerSearch(query, context) {
  if (!query || query === lastSearchQuery) return;
  lastSearchQuery = query;
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  iframe.contentWindow?.postMessage({ type: 'SEARCH', query, context }, '*');
}

// ── Watch typing everywhere ───────────────────────────────────────────────────
function watchTyping() {
  const observer = new MutationObserver(() => {
    if (!isWatching) return;

    // Search debounce
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const para = extractActiveParagraph();
      if (para.length > 15) {
        const ctx = detectContext();
        triggerSearch(para, ctx);
      }
    }, SEARCH_DEBOUNCE_MS);

    // Capture debounce — longer wait, looks for decision-like text
    clearTimeout(captureDebounceTimer);
    captureDebounceTimer = setTimeout(() => {
      const para = extractActiveParagraph();
      if (para.length > MIN_CAPTURE_LENGTH && looksLikeDecision(para) && !capturedTexts.has(para)) {
        capturedTexts.add(para);
        showCaptureProposal(para);
      }
    }, CAPTURE_DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also watch input/textarea events directly
  document.addEventListener('input', () => {
    if (!isWatching) return;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const para = extractActiveParagraph();
      if (para.length > 15) {
        const ctx = detectContext();
        triggerSearch(para, ctx);
      }
    }, SEARCH_DEBOUNCE_MS);

    clearTimeout(captureDebounceTimer);
    captureDebounceTimer = setTimeout(() => {
      const para = extractActiveParagraph();
      if (para.length > MIN_CAPTURE_LENGTH && looksLikeDecision(para) && !capturedTexts.has(para)) {
        capturedTexts.add(para);
        showCaptureProposal(para);
      }
    }, CAPTURE_DEBOUNCE_MS);
  }, true);
}

// ── Main init ─────────────────────────────────────────────────────────────────
function init() {
  injectSidebar();

  const ctx = detectContext();

  // Initial page search after load
  setTimeout(() => {
    const text = extractPageText(ctx.type);
    if (text.trim().length > 10) {
      triggerSearch(text.trim().slice(0, 200), ctx);
    }
  }, 1500);

  // Watch typing everywhere
  watchTyping();
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
    const response = await chrome.runtime.sendMessage({
      type: 'SEARCH',
      query: msg.query,
      context: ctx.type,
      repo: ctx.repo,
    });
    const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
    iframe?.contentWindow?.postMessage({ type: 'SEARCH_RESULTS', ...response }, '*');
  }

  if (msg.type === 'KORTEX_QA') {
    const response = await chrome.runtime.sendMessage({ type: 'QA', question: msg.question });
    const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
    iframe?.contentWindow?.postMessage({ type: 'QA_RESULT', ...response }, '*');
  }

  if (msg.type === 'KORTEX_AFFIRM') {
    await chrome.runtime.sendMessage({ type: 'AFFIRM', ...msg });
  }
});
