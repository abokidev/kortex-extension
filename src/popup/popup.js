async function init() {
  const auth = await chrome.runtime.sendMessage({ type: 'GET_AUTH' });
  const projectsData = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });
  const statusEl = document.getElementById('status');

  if (!auth.jwt) {
    statusEl.innerHTML = 'Not signed in. <a href="https://kodingo.xyz/signin" target="_blank" style="color:#00C4FF">Sign in →</a>';
    document.getElementById('syncBtn').style.display = 'none';
  } else {
    const count = projectsData.projects?.length ?? 0;
    const orgCount = auth.orgs?.length ?? 1;
    statusEl.innerHTML = `<span>${auth.email}</span><br/>${count} project${count !== 1 ? 's' : ''} across ${orgCount} org${orgCount !== 1 ? 's' : ''}`;
  }

  document.getElementById('openBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const iframe = document.getElementById('kortex-sidebar-iframe');
          if (iframe) iframe.style.transform = iframe.style.transform === 'translateX(100%)' ? '' : 'translateX(100%)';
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

  document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncBtn');
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'SYNC_PROJECTS' });
    const count = res.projects?.length ?? 0;
    document.getElementById('status').innerHTML = `<span>${auth.email}</span><br/>${count} project${count !== 1 ? 's' : ''} synced`;
    btn.textContent = '↺ Sync projects';
    btn.disabled = false;
  });
}

init();
