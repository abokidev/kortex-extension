async function init() {
  const auth = await chrome.runtime.sendMessage({ type: 'GET_AUTH' });
  const projects = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });
  const statusEl = document.getElementById('status');

  if (!auth.jwt) {
    statusEl.innerHTML = 'Not signed in. <a href="https://kodingo.xyz/signin" target="_blank" style="color:#00C4FF">Sign in →</a>';
  } else {
    const count = projects.projects?.length ?? 0;
    statusEl.innerHTML = `Signed in as <span>${auth.email}</span> · ${count} project${count !== 1 ? 's' : ''}`;
  }

  document.getElementById('openBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const iframe = document.getElementById('kortex-sidebar-iframe');
          if (iframe) {
            iframe.style.transform = iframe.style.transform === 'translateX(100%)' ? '' : 'translateX(100%)';
          }
        }
      });
    }
    window.close();
  });

  document.getElementById('settingsBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const iframe = document.getElementById('kortex-sidebar-iframe');
          if (iframe) {
            iframe.style.transform = '';
            iframe.contentWindow?.postMessage({ type: 'OPEN_SETTINGS' }, '*');
          }
        }
      });
    }
    window.close();
  });
}

init();
