# Deployment

The app is a standard Next.js 16 server application with a PostgreSQL database. It runs on any Node.js host; the two easiest options are below. Nothing here incurs cost on the free tiers at club scale.

## 1. Database (any managed Postgres)

Create a database with **Neon**, **Supabase** or **Vercel Postgres** and copy its connection string.

- On serverless hosts use the **pooled** connection string (Neon: `-pooler` host; Supabase: port 6543). The client is already configured for transaction poolers.
- Run the migrations and seed once from your machine (or CI) against that database:

```bash
DATABASE_URL="postgres://…" npm run db:migrate
DATABASE_URL="postgres://…" SEED_ADMIN_EMAIL="you@…" SEED_ADMIN_PASSWORD="a-long-password" SEED_ADMIN_NAME="Your Name" npm run db:seed
```

- Recommended: `DATABASE_URL="postgres://…" npm run db:public-role -- "<16+ char password>"` and use the printed value as `DATABASE_URL_PUBLIC`.

## 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (pooled on serverless) |
| `APP_URL` | yes | Public origin, e.g. `https://calendar.bfc.example` — used in subscription URLs and feed links |
| `DATABASE_URL_PUBLIC` | recommended | Connection string of the restricted `bfc_public` role |
| `CRON_SECRET` | optional | Bearer secret for `/api/cron/publish` |
| `SEED_ADMIN_*` | seed only | Used by `npm run db:seed`; not needed at runtime |

## 3a. Vercel

1. Import the Git repository in Vercel (framework: Next.js, no settings to change).
2. Add the environment variables above (Production and Preview).
3. Deploy. Every push to the production branch redeploys automatically.
4. Scheduled publication works without cron (due events are published the next time the public calendar or feed is requested). For exact timing add `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/publish", "schedule": "*/15 * * * *" }] }
```

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set. (Hobby plans limit cron frequency to once a day.)

## 3b. Netlify

1. Import the repository; Netlify detects Next.js and uses its Next.js runtime (`@netlify/plugin-nextjs`, added automatically).
2. Build command `npm run build`, publish directory `.next`.
3. Add the same environment variables.
4. Optional cron: a Netlify Scheduled Function that calls `/api/cron/publish` with the bearer secret.

## 3c. Any Node host / Docker

```bash
npm ci && npm run build
DATABASE_URL=… APP_URL=… npm run start        # listens on $PORT or 3000
```

Health check: `GET /api/health` (200 when the database answers).

## After the first deploy

1. Sign in, set the **Victoriales date**, import and approve the academic calendars, invite the board.
2. Open `/feeds/public.ics` in a browser: it should download a calendar. Subscribe to it from one phone to verify.
3. Share `https://<your-domain>/subscribe` with members.

## Migrations on later releases

Run `npm run db:migrate` against production **before** deploying code that needs the new schema. Migrations are plain SQL in `drizzle/` and are applied once each.

## Monitoring (optional)

- Server errors are logged to stdout with an `[action]` prefix (visible in Vercel/Netlify logs).
- For error tracking, add Sentry (or similar) via `src/instrumentation.ts`; no code depends on it.
