class SMMProviderClient {
  constructor(apiUrl, apiKey, timeoutMs = 30000) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async request(params, retries = 2) {
    const body = new URLSearchParams({ key: this.apiKey, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    let lastError;
    for (let i = 0; i <= retries; i++) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeoutMs);
        const res = await fetch(this.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastError = e;
        if (i < retries) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastError;
  }

  getServices() { return this.request({ action: 'services' }); }
  getBalance() { return this.request({ action: 'balance' }); }
  addOrder(service, link, quantity) {
    return this.request({ action: 'add', service: String(service), link, quantity: String(quantity) });
  }
  getStatus(orderId) { return this.request({ action: 'status', order: String(orderId) }); }
  async testConnection() {
    try {
      const bal = await this.getBalance();
      if (bal.error) return { ok: false, error: String(bal.error) };
      return { ok: true, balance: String(bal.balance ?? '0') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

function mapProviderStatus(raw) {
  if (!raw) return 'processing';
  const s = String(raw).toLowerCase().trim();
  if (['completed', 'complete', 'success', 'finished'].includes(s)) return 'completed';
  if (['pending', 'waiting'].includes(s)) return 'pending';
  if (['in progress', 'inprogress', 'processing', 'progress', 'working'].includes(s)) return 'processing';
  if (s === 'partial') return 'partial';
  if (['canceled', 'cancelled'].includes(s)) return 'cancelled';
  if (['failed', 'error', 'rejected'].includes(s)) return 'failed';
  return 'processing';
}

module.exports = { SMMProviderClient, mapProviderStatus };
