# Maintenance

## Every academic year

1. **Settings → Scheduling rules**: add the new Victoriales edition and its date (keep past editions for history, or remove them).
2. **Academic → Import calendar**: import the new year's PDF(s). Review and approve. Old periods can stay (they are in the past) or be removed by deleting a layer's entries.
3. **Settings → People & roles**: invite the new board, deactivate members who left (this ends their sessions and private feeds), and make sure at least two Super Admins remain.
4. Archive last year's completed events if the pipeline feels crowded (they remain searchable under *Archived*).

## Handover between boards

- Promote the incoming president (or tech lead) to Super Admin **before** deactivating the outgoing one. The app refuses to remove the last Super Admin.
- Hosting and database accounts should belong to a shared club mailbox, not a personal account.

## Backups

Use the database provider's backups (Neon and Supabase keep point-in-time history). To take a manual copy:

```bash
pg_dump "$DATABASE_URL" --no-owner --format=custom -f bfc-$(date +%F).dump
pg_restore --no-owner -d "$NEW_DATABASE_URL" bfc-YYYY-MM-DD.dump
```

## Changing the schema

1. Edit `src/db/schema.ts`.
2. `npm run db:generate -- --name what_changed` creates a SQL file in `drizzle/`. Read it.
3. If a public-facing column is added, decide explicitly whether it belongs in `public_events` and add a migration that recreates the view. The privacy test (`tests/integration.test.ts`, "the public view exposes no private column") must keep passing.
4. `npm run db:migrate`, then `npm test`.

## Upgrading dependencies

- `npm outdated`, upgrade, then `npm run check && npm run test:e2e`.
- Next.js: read `node_modules/next/dist/docs/` for the installed version before changing framework APIs — version 16 renamed and changed several conventions (`proxy.ts`, async `params`, caching).
- FullCalendar is pinned to v6 (the v6 plugins and v7 core are not compatible).

## When the school changes the PDF layout

The extractor (`src/lib/academic/parse-pdf.ts`) assumes the current layout: one page, month blocks side by side, one row per day, program sub-columns. If a new layout extracts badly:

- the review screen will show low confidence and warnings — do not approve blindly;
- fall back to adding periods manually (Academic → Add period) or importing a `.csv` (`label,start,end,kind,layer`);
- then adapt the extractor and add the new file as a fixture in `tests/fixtures/academic/`.

## Useful queries

```sql
-- Who can sign in
select name, email, role, active, last_login_at from users order by role, name;
-- What members can see right now
select title, start_at, status from public_events order by start_at;
-- Recent sensitive actions
select at, actor_name, action, summary, reason from audit_log
where action in ('restriction.override','event.publish','event.unpublish','user.update','settings.victoriales')
order by at desc limit 50;
```
