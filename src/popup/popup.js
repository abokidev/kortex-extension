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

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    if (!email || !password) return;

    const btn = document.getElementById('loginBtn');
    btn.textContent = 'Signing in...';
    btn.disabled = true;

    const res = await chrome.runtime.sendMessage({ type: 'LOGIN', email, password });

    btn.textContent = 'Sign in';
    btn.disabled = false;

    if (res.error) {
      errEl.textContent = res.error;
      errEl.style.display = 'block';
      return;
    }

    // Re-init to show signed in state
    init();
  });
}

async function showSignedIn(auth) {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('signedInSection').classList.remove('hidden');

  const projectsData = await chrome.runtime.sendMessage({ type: 'GET_PROJECTS' });
  const count = projectsData.projects?.length ?? 0;
  const orgCount = auth.orgs?.length ?? 1;

  const statusEl = document.getElementById('status');
  statusEl.innerHTML = `Signed in as <span>${auth.email}</span><br/>${count} project${count !== 1 ? 's' : ''} across ${orgCount} org${orgCount !== 1 ? 's' : ''}`;

  // Show sync button if signed in
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
