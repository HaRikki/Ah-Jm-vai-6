const API_BASE = '';

function getToken() {
  return localStorage.getItem('ak_token') || '';
}

function setAuth(token, user) {
  localStorage.setItem('ak_token', token);
  if (user) localStorage.setItem('ak_user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('ak_token');
  localStorage.removeItem('ak_user');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('ak_user') || 'null');
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }

  if (res.status === 401) {
    clearAuth();
    if (!location.pathname.includes('login')) {
      location.href = '/login.html';
    }
  }

  return { ok: res.ok, status: res.status, data };
}

window.AK = { api, getToken, setAuth, clearAuth, getUser };
