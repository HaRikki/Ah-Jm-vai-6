const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { SMMProviderClient } = require('../smm-provider');
const { toNum } = require('../money');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// Providers
router.get('/providers', async (req, res) => {
  const providers = await prisma.provider.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
  const counts = await prisma.service.groupBy({ by: ['providerId'], _count: true, where: { providerId: { not: null } } });
  const countMap = Object.fromEntries(counts.map((c) => [c.providerId, c._count]));
  res.json({
    providers: providers.map((p) => ({
      id: p.id, name: p.name, apiUrl: p.apiUrl,
      apiKeyMasked: p.apiKey ? p.apiKey.slice(0, 4) + '••••' + p.apiKey.slice(-4) : '',
      balance: toNum(p.balance), currency: p.currency || 'USD',
      status: p.status, userEnabled: p.userEnabled, priority: p.priority,
      lastSync: p.lastSync, lastError: p.lastError,
      serviceCount: countMap[p.id] || 0,
    })),
  });
});

router.post('/providers', async (req, res) => {
  const { action } = req.body;
  if (action === 'create') {
    const { name, apiUrl, apiKey } = req.body;
    if (!name || !apiUrl || !apiKey) return res.status(400).json({ error: 'Missing fields' });
    const provider = await prisma.provider.create({
      data: { name, apiUrl: apiUrl.replace(/\/$/, ''), apiKey, status: 'active', userEnabled: true },
    });
    try {
      const client = new SMMProviderClient(provider.apiUrl, provider.apiKey);
      const bal = await client.getBalance();
      if (!bal.error) {
        await prisma.provider.update({ where: { id: provider.id }, data: { balance: String(bal.balance || 0), lastSync: new Date() } });
      }
    } catch { /* ignore */ }
    return res.json({ success: true, id: provider.id });
  }
  if (action === 'test' || action === 'sync_balance') {
    const p = await prisma.provider.findUnique({ where: { id: req.body.id } });
    if (!p) return res.status(404).json({ error: 'Not found' });
    const client = new SMMProviderClient(p.apiUrl, p.apiKey);
    const result = await client.testConnection();
    if (result.ok) {
      await prisma.provider.update({ where: { id: p.id }, data: { balance: result.balance, lastSync: new Date(), lastError: null } });
    } else {
      await prisma.provider.update({ where: { id: p.id }, data: { lastError: result.error } });
    }
    return res.json(result);
  }
  if (action === 'set_for_users') {
    await prisma.provider.update({ where: { id: req.body.id }, data: { userEnabled: !!req.body.userEnabled } });
    return res.json({ success: true });
  }
  if (action === 'delete') {
    await prisma.service.updateMany({ where: { providerId: req.body.id }, data: { providerId: null } });
    await prisma.provider.delete({ where: { id: req.body.id } });
    return res.json({ success: true });
  }
  res.status(400).json({ error: 'Invalid action' });
});

// Payments settings
router.get('/payments', async (req, res) => {
  const settings = await prisma.setting.findMany({
    where: { key: { in: ['aba_enabled', 'aba_api_key', 'aba_merchant_id', 'aba_base_url', 'bakong_enabled'] } },
  });
  const map = {};
  for (const s of settings) map[s.key] = s.value;
  const rawKey = map.aba_api_key || '';
  res.json({
    aba: {
      enabled: map.aba_enabled === 'true',
      hasApiKey: !!rawKey,
      apiKeyMasked: rawKey ? rawKey.slice(0, 4) + '••••' + rawKey.slice(-4) : '',
      merchantId: map.aba_merchant_id || '',
      baseUrl: map.aba_base_url || 'https://khmer-system.com',
    },
    bakong: { enabled: map.bakong_enabled === 'true' },
  });
});

router.post('/payments', async (req, res) => {
  const upserts = [];
  if (typeof req.body.aba_enabled === 'boolean') upserts.push({ key: 'aba_enabled', value: req.body.aba_enabled ? 'true' : 'false' });
  if (typeof req.body.bakong_enabled === 'boolean') upserts.push({ key: 'bakong_enabled', value: req.body.bakong_enabled ? 'true' : 'false' });
  if (req.body.aba_merchant_id != null) upserts.push({ key: 'aba_merchant_id', value: String(req.body.aba_merchant_id) });
  if (req.body.aba_base_url) upserts.push({ key: 'aba_base_url', value: String(req.body.aba_base_url).replace(/\/$/, '') });
  if (req.body.aba_api_key && !String(req.body.aba_api_key).includes('••')) {
    upserts.push({ key: 'aba_api_key', value: String(req.body.aba_api_key).trim() });
  }
  for (const item of upserts) {
    await prisma.setting.upsert({ where: { key: item.key }, update: { value: item.value }, create: item });
  }
  res.json({ success: true });
});

module.exports = router;
