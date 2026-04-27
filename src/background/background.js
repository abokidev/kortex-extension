const API_BASE = 'https://kodingo-api.onrender.com';

// ── Storage helpers ───────────────────────────────────────────────────────────
async function getAuth() {
  return new Promise(resolve => {
    chrome.storage.local.get(['kortex_jwt', 'kortex_email', 'kortex_org'], resolve);
  });
}

async function getProjects() {
  return new Promise(resolve => {
    chrome.storage.local.get(['kortex_projects'], data => {
      resolve(data.kortex_projects ?? []);
    });
  });
}

async function setProjects(projects) {
  return new Promise(resolve => {
    chrome.storage.local.set({ kortex_projects: projects }, resolve);
  });
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiCall(path, options = {}) {
  const { kortex_jwt } = await getAuth();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (kortex_jwt) headers['Authorization'] = `Bearer ${kortex_jwt}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  return res;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true; // keep channel open for async
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'LOGIN': {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: msg.email, password: msg.password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? 'Login failed' };
      await chrome.storage.local.set({
        kortex_jwt: data.token,
        kortex_email: msg.email,
        kortex_org: data.orgName ?? '',
      });
      return { ok: true, orgName: data.orgName };
    }

    case 'LOGOUT': {
      await chrome.storage.local.clear();
      return { ok: true };
    }

    case 'GET_AUTH': {
      const auth = await getAuth();
      return { jwt: auth.kortex_jwt, email: auth.kortex_email, org: auth.kortex_org };
    }

    case 'GET_PROJECTS': {
      const projects = await getProjects();
      return { projects };
    }

    case 'ADD_PROJECT': {
      const projects = await getProjects();
      const exists = projects.find(p => p.token === msg.token);
      if (exists) return { error: 'Project already added' };
      projects.push({ name: msg.name, token: msg.token });
      await setProjects(projects);
      return { ok: true, projects };
    }

    case 'REMOVE_PROJECT': {
      const projects = await getProjects();
      const updated = projects.filter(p => p.token !== msg.token);
      await setProjects(updated);
      return { ok: true, projects: updated };
    }

    case 'SEARCH': {
      const projects = await getProjects();
      if (!projects.length) return { results: [], total: 0 };
      const tokens = projects.map(p => p.token);
      const res = await fetch(`${API_BASE}/ext/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens,
          query: msg.query,
          context: msg.context,
          repo: msg.repo,
        }),
      });
      if (res.status === 429) {
        const data = await res.json();
        return { error: data.message, limitReached: true };
      }
      if (!res.ok) return { results: [], total: 0 };
      return res.json();
    }

    case 'QA': {
      const projects = await getProjects();
      if (!projects.length) return { error: 'No projects added' };
      const token = projects[0].token;
      const res = await fetch(`${API_BASE}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kodingo-Token': token },
        body: JSON.stringify({ question: msg.question }),
      });
      if (!res.ok) return { error: 'Q&A failed' };
      return res.json();
    }

    case 'AFFIRM': {
      const res = await fetch(`${API_BASE}/ext/affirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: msg.token, memoryId: msg.memoryId, status: msg.status }),
      });
      return res.ok ? { ok: true } : { error: 'Affirm failed' };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}
