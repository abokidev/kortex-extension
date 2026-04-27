const KORTEX_SIDEBAR_ID = 'kortex-sidebar-iframe';
const DEBOUNCE_MS = 800;
let sidebarInjected = false;
let lastQuery = '';
let debounceTimer = null;

// ── Page context detection ────────────────────────────────────────────────────
function detectContext() {
  const url = window.location.href;
  if (url.includes('github.com') && url.includes('/pull/')) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
    return { type: 'github-pr', repo: match ? match[2] : '' };
  }
  if (url.includes('github.com') && url.includes('/issues/')) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues/);
    return { type: 'github-issue', repo: match ? match[2] : '' };
  }
  if (url.includes('linear.app') && url.includes('/issue/')) {
    return { type: 'linear', repo: '' };
  }
  if (url.includes('atlassian.net/browse/')) {
    return { type: 'jira', repo: '' };
  }
  if (url.includes('notion.so')) {
    return { type: 'notion', repo: '' };
  }
  if (url.includes('office.com') || url.includes('sharepoint.com')) {
    return { type: 'word-online', repo: '' };
  }
  if (url.includes('docs.google.com')) {
    return { type: 'google-docs', repo: '' };
  }
  return { type: 'generic', repo: '' };
}

// ── Text extraction per surface ───────────────────────────────────────────────
function extractPageText(contextType) {
  try {
    switch (contextType) {
      case 'github-pr': {
        const title = document.querySelector('.js-issue-title, h1.gh-header-title')?.textContent ?? '';
        const desc = document.querySelector('.comment-body')?.textContent ?? '';
        const files = Array.from(document.querySelectorAll('.file-header')).map(f => f.textContent).join(' ');
        return `${title} ${desc} ${files}`.slice(0, 2000);
      }
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
      case 'notion': {
        const blocks = Array.from(document.querySelectorAll('[contenteditable="true"], .notion-page-content'))
          .map(el => el.textContent).join(' ');
        return blocks.slice(0, 2000);
      }
      case 'word-online': {
        // Word Online uses contenteditable divs
        const paras = Array.from(document.querySelectorAll('[contenteditable="true"] p, .WACViewPanel p'))
          .map(el => el.textContent).join(' ');
        return paras.slice(0, 2000);
      }
      case 'google-docs': {
        // Google Docs accessible layer
        const paras = Array.from(document.querySelectorAll('.kix-page-content-block, .kix-paragraphrenderer'))
          .map(el => el.textContent).join(' ');
        return paras.slice(0, 2000);
      }
      default:
        return document.body?.innerText?.slice(0, 1000) ?? '';
    }
  } catch { return ''; }
}

// ── Extract active paragraph (for live typing) ────────────────────────────────
function extractActiveParagraph() {
  const sel = window.getSelection();
  if (!sel?.anchorNode) return '';
  const node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  return node?.textContent?.trim().slice(0, 500) ?? '';
}

// ── Sidebar injection ─────────────────────────────────────────────────────────
function injectSidebar() {
  if (sidebarInjected) return;
  sidebarInjected = true;

  const iframe = document.createElement('iframe');
  iframe.id = KORTEX_SIDEBAR_ID;
  iframe.src = chrome.runtime.getURL('src/sidebar/sidebar.html');
  iframe.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 340px;
    height: 100vh;
    border: none;
    z-index: 999999;
    box-shadow: -4px 0 24px rgba(0,0,0,0.4);
    transition: transform 0.2s ease;
  `;
  document.body.appendChild(iframe);

  // Toggle with keyboard shortcut Cmd/Ctrl+Shift+K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
      const el = document.getElementById(KORTEX_SIDEBAR_ID);
      if (el) el.style.transform = el.style.transform === 'translateX(100%)' ? '' : 'translateX(100%)';
    }
  });
}

// ── Search trigger ────────────────────────────────────────────────────────────
function triggerSearch(query, context) {
  if (!query || query === lastQuery) return;
  lastQuery = query;
  const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
  if (!iframe) return;
  iframe.contentWindow?.postMessage({ type: 'SEARCH', query, context }, '*');
}

// ── Main init ─────────────────────────────────────────────────────────────────
function init() {
  const ctx = detectContext();
  injectSidebar();

  // Initial page search
  setTimeout(() => {
    const text = extractPageText(ctx.type);
    if (text.trim().length > 10) {
      triggerSearch(text.trim().slice(0, 200), ctx);
    }
  }, 1500);

  // Live typing watch for document editors
  if (['word-online', 'google-docs', 'notion'].includes(ctx.type)) {
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const para = extractActiveParagraph();
        if (para.length > 15) triggerSearch(para, ctx);
      }, DEBOUNCE_MS);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Listen for messages from sidebar
window.addEventListener('message', async (event) => {
  if (event.data?.type === 'KORTEX_SEARCH') {
    const ctx = detectContext();
    const response = await chrome.runtime.sendMessage({
      type: 'SEARCH',
      query: event.data.query,
      context: ctx.type,
      repo: ctx.repo,
    });
    const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
    iframe?.contentWindow?.postMessage({ type: 'SEARCH_RESULTS', ...response }, '*');
  }
  if (event.data?.type === 'KORTEX_QA') {
    const response = await chrome.runtime.sendMessage({ type: 'QA', question: event.data.question });
    const iframe = document.getElementById(KORTEX_SIDEBAR_ID);
    iframe?.contentWindow?.postMessage({ type: 'QA_RESULT', ...response }, '*');
  }
  if (event.data?.type === 'KORTEX_AFFIRM') {
    await chrome.runtime.sendMessage({ type: 'AFFIRM', ...event.data });
  }
});
