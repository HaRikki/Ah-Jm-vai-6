const express = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { toNum } = require('../money');

const router = express.Router();

router.get('/methods', async (req, res) => {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ['aba_enabled', 'bakong_enabled'] } },
    });
    const map = {};
    for (const s of settings) map[s.key] = s.value;
    res.json({ aba: map.aba_enabled === 'true', bakong: map.bakong_enabled === 'true' });
  } catch {
    res.json({ aba: false, bakong: false });
  }
});

router.post('/aba/generate', requireAuth, async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const settings = await prisma.setting.findMany({
      where: { key: { in: ['aba_enabled', 'aba_api_key', 'aba_merchant_id', 'aba_base_url', 'aba_min_amount', 'aba_max_amount'] } },
    });
    const map = {};
    for (const s of settings) map[s.key] = s.value;
    if (map.aba_enabled !== 'true') return res.status(503).json({ error: 'ABA payment is not configured or disabled' });

    const apiKey = map.aba_api_key || process.env.ABA_API_KEY;
    const merchantId = map.aba_merchant_id || process.env.ABA_MERCHANT_ID;
    const baseUrl = (map.aba_base_url || process.env.ABA_API_URL || 'https://khmer-system.com').replace(/\/$/, '');
    if (!apiKey || !merchantId) return res.status(503).json({ error: 'ABA not configured' });

    const minAmt = parseFloat(map.aba_min_amount || '1');
    const maxAmt = parseFloat(map.aba_max_amount || '10000');
    if (amount < minAmt || amount > maxAmt) {
      return res.status(400).json({ error: `Amount must be between $${minAmt} and $${maxAmt}` });
    }

    const username = req.user.username || 'user';
    const apiRes = await fetch(`${baseUrl}/aba-api/generate-qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ api_key: apiKey, merchant_id: merchantId, username, amount }),
    });
    const data = await apiRes.json();
    if (!data.ok || !data.payment_id) {
      return res.status(400).json({ error: data.error || 'QR generation failed' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const txn = await prisma.transaction.create({
      data: {
        userId: req.user.id,
        amount,
        balanceBefore: user?.balance,
        paymentMethod: 'aba',
        providerTxnId: data.payment_id,
        status: 'pending',
        type: 'deposit',
        description: 'ABA KHQR deposit',
        expiresAt: data.expires_at ? new Date(data.expires_at) : new Date(Date.now() + 180000),
        metadata: JSON.stringify({
          qr_image: data.qr_image,
          card_image: data.card_image,
          pay_url: data.pay_url,
        }),
      },
    });

    res.json({
      success: true,
      transactionId: txn.id,
      paymentId: data.payment_id,
      qrImage: data.qr_image || data.card_image,
      cardImage: data.card_image,
      payUrl: data.pay_url,
      amount,
      expiresAt: txn.expiresAt,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/aba/check', requireAuth, async (req, res) => {
  try {
    const { transactionId, paymentId } = req.body;
    const txn = await prisma.transaction.findFirst({
      where: {
        userId: req.user.id,
        paymentMethod: 'aba',
        ...(transactionId ? { id: transactionId } : {}),
        ...(paymentId ? { providerTxnId: paymentId } : {}),
      },
    });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.status === 'paid') {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      return res.json({ status: 'PAID', paid: true, amount: toNum(txn.amount), balance: toNum(user.balance) });
    }

    const settings = await prisma.setting.findMany({
      where: { key: { in: ['aba_api_key', 'aba_merchant_id', 'aba_base_url'] } },
    });
    const map = {};
    for (const s of settings) map[s.key] = s.value;
    const apiKey = map.aba_api_key || process.env.ABA_API_KEY;
    const merchantId = map.aba_merchant_id || process.env.ABA_MERCHANT_ID;
    const baseUrl = (map.aba_base_url || 'https://khmer-system.com').replace(/\/$/, '');

    const apiRes = await fetch(`${baseUrl}/aba-api/check-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, merchant_id: merchantId, payment_id: txn.providerTxnId }),
    });
    const data = await apiRes.json();

    if (data.paid || data.status === 'PAID') {
      // Idempotent credit
      const existing = await prisma.transaction.findFirst({
        where: { providerTxnId: txn.providerTxnId, paymentMethod: 'aba', status: 'paid' },
      });
      if (!existing || existing.id === txn.id) {
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.transaction.findUnique({ where: { id: txn.id } });
          if (fresh.status === 'paid') return;
          const user = await tx.user.findUnique({ where: { id: req.user.id } });
          const before = toNum(user.balance);
          const after = Number((before + toNum(txn.amount)).toFixed(6));
          await tx.user.update({ where: { id: req.user.id }, data: { balance: after } });
          await tx.transaction.update({
            where: { id: txn.id },
            data: { status: 'paid', paidAt: new Date(), creditedAt: new Date(), balanceBefore: before, balanceAfter: after },
          });
        });
      }
      try {
        await fetch(`${baseUrl}/aba-api/mark-credited`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, merchant_id: merchantId, payment_id: txn.providerTxnId }),
        });
      } catch { /* ignore */ }

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      return res.json({ status: 'PAID', paid: true, amount: toNum(txn.amount), balance: toNum(user.balance) });
    }

    if (data.status === 'EXPIRED') {
      await prisma.transaction.update({ where: { id: txn.id }, data: { status: 'expired' } });
      return res.json({ status: 'EXPIRED', paid: false });
    }
    res.json({ status: data.status || 'PENDING', paid: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;
