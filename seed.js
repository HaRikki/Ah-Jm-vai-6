require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@angkersmm.com';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe@123!';
  const hashed = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      username: 'admin',
      email,
      password: hashed,
      role: 'superadmin',
      status: 'active',
      balance: 100,
    },
  });

  const cat = await prisma.category.upsert({
    where: { slug: 'tiktok-followers' },
    update: {},
    create: {
      name: 'TikTok - Followers',
      slug: 'tiktok-followers',
      platform: 'tiktok',
      status: 'active',
    },
  });

  const count = await prisma.service.count();
  if (count === 0) {
    await prisma.service.create({
      data: {
        name: 'TikTok Followers HQ',
        categoryId: cat.id,
        min: 10,
        max: 100000,
        price: 2.5,
        cost: 1.5,
        status: 'active',
        averageTime: '0-6 hours',
      },
    });
  }

  console.log('Seed OK. Admin:', email, 'Password:', password);
  console.log('Admin id:', admin.id);
}

main().catch(console.error).finally(() => prisma.$disconnect());
