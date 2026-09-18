const express = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { toNum } = require('../money');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const platform = req.query.platform || 'all';
    const where = { status: 'active' };
    if (platform && platform !== 'all' && platform !== 'everything') {
      where.category = { platform: platform === 'facebook_live' ? 'facebook' : platform };
    }

    const [categories, services] = await Promise.all([
      prisma.category.findMany({
        where: {
          status: 'active',
          ...(platform && platform !== 'all' && platform !== 'everything'
            ? { platform: platform === 'facebook_live' ? 'facebook' : platform }
            : {}),
        },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.service.findMany({
        where,
        include: { category: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    res.json({
      categories: categories.map((c) => ({ id: c.id, name: c.name, platform: c.platform })),
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        nameKm: s.nameKm,
        description: s.description,
        categoryId: s.categoryId,
        min: s.min,
        max: s.max,
        price: toNum(s.price),
        averageTime: s.averageTime,
        refill: s.refill,
        cancel: s.cancel,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
