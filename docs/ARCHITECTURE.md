# Architecture

## Decisions and why

| Decision | Choice | Reasoning |
|---|---|---|
| Framework | **Next.js 16, App Router**, server components + server actions | One deployable unit for pages, mutations and feed endpoints. Server actions keep every write on the server with typed inputs. |
| Rendering model | Request-time rendering (`dynamic = "force-dynamic"`), Cache Components **off** | Every page shows live, permission-dependent data ("live website updates"). Caching would trade correctness for speed the club does not need; feeds must never be stale. |
| Database | **PostgreSQL** via `postgres.js` + **Drizzle ORM** | Mature, portable across Neon / Supabase / Vercel Postgres / self-hosted. Drizzle gives typed queries and plain SQL migrations that are reviewable. `prepare: false` keeps it compatible with transaction poolers. |
| Auth | **Built in**: email + password (scrypt), server-side sessions in the database, invitation links | No third-party auth service to configure, pay for or lose access to when the board changes. Sessions are revocable instantly (needed for "a board member losing access"). |
| Calendar UI | **FullCalendar 6** (MIT plugins) for month / week / day / agenda, **custom timeline** | FullCalendar is the most proven drag-and-drop calendar; its own timeline view is a paid plugin, and a purpose-built timeline shows academic layers and restricted periods better anyway. |
| iCalendar | **Hand-written RFC 5545 writer** (`src/lib/ics.ts`), verified in tests with the independent `ical.js` parser | The output format is small; owning it gives exact control over UID, SEQUENCE, STATUS and line folding, which is where feed bugs live. |
| PDF import | `pdfjs-dist` on the server, geometry-based extraction, **mandatory human review** | The school calendars are colour-coded Excel grids; dates come from cell geometry, which is inherently fallible. Nothing extracted is used until approved. |
| UI kit | Tailwind CSS 4 + Radix primitives, own components (`src/components/ui.tsx`) | Accessible behaviour (focus traps, keyboard menus) from Radix; full control over the visual identity; no generated component sprawl. |
| Attachments | Links (Drive, Notion…), not uploads | Avoids a file-storage service and its costs/credentials. The data model is ready for uploads if a store is added later. |

## Time

- Every instant is stored as `timestamptz` (UTC). Calendar days without a time (task deadlines, academic periods) are stored as `date`.
- `src/lib/time.ts` is the only place that converts between Paris wall-clock time and instants (`parisToInstant`, `parisParts`), using `@date-fns/tz`, so daylight-saving transitions are handled once and tested (`tests/unit.test.ts`).
- The browser never does time-zone maths. The server sends "wall" strings (`2027-03-28T18:30`, Paris time) and FullCalendar is run in its zone-less mode, so a board member travelling abroad still sees and edits Paris times.
- Feeds emit timed events in UTC (`…Z`) — unambiguous for every client — and all-day events as `VALUE=DATE` with an exclusive end.

## Data model (main tables)

```
users ─┬─ sessions            invite_tokens        login_attempts
       ├─ feed_tokens         (hashed secrets for private subscriptions)
       └─ audit_log           (who / what / when / before→after / reason)

categories (kind: conference | meeting | deadline | social | other)
speakers   (public: name, organisation, position, bio · private: contact, notes, status, owner)

events ─┬─ event_proposals    candidate dates: active → confirmed | released | declined (never deleted)
        ├─ event_organizers
        ├─ tasks              (also standalone, event_id null)
        ├─ comments
        └─ attachments        (links)

academic_layers ── academic_entries        verified periods (teaching, exam, midterm, reading, vacation, holiday…)
academic_imports ── import_candidates      extracted periods awaiting review, with confidence, issues and source reference

restriction_rules   academic_kind (built in: 21 days before exams) | date_range | victoriales · hard | soft · applies_to category kinds
settings            appearance, feed options (JSON, validated with zod on read and write)
templates           conference templates with relative task deadlines

VIEW public_events  the only relation the public side reads (see Security)
```

Two fields on `events` matter for correctness:

- `version` — incremented on every write; mutations carry the version the editor loaded (`expectedVersion`) and the `UPDATE … WHERE version = ?` is atomic. A mismatch returns a conflict naming who saved first.
- `sequence` — the iCalendar `SEQUENCE`; incremented only when something a subscriber can see changes (title, times, place, description, speaker, status, publication).

## Status vs. publication

`status` describes where the event is in its life (idea → proposed → awaiting confirmation → tentative → confirmed → published → completed, or postponed / cancelled). `is_public` is a separate boolean changed only by the **Publish / Unpublish** actions, which require a Board Admin.

- Confirming a date never publishes.
- "Published" cannot be chosen as a plain status; publishing sets it.
- An event is visible to members only if `is_public` **and** its status is one of published / postponed / cancelled / completed **and** it is not archived **and** it has a date. This predicate lives in the `public_events` view, i.e. in the database.
- Moving a public event back to a planning status, or archiving it, unpublishes it.

## Tentative dates

`event_proposals` hold candidate dates with the speaker's answer (`unknown` / `available` / `unavailable` — "unknown" means nobody has an answer, not "free"). Confirming one proposal, in a single transaction: sets the event's date, sets status to confirmed, marks that proposal `confirmed` and every other active one `released`. Rows are never deleted, so the history of what was offered remains.

## Restriction engine

`src/lib/restrictions.ts` is pure. Rules are expanded into concrete date **windows**:

- `academic_kind` — one window per **verified** academic entry of the chosen kinds/layers. With `daysBefore: N` the window is the N calendar days immediately before the entry (`[start − N, start − 1]`): this is the built-in rule **"no conference in the 21 days before exams"** (`kinds: ["exam"]`, optionally midterms). Without it the window is the period itself (used for the default soft warnings).
- `date_range` — fixed dates.
- `victoriales` — N days before a fixed key date stored in settings. Kept in the engine and tested, but no longer created by default nor exposed in the interface.

Each window is `hard` or `soft` and applies to a set of category kinds (the exam rule applies to `conference` only, so board meetings are exempt).

Enforcement happens in `events/service.ts` (`enforceRestrictions`) for every path that puts a conference on a date: create, update/move (drag & drop included), add a proposal, confirm a proposal. Hard violations throw `restricted` unless the actor is a Super Admin **and** supplied a reason (≥ 5 characters); the reason is stored on the event and written to the audit log as `restriction.override`.

Windows are computed on read, so approving or correcting exam dates immediately moves the restricted periods everywhere. Events already scheduled inside the new window are not silently moved: they are flagged on the dashboard, in the calendar, on the event page and in the settings screen (`findRestrictedEvents`).

## Scheduling assistant

`src/lib/scheduling.ts` (pure) classifies each day of a range as **available / potential conflict / restricted / unavailable / unknown**, with the reasons:

- *restricted*: a hard rule covers the day;
- *unavailable*: the speaker said no, or another conference is confirmed that day;
- *potential conflict*: soft rule, exams/midterms/reading days, vacations/holidays, a school event, another BFC event or a tentative hold, a weekend;
- *available*: none of the above **and** verified teaching-period data covers the day for the event's audience;
- *unknown*: no verified academic data for that day — the assistant cannot tell.

Speaker availability is reported separately (confirmed / not confirmed / unavailable). Imported-but-unreviewed periods are not used; the assistant states how many exist in the range.

## Calendar subscriptions

Two endpoints generate RFC 5545 calendars at request time (no cache):

| Feed | URL | Content |
|---|---|---|
| Public | `/feeds/public.ics` | `public_events` only |
| Private | `/feeds/board/<token>.ics` | Events the token's owner may see: all non-archived dated events, optionally proposed dates (`[Option] …`, TENTATIVE) and open task deadlines |

Behaviour that makes updates reliable across clients:

- **Stable UID** `event-<uuid>@bfc-calendar` (also `proposal-…`, `task-…`), never reused.
- **SEQUENCE** increases on every subscriber-visible change; `LAST-MODIFIED`/`DTSTAMP` carry the modification time.
- **Cancellation**: the event stays in the feed with `STATUS:CANCELLED`, a `Cancelled:` title prefix (for clients that ignore the status) and `TRANSP:TRANSPARENT`, for a configurable retention period (default 30 days), then it is dropped.
- **Unpublishing / deleting**: the event simply disappears from the feed; subscription clients replace their copy of the calendar at each refresh, so it disappears there too.
- **Refresh hints** `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` (default 1 h). They are hints.

What the app cannot control — and says so in the UI: each calendar application decides when to re-fetch a subscription. In practice Apple Calendar honours short intervals (down to 5 min when set by the user), Outlook refreshes every few hours, and Google Calendar typically every 12–24 h with no manual refresh.

Private feed security: 256-bit random token, only its SHA-256 stored, shown once, per user, rotatable and revocable; on each request the owner's account is re-checked (`active`), responses are `no-store`, `noindex`, `Referrer-Policy: no-referrer`, and unknown/revoked/deactivated all return the same 404.

## Permissions

`src/lib/permissions.ts` holds the matrix; every server action and service re-checks it (the UI only hides what would fail).

| | Member / visitor | Board Member | Board Admin | Super Admin |
|---|---|---|---|---|
| Public calendar, feed, event pages | ✓ | ✓ | ✓ | ✓ |
| View board calendar, speakers, tasks | | ✓ | ✓ | ✓ |
| Create events / propose dates / suggest speakers | | ✓ | ✓ | ✓ |
| Edit an event | | own or organised | all | all |
| Publish / unpublish, archive, change status of public events | | | ✓ | ✓ |
| Assign tasks to others, manage all speakers | | | ✓ | ✓ |
| Import and approve academic calendars | | | ✓ | ✓ |
| Users, roles, rules, appearance, audit log | | | | ✓ |
| Override a hard restriction (reason required, audited) | | | | ✓ |
| Delete an event permanently | | | | ✓ |

## Academic import pipeline

```
file ──► parseCalendarFile ──► academic_imports + import_candidates (status: pending)
                                         │  review UI: edit label/kind/dates/layer, approve, reject
                                         ▼
                               academic_entries (verified = true, verified_by, source reference)
                                         │
              calendar overlays ◄────────┼────────► restriction windows ◄──► scheduling assistant
```

- PDF: `src/lib/academic/parse-pdf.ts` reads positioned text and filled rectangles, maps cells to days per month block and program column, and assigns a confidence with explicit issues (clipped text, merged columns, inferred span…).
- `.ics` and `.csv` are supported for sources that are already structured.
- Each candidate keeps its source (file, page, cell box, original text); the import keeps the file's SHA-256 and any version label printed on the document.
