const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const crypto = require('crypto');
const { prisma } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { toNum } = require('../money');

const router = express.Router();

function validatePassword(password) {
  const errors = [];
  if (password.length < 8 || password.length > 12) errors.push('Password must be 8-12 characters');
  if (!/[a-zA-Z]/.test(password)) errors.push('Must contain a letter');
  if (!/[0-9]/.test(password)) errors.push('Must contain a number');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('Must contain a symbol');
  return { valid: errors.length === 0, errors };
}

router.post('/register', async (req, res) => {
  try {
    const schema = z.object({
      username: z.string().min(3).max(20),
      email: z.string().email(),
      password: z.string().min(8).max(12),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

    const pass = validatePassword(parsed.data.password);
    if (!pass.valid) return res.status(400).json({ error: pass.errors[0] });

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: parsed.data.email }, { username: parsed.data.username }] },
    });
    if (exists) return res.status(400).json({ error: 'Username or email already exists' });

    const hashed = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        email: parsed.data.email,
        password: hashed,
        role: 'user',
        status: 'active',
      },
    });

    res.json({ success: true, userId: user.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await prisma.user.findFirst({
      where: { OR: [{ email }, { username: email }] },
    });
    if (!user || !user.password) return res.status(401).json({ error: 'Invalid username or password' });
    if (user.status === 'disabled') return res.status(403).json({ error: 'Account disabled' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance: toNum(user.balance),
        name: user.name,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, username: true, email: true, role: true, balance: true, name: true, status: true, apiEnabled: true },
  });
  res.json({ user: { ...user, balance: toNum(user.balance) } });
});

router.post('/forgot-password', async (req, res) => {
  const email = req.body.email;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.password) {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetExpires: new Date(Date.now() + 3600000) },
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[DEV] Reset token:', token);
    }
  }
  res.json({ success: true, message: 'If the email exists, a reset link will be sent' });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const pass = validatePassword(password || '');
  if (!pass.valid) return res.status(400).json({ error: pass.errors[0] });
  const user = await prisma.user.findFirst({
    where: { resetToken: token, resetExpires: { gt: new Date() } },
  });
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
  const hashed = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, resetToken: null, resetExpires: null },
  });
  res.json({ success: true });
});

module.exports = router;
