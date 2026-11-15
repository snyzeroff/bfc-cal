# Deployment

The app is a standard Next.js 16 server application with a PostgreSQL database. It runs on any Node.js host; the two easiest options are below. Nothing here incurs cost on the free tiers at club scale.

## 1. Database — Neon (recommended)

Any managed PostgreSQL works (Supabase, Vercel Postgres, self-hosted). Neon is the simplest fit: it is plain Postgres reached by a connection string, has a free plan, and plugs into Vercel in a few clicks.

**With Vercel:** in the Vercel project → *Storage* → *Create Database* → *Neon*. The integration creates the database and sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) on the project for you.

**Without the integration:** create a project on neon.com, then copy two connection strings from *Connect*:

| Variable | Which string | Used for |
|---|---|---|
| `DATABASE_URL` | **Pooled** — hostname contains `-pooler` | the running application |
| `DATABASE_URL_UNPOOLED` | **Direct** — no `-pooler` | migrations and admin scripts |

Migrations must go through the direct connection: over the pooler they can fail in ways that do not mention pooling. The scripts in this repository pick `DATABASE_URL_UNPOOLED` automatically when it is set.

Schema migrations run **automatically on every deploy** (`vercel-build` / `build:deploy` run `scripts/migrate.ts` before `next build`). Create the first Super Admin once, from your machine:

```bash
DATABASE_URL="postgres://…(direct)…" SEED_ADMIN_EMAIL="you@…" SEED_ADMIN_PASSWORD="a-long-password" SEED_ADMIN_NAME="Your Name" npm run db:seed
```

Recommended afterwards: `DATABASE_URL="postgres://…(direct)…" npm run db:public-role -- "<16+ char password>"`, then set the printed value as `DATABASE_URL_PUBLIC`, replacing its hostname with the pooled one.

Things to know about Neon's free plan:

- The database **suspends after about 5 minutes without traffic** and wakes on the next request; that first page load takes a second or two longer. Calendar apps refreshing the feed wake it too.
- If the monthly compute or transfer allowance runs out, the database is suspended until the next period: nothing is deleted, but the site cannot read it. Club-scale usage is far below the limits; check the Neon dashboard if the site ever stops loading.
- Preview deployments share the production database unless you give them their own Neon branch. Since deploys run migrations, either enable Neon's "branch per preview" option in the Vercel integration or only deploy from the main branch.
- Point-in-time restore is available from the Neon dashboard if data is damaged.

## 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (pooled on serverless) |
| `DATABASE_URL_UNPOOLED` | recommended | Direct connection string for migrations (set automatically by Neon's Vercel integration) |
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
2. Build command `npm run build:deploy` (runs migrations, then builds), publish directory `.next`.
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

Migrations are plain SQL in `drizzle/`, applied once each, and run automatically at the start of every deploy build. To apply them by hand: `DATABASE_URL="…(direct)…" npm run db:migrate`.

## Monitoring (optional)

- Server errors are logged to stdout with an `[action]` prefix (visible in Vercel/Netlify logs).
- For error tracking, add Sentry (or similar) via `src/instrumentation.ts`; no code depends on it.
