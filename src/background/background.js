const API_BASE = 'https://kodingo-api.onrender.com';

async function getAuth() {
  return new Promise(resolve => {
    chrome.storage.local.get(['kortex_jwt', 'kortex_email', 'kortex_orgs'], resolve);
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

async function fetchAndStoreOrgs(jwt) {
  const res = await fetch(`${API_BASE}/user/orgs`, {
    headers: { 'Authorization': `Bearer ${jwt}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const orgs = data.orgs ?? [];

  // Flatten all projects across all orgs, tagged with org info
  const projects = [];
  for (const org of orgs) {
    for (const project of org.projects ?? []) {
      projects.push({
        name: project.name,
        token: project.token,
        id: project.id,
        orgName: org.name,
        orgId: org.id,
        orgRole: org.role,
      });
    }
  }

  await chrome.storage.local.set({
    kortex_projects: projects,
    kortex_orgs: orgs.map(o => ({ id: o.id, name: o.name, role: o.role })),
  });

  return projects;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
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
      });

      // Auto-fetch all orgs and projects
      const projects = await fetchAndStoreOrgs(data.token);
      return { ok: true, projectCount: projects.length };
    }

    case 'LOGOUT': {
      await chrome.storage.local.clear();
      return { ok: true };
    }

    case 'GET_AUTH': {
      const auth = await getAuth();
      return { jwt: auth.kortex_jwt, email: auth.kortex_email, orgs: auth.kortex_orgs ?? [] };
    }

    case 'GET_PROJECTS': {
      const projects = await getProjects();
      return { projects };
    }

    case 'SYNC_PROJECTS': {
      const { kortex_jwt } = await getAuth();
      if (!kortex_jwt) return { error: 'Not authenticated' };
      const projects = await fetchAndStoreOrgs(kortex_jwt);
      return { ok: true, projects };
    }

    case 'ADD_PROJECT': {
      const projects = await getProjects();
      const exists = projects.find(p => p.token === msg.token);
      if (exists) return { error: 'Project already added' };
      projects.push({ name: msg.name, token: msg.token, orgName: 'Manual', orgId: '' });
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

      // Filter by org if specified
      const filtered = msg.orgId
        ? projects.filter(p => p.orgId === msg.orgId)
        : projects;

      const tokens = filtered.map(p => p.token);
      const res = await fetch(`${API_BASE}/ext/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens, query: msg.query, context: msg.context, repo: msg.repo }),
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
      const filtered = msg.orgId ? projects.filter(p => p.orgId === msg.orgId) : projects;
      const token = filtered[0]?.token ?? projects[0].token;
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

// ── Read session from kodingo.xyz tab ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'READ_SESSION_FROM_TAB') {
    readSessionFromTab().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function readSessionFromTab() {
  // Find an existing kodingo.xyz tab
  const tabs = await chrome.tabs.query({ url: 'https://kodingo.xyz/*' });
  
  if (!tabs.length) {
    return { ok: false, error: 'No kodingo.xyz tab found' };
  }

  // Execute script to read sessionStorage
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: () => ({
      token: sessionStorage.getItem('kodingo_token'),
      orgId: sessionStorage.getItem('kodingo_org_id'),
      email: sessionStorage.getItem('kodingo_login_email'),
    }),
  });

  const data = results?.[0]?.result;
  if (!data?.token) return { ok: false, error: 'Not signed in on kodingo.xyz' };

  // Store JWT
  await chrome.storage.local.set({
    kortex_jwt: data.token,
    kortex_email: data.email ?? '',
  });

  // Fetch all orgs and projects
  try {
    const projects = await fetchAndStoreOrgs(data.token);
    return { ok: true, projectCount: projects.length };
  } catch (e) {
    return { ok: true, projectCount: 0 };
  }
}

// Handle CAPTURE_MEMORY from content script
// This is added to the existing message handler via a separate listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_MEMORY') {
    captureMemoryFromBrowser(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function captureMemoryFromBrowser(msg) {
  const projects = await getProjects();
  if (!projects.length) return { error: 'No projects' };

  const API_BASE = 'https://kodingo-api.onrender.com';
  const token = projects[0].token;

  // Use HF to infer a memory from the text
  const inferRes = await fetch(`${API_BASE}/infer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kodingo-Token': token },
    body: JSON.stringify({
      symbol: msg.context?.site ?? 'browser',
      code: msg.text,
    }),
  });

  if (!inferRes.ok) return { error: 'Inference failed' };
  const inferred = await inferRes.json();

  // Save as proposed memory
  const saveRes = await fetch(`${API_BASE}/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kodingo-Token': token },
    body: JSON.stringify({
      type: inferred.type ?? 'context',
      title: inferred.title ?? 'Captured from browser',
      content: inferred.content ?? msg.text,
      tags: [...(inferred.tags ?? []), 'browser-capture', msg.context?.site ?? 'web'],
      status: 'proposed',
      confidence: 0.4,
    }),
  });

  return saveRes.ok ? { ok: true } : { error: 'Save failed' };
}
