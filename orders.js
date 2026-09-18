const express = require('express');
const { z } = require('zod');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { placeOrder } = require('../services/order');
const { toNum } = require('../money');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const schema = z.object({
      serviceId: z.string().min(1),
      link: z.string().url(),
      quantity: z.number().int().positive(),
      idempotencyKey: z.string().max(64).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

    const idempotencyKey = parsed.data.idempotencyKey || req.headers['idempotency-key'];
    const result = await placeOrder({
      userId: req.user.id,
      serviceId: parsed.data.serviceId,
      link: parsed.data.link,
      quantity: parsed.data.quantity,
      idempotencyKey,
    });

    if (!result.success) {
      const status = result.code === 'INSUFFICIENT_BALANCE' ? 402 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
    const status = req.query.status || undefined;
    const where = { userId: req.user.id };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { service: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders: orders.map((o) => ({
        id: o.id,
        service: o.service.name,
        link: o.link,
        quantity: o.quantity,
        price: toNum(o.price),
        status: o.status,
        startCount: o.startCount,
        remains: o.remains,
        providerOrderId: o.providerOrderId,
        createdAt: o.createdAt,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
