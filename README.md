# AngKer SMM — HTML + CSS + JavaScript + Express

Real full-stack panel (not a static demo).

## Stack

- **Frontend:** HTML5, CSS3, Vanilla JS (Fetch API)
- **Backend:** Node.js + Express
- **Database:** Prisma (SQLite dev / PostgreSQL production)
- **Auth:** JWT + bcrypt
- **Payments:** ABA (khmer-system.com) server-side
- **Providers:** SMM API v2 multi-provider

## Setup

```bash
cd angker-smm-html
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET / NEXTAUTH_SECRET, ADMIN_*

npm install
npx prisma generate --schema=database/schema.prisma
npx prisma db push --schema=database/schema.prisma
npm run db:seed

npm run dev
# http://localhost:3000
```

## Environment

```
DATABASE_URL="file:./dev.db"
JWT_SECRET="long-random-secret-min-32-chars"
ADMIN_EMAIL="admin@angkersmm.com"
ADMIN_PASSWORD="ChangeMe@123!"
ABA_API_URL="https://khmer-system.com"
ABA_API_KEY=""
ABA_MERCHANT_ID=""
PORT=3000
```

## Features preserved

- Register / Login / JWT / Forgot password
- Dashboard, New Order, Orders, Add Balance
- Multi-provider API keys + balance + user-enabled toggle
- ABA payment generate/check + idempotent credit
- Atomic orders + provider submit + refund on fail
- Admin providers & payments pages
- Secrets stay on server only

## Production DB

Change `database/schema.prisma` provider to `postgresql` and set Postgres `DATABASE_URL`.
