async function init() {
  const auth = await chrome.runtime.sendMessage({ type: 'GET_AUTH' });
  if (!auth.jwt) {
    showLogin();
  } else {
    showSignedIn(auth);
  }
}

function showLogin() {
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('signedInSection').classList.add('hidden');

  document.getElementById('loginWithKodingo').addEventListener('click', async () => {
    // Try to read session from an already-open kodingo.xyz tab first
    const res = await chrome.runtime.sendMessage({ type: 'READ_SESSION_FROM_TAB' });
    if (res.ok) {
      init();
      return;
    }
    // Otherwise open kodingo.xyz and wait for user to sign in
    chrome.tabs.create({ url: 'https://kodingo.xyz/dashboard' });
    window.close();
  });

  document.getElementById('checkSessionBtn').addEventListener('click', async () => {
    const btn = document.getElementById('checkSessionBtn');
    btn.textContent = 'Checking...';
    btn.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'READ_SESSION_FROM_TAB' });
    btn.textContent = 'I have signed in ✓';
    btn.disabled = false;
    if (res.ok) {
      init();
    } else {
      document.getElementById('loginError').textContent = 'Session not found. Make sure you are signed into kodingo.xyz in this browser.';
      document.getElementById('loginError').style.display = 'block';
    }
  });
}

async function showSignedIn(auth) {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('signedInSection').classList.remove('hidden');

  const projectsData = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });
  const count = projectsData.projects?.length ?? 0;
  const orgCount = auth.orgs?.length ?? 1;

  document.getElementById('status').innerHTML = `Signed in as <span>${auth.email}</span><br/>${count} project${count !== 1 ? 's' : ''} across ${orgCount} org${orgCount !== 1 ? 's' : ''}`;
  document.getElementById('syncBtn').classList.remove('hidden');

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

  document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncBtn');
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'SYNC_PROJECTS' });
    const newCount = res.projects?.length ?? 0;
    document.getElementById('status').innerHTML = `Signed in as <span>${auth.email}</span><br/>${newCount} project${newCount !== 1 ? 's' : ''} synced ✓`;
    btn.textContent = '↺ Sync projects';
    btn.disabled = false;
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

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'LOGOUT' });
    init();
  });
}

init();
