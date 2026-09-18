function toast(message, type = 'info') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function formatMoney(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(n) || 0);
}

function requireLogin() {
  if (!window.AK.getToken()) {
    location.href = '/login.html';
    return false;
  }
  return true;
}

function initTheme() {
  const t = localStorage.getItem('ak_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ak_theme', next);
}

function initSidebar() {
  const btn = document.getElementById('menuBtn');
  const overlay = document.getElementById('sidebarOverlay');
  const sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;
  const open = () => {
    sidebar.classList.add('open');
    overlay?.classList.add('open');
  };
  const close = () => {
    sidebar.classList.remove('open');
    overlay?.classList.remove('open');
  };
  btn.addEventListener('click', open);
  overlay?.addEventListener('click', close);
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    AK.clearAuth();
    location.href = '/login.html';
  });
}

async function refreshUserHeader() {
  const { ok, data } = await AK.api('/api/auth/me');
  if (ok && data.user) {
    AK.setAuth(AK.getToken(), data.user);
    const bal = document.getElementById('headerBalance');
    const name = document.getElementById('headerName');
    if (bal) bal.textContent = formatMoney(data.user.balance);
    if (name) name.textContent = data.user.username || data.user.name || 'User';
  }
}

window.UI = { toast, formatMoney, requireLogin, initTheme, toggleTheme, initSidebar, refreshUserHeader };
