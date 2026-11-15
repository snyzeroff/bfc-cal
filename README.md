# BFC Calendar

Conference planning and public events calendar for the **Bachelor Finance Club** (CentraleSupélec).

- **Board workspace** (private): plan conferences from idea to publication, hold tentative dates while a speaker decides, track speakers and tasks, and see academic constraints and the "no conference before exams" rule on one calendar.
- **Members calendar** (public): only events a Board Admin has explicitly published.
- **Live subscriptions**: two real iCalendar feeds (public and per-user private) that calendar apps refresh by themselves.

| | |
|---|---|
| Stack | Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL · Drizzle ORM · FullCalendar 6 |
| Time zone | Europe/Paris everywhere in the UI; instants stored in UTC |
| Tests | Vitest (unit + integration on a real Postgres) · Playwright (end-to-end) |

## Quick start

Requires Node.js ≥ 20.9 and PostgreSQL ≥ 14.

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL and the first admin's credentials
npm run db:migrate                # create the schema
npm run db:seed                   # reference data + first Super Admin (idempotent)
npm run dev                       # http://localhost:3000
```

`npm run db:demo` additionally creates sample people, speakers and events (never academic dates — those must come from an imported calendar).

Sign in at `/login` with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then:

1. **Academic → Import calendar**: upload the official year calendar PDF, review the extracted periods, approve them. The rule "no conference in the 21 days before exams" is computed from the approved exam dates; until some exist, the app says it cannot be enforced.
2. **Settings → Scheduling rules**: adjust the rule if needed (number of days, include midterms) and add your own.
3. **Settings → People & roles**: invite the rest of the board (you get a one-time link to send them).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Development server / production build / production server |
| `npm run db:migrate` | Apply SQL migrations from `drizzle/` |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:seed` / `db:demo` | Reference data and first admin / plus demo content |
| `npm run db:public-role -- <password>` | Create the restricted database role for public reads (see `docs/SECURITY.md`) |
| `npm run typecheck` / `lint` | Static checks |
| `npm test` | Unit and integration tests (needs a database, see below) |
| `npm run test:e2e` | Playwright end-to-end tests (builds the app, uses its own database) |

### Running the tests

```bash
createdb bfc_test && createdb bfc_e2e          # once
npm test                                       # TEST_DATABASE_URL defaults to postgres://bfc:bfc@localhost:5432/bfc_test
npm run test:e2e                               # E2E_DATABASE_URL defaults to …/bfc_e2e
```

Both suites wipe and re-migrate their database, and refuse to run against a database whose name does not contain `test` or `e2e`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — decisions, data model, permission model, calendar synchronisation
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, what is enforced where, hardening checklist
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Vercel / Netlify + managed Postgres, environment variables, cron
- [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) — how the board uses it day to day
- [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md) — yearly rollover, backups, upgrades
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — implementation checklist, test status and known limitations

## Project layout

```
drizzle/                 SQL migrations (0001 creates the public_events view)
scripts/                 migrate, seed, public-role
src/db/schema.ts         database schema (single source of truth)
src/lib/                 domain logic — pure where possible
  time.ts                Europe/Paris ↔ UTC, calendar-day arithmetic
  restrictions.ts        restriction engine (days before exams, date ranges, academic kinds)
  scheduling.ts          scheduling assistant (pure)
  ics.ts                 RFC 5545 writer
  feeds.ts               public + private feed builders, token management
  public.ts              read model for unauthenticated visitors (public_events view only)
  permissions.ts         role matrix
  events/service.ts      every event mutation: permissions, restrictions, versioning, audit
  academic/              PDF / ICS / CSV extraction and the review workflow
src/app/                 routes: (public) pages, /board workspace, /feeds, /api, server actions
src/components/          UI kit (ui.tsx) and board components
tests/                   unit + integration tests
e2e/                     Playwright specs
```
