# Progress log and status

_Last updated: 15 November 2026._

## Verification status (what was actually run)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` — unit + integration on a real PostgreSQL 16 | **126 passed** (4 files) |
| `npm run test:e2e` — Playwright against a production build | **23 passed** (desktop + mobile projects) |
| Accessibility — axe, WCAG 2.1 A/AA, light and dark, 20 screens | no serious or critical violation (one FullCalendar-internal rule excluded, see limitations) |
| Feed validity | generated `.ics` parsed by an independent RFC 5545 parser (`ical.js`) in tests |

Not verified, because it needs real accounts/devices: subscribing from actual Apple Calendar, Google Calendar and Outlook clients; a real deployment.

## Definition of done

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Authorised board members can log in | ✅ | `e2e/board.spec.ts`, `e2e/public.spec.ts` (wrong credentials) |
| 2 | Create and manage conferences | ✅ | e2e conference workflow; `tests/integration.test.ts` |
| 3 | Tentative dates can be tracked | ✅ | "tentative dates" integration tests; e2e steps 1–3 |
| 4 | Confirmed events can be published | ✅ | "publication is a separate, controlled step" |
| 5 | Public users see only published events | ✅ | "database-level privacy" tests; `e2e/public.spec.ts` |
| 6 | Both subscription feeds work | ✅ | "feed synchronisation", "private feed tokens"; e2e private subscription |
| 7 | Changes appear correctly in feeds | ✅ | reschedule / cancel / DST tests; e2e steps 5–7 |
| 8 | Private data stays protected | ✅ | view column test, speaker contact test, API/404 e2e |
| 9 | Academic layers can be imported and reviewed | ✅ | `tests/academic-parse.test.ts`; `e2e/academic.spec.ts` (real PDF through the UI) |
| 10 | Scheduling restriction enforced | ✅ | The brief said "Victoriales"; the administrator later clarified the rule is **no conference in the 21 days before exams**. Implemented as the built-in rule: "no conference in the 21 days before exams" (7 integration tests) and the e2e exam-rule scenario. The fixed key-date variant is still covered by "key-date restriction". |
| 11 | Works on desktop and mobile | ✅ | `e2e/mobile.spec.ts` + visual review at 390 px and 1440 px |
| 12 | Critical workflows are tested | ✅ | see table below |
| 13 | Can be configured and deployed | ⚠️ ready, **not deployed** | `docs/DEPLOYMENT.md`; needs a Git repository, a host and a database |
| 14 | Maintainable and documented | ✅ | `README.md`, `docs/` |

## Edge cases from the brief → tests

| Edge case | Test |
|---|---|
| Private → public | integration: "private → public…" |
| Published → private again | integration: "public → private…", "moving a public event back to a planning status…" |
| Event cancelled | integration: "a cancellation reaches subscribers…"; e2e step 7 |
| Tentative date replaced by a confirmed date | integration: "confirming one option…"; e2e step 3 |
| Private feed token revoked | integration: "a revoked token…", "rotation…"; e2e private subscription |
| Board member losing access | integration: "a board member who loses access…" |
| Academic PDF with ambiguous dates | integration: "an ambiguous date is flagged…"; parser: "is candid about what it is less sure of" |
| Conference inside a restricted period (before exams) | integration + e2e (blocked for members and admins; meetings exempt; both window edges) |
| Restricted period changing after events are scheduled | integration: "recalculates when the Victoriales date changes…" |
| Feed updates after rescheduling | integration: "rescheduling keeps the UID…"; e2e step 6 |
| Daylight-saving transitions | unit: time (spring + autumn 2027); integration: "writes correct instants on both sides…" |
| Two administrators editing the same event | integration: "the second of two administrators…" |
| Public user requesting private data | integration: "a public visitor cannot fetch…"; e2e 404 on page, API and export |
| Subscriber refreshing after a cancellation | integration: cancellation + retention window |

## Implementation checklist

**Core**
- [x] Email + password auth, DB sessions, invitation / reset links, login throttling
- [x] Roles: Super Admin, Board Admin, Board Member (+ anonymous members), enforced server-side
- [x] Events: CRUD, 9 statuses, duplicate, archive/restore, permanent delete (Super Admin), optimistic locking, undo for move / status / archive
- [x] Publication as a separate action; scheduled publication (lazy + cron endpoint)
- [x] Proposed dates with speaker availability; confirm → others released, history kept
- [x] Board calendar: month, week, day, agenda, timeline; drag & drop, resize, click-to-create; filters; layers; search; keyboard shortcuts
- [x] Members calendar: agenda + month, category filter, event pages, single-event `.ics` export
- [x] Feeds: public + per-user private (hashed, rotatable, revocable), cancellation retention, refresh hints
- [x] JSON API of published events (`/api/public/events`)
- [x] Luma registration widget per event (allow-listed, sandboxed iframe) and a "featured" event at the top of the members site

**Scheduling**
- [x] Built-in rule: no conference in the N (21) days before each approved exam session, optional for midterms, hard block, Super Admin override with reason + audit
- [x] Generic rules: fixed date ranges and academic kinds, hard/soft, per event type
- [x] Academic layers per program/year; overlays on month/week/day; rows in the timeline
- [x] Import: PDF (geometry-based), `.ics`, `.csv` → review → approve; confidence, issues, source reference, file hash
- [x] Scheduling assistant with explained suggestions and five day states

**Collaboration**
- [x] Speakers directory (private contact data, status, owner, linked conferences)
- [x] Tasks with assignee and deadline, per event and general; progress; conference template with relative deadlines
- [x] Comments, link attachments, per-event history
- [x] Dashboard (next up, needs attention, my tasks, restricted-periods card)
- [x] Audit log (Super Admin), CSV export of events

**Customisation**
- [x] Brand colours, org name, theme default, density, event style, colour-by, default views, week start, weekends, visible hours
- [x] Status labels and colours; category colours, icons and types
- [x] Light / dark / system theme per user

## Content loaded for 2026–27 (at the administrator's request)

Applied once at deploy by `src/lib/bootstrap-2026.ts`:

- BoE Y1/Y2 (version 08/09/2026) and AIDAMS Y1 calendars from 1 November 2026: 198 periods approved automatically (extractor confidence ≥ 75 %); the 18 rows it was unsure about were then checked by eye against the PDFs and approved with corrections (`REVIEWED` in the same file), and two automatically approved rows that were wrong on a weekend edge were fixed. 67 rows before November are set aside. One label is cut off in the source document and kept as “Retour Learning…”.
- The conference "Philippe Heim – Conference Q&A" (17 November 2026, 19:00–20:30, Breguet — Amphi 270), with details taken from its Luma page: created as confirmed and featured, **not published**.

## Known limitations (not done, or done differently — stated plainly)

- **Not deployed.** No external service was contacted. Deployment needs a repository to push to, a host (Vercel or Netlify) and a PostgreSQL database.
- **No email.** Invitations and password links are shown to the Super Admin to send; there are no email or push reminders. Deadlines surface on the dashboard, the board calendar and the private feed.
- **Attachments are links**, not uploaded files (no storage service configured). Imported calendar files are parsed and discarded; only their hash and extracted rows are kept.
- **Statuses can be renamed and recoloured, not added or removed** — the workflow rules depend on the fixed set.
- **Event import** from CSV/ICS is not implemented (export is; academic calendars can be imported from PDF/ICS/CSV).
- **Language:** the interface is English only. Dates and times use `Intl`, but strings are not yet externalised for translation.
- **Live updates:** pages show current data on load and after every action; there is no push channel, so two people looking at the same screen see each other's changes after a refresh (conflicting saves are detected and refused).
- **Timeline view is read-only** (click to open or create; drag & drop is in month/week/day).
- **Calendar clients:** feeds were validated with a standards parser, not with real Apple/Google/Outlook accounts. Refresh timing is decided by each client.
- **PDF extraction** is tuned to the current CentraleSupélec layout. On the three provided files it reads the main periods correctly (asserted in tests against values read by eye), and flags what it is unsure about: unfilled cells such as vacations (80 %), cells merged across year columns (75 %), clipped labels in the AIDAMS file ("S2", "Welcome Orientation Day at ESSEC", "Climate Day & Career Workshop"), and spans that start on a weekend. The "BoE FINAL" file is covered by invariant tests only.
- **Accessibility:** one axe rule (`label-content-name-mismatch`) is excluded inside the FullCalendar grid, whose day cells are labelled with the full date while showing the day number. No manual screen-reader pass was done.
- **Security:** no 2FA, no global rate limiter, no CSP header by default (see `docs/SECURITY.md`).

## Skills and research used

- `vercel-labs/skills` → **find-skills** installed and read. Its search backend (`skills.sh`) is blocked by this environment's network policy, so discovery was done by listing the trusted `vercel-labs/agent-skills` repository directly.
- **web-design-guidelines** (Vercel): rules fetched and applied — skip links, visible focus, `touch-action`, `overscroll-behavior` in dialogs, tab state in the URL, confirmations for destructive actions, `content-visibility` for the long review list, reduced motion, tabular numbers.
- **vercel-react-best-practices**: parallel data loading, authenticated server actions, `React.cache` for per-request reads, the public month grid loaded on demand.
- **deploy-to-vercel** (Vercel) and **rune-kit/rune `deploy`**: both read. The rune kit was not installed (it also registers agent hooks); its pre-deploy gate → deploy → verify → report procedure is what `docs/DEPLOYMENT.md` follows.
- **apple-design** (emilkowalski/skills): read in full and applied to the public site and the shared theme — neutral greys, platform font first, size-specific tracking and tight leading on display type, translucent navigation with a hairline edge (and solid fallbacks for reduced transparency / more contrast), press feedback on pointer-down, opacity+transform-only entrance with a reduced-motion variant, restraint over decoration. Not applied: its gesture/spring rules (drag physics, momentum, rubber-banding), since the site has no custom gesture-driven surfaces.
- **neon-postgres** (Neon): pooled connection for the app, direct connection for migrations (`DATABASE_URL_UNPOOLED`), migrations run at deploy, free-plan suspend behaviour documented in `docs/DEPLOYMENT.md`. Chosen over the Supabase skill because the app only needs plain Postgres, not Supabase Auth or its client.
- Next.js 16 bundled documentation (`node_modules/next/dist/docs`) for the changed conventions (`proxy.ts`, caching model, inline theme script).

## Log

1. Environment survey; PDFs rendered and inspected; local PostgreSQL started.
2. Schema, migrations, `public_events` view; auth, permissions, audit.
3. Domain logic: time, restriction engine, scheduling assistant, iCalendar writer, event service, feeds.
4. UI kit and design tokens; board shell; calendar (FullCalendar + custom timeline); event editor; pipeline; speakers; tasks; academic import + review; subscriptions; settings.
5. Public calendar, event pages, subscribe page, feed and API routes.
6. Tests: unit → integration → end-to-end → accessibility. Bugs found and fixed along the way: public read path returned timestamps as text; a client helper was called from a server component; restricted-period background inherited the calendar library's default green.
7. PDF extractor completed and verified against the documents; month-boundary joining and weekend-edge flag added.
8. Guideline pass (Vercel web interface guidelines), contrast fixes in both themes, documentation.
9. Review round with parallel agents (15 Nov 2026). Added: profile page, invitation links with role and quota, styled dropdowns with avatars for task assignment, open/close animations, redesigned sign-in / setup / invitation pages, shorter interface text, registration widget shown unfolded. Fixed from the security review: sign-in bypass for accounts without a password, racy first-run setup, sessions surviving a password reset, edits to published events by non-admins, thin throttling, CSV formula injection through a bare carriage return. Fixed from the code review: one-off 2026 content could be re-created by a later deploy, stale-version saves in the event editor, hidden last day on timed events, program filter, calendars imported after a first visit staying hidden, reassigning a task wiping its deadline, unescaped `;` in feeds.
10. Follow-up (16 Nov 2026). The name at the bottom of the sidebar now opens an account menu (profile, settings for Super Admins, subscriptions, theme, sign out) instead of going straight to the profile. Remaining review items done: the event page loads its data once per request; template tasks get their deadline when the event gets its date (new `tasks.offset_days`); iCalendar import places timed events on the Paris day, treats a midnight end as exclusive and reads DURATION; the same file cannot be imported twice; an event ending at midnight no longer shows on the following day. Left as is: a successful action refreshes the page twice (server revalidation plus a client refresh) — harmless, kept because removing either needs a pass over every action.
