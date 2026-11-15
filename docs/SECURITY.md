# Security

## What must never leak

Internal notes, tentative/proposed dates, unpublished events, tasks and deadlines, comments, attachments, organisers, speaker contact details and notes, the audit log, restriction overrides.

## Where it is enforced

| Layer | Mechanism |
|---|---|
| **Database** | Public code reads only the `public_events` view (`drizzle/0001_public_view.sql`), which selects published, dated, non-archived events and a fixed list of safe columns. With `DATABASE_URL_PUBLIC` set to the `bfc_public` role (`npm run db:public-role -- <password>`), the database itself refuses any other read from public code paths. A test asserts the view exposes no private column. |
| **Server (pages)** | Every `/board` page calls `requireUser(role)`, which re-reads the user and role from the database on each request. |
| **Server (mutations)** | Every server action calls `requireActor(role)`; `src/lib/events/service.ts` and the other services re-check ownership (`canEditEvent`, `canEditTask`, …) and validate input with zod. Client-side visibility is a convenience only. |
| **Feeds** | Public feed → `public_events`. Private feed → hashed token lookup + owner must be active, on every request. |
| **Edge** | `src/proxy.ts` redirects cookieless requests away from `/board` (optimistic only — not relied upon). |

## Authentication

- Passwords: scrypt (N=16384) with a per-user salt, minimum 10 characters, never logged.
- Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie; only its SHA-256 is stored; 30-day expiry; deleted on sign-out and on deactivation.
- Identical error for unknown email and wrong password; constant work for unknown accounts.
- Accounts come from a Super Admin: a personal invitation or an invitation link (see Accounts below). Personal links are single-use, hashed at rest, valid 7 days. No email is sent by the app.
- Deactivating a user deletes their sessions, revokes their private feed tokens and their pending links. The last active Super Admin cannot be demoted or deactivated.

### Accounts

- **First account.** `/setup` works only while the users table is empty. The insert runs under a database lock, so two simultaneous requests cannot both create an admin. Set `SETUP_TOKEN` on a new deployment: the page then asks for it, and nobody else can claim the site between the deploy and your first visit.
- **Personal invitations** (one person, one link, 7 days) set a password; accepting one ends every earlier session of that account.
- **Invitation links** (Settings → People & roles) let several people create their own account with a role chosen by the Super Admin. Rules enforced on the server: only a Super Admin creates or revokes them; a link grants Board Member or Board Admin, never Super Admin; 1–100 accounts; 1–30 days; the counter is taken atomically, so the quota cannot be exceeded by simultaneous sign-ups; the link stops working if its author is deactivated or demoted; only the hash of the secret is stored; failed attempts are throttled; every creation, revocation and sign-up is in the audit log.
- **Sign-in throttling.** 8 failures per email and address, and 20 per email whatever the address, per 15 minutes. An account without a password (invitation not yet accepted) can never sign in.
- **Profile.** Everyone edits their own name, email and password at `/board/profile`. The account is taken from the session, never from the request; role and status cannot be changed there. Changing email or password requires the current password (throttled); a new password signs out the other devices.
- **Published events.** Once an event is on the members calendar, only a Board Admin can change what members see (title, text, date, place, links, widget). Organisers keep access to private planning fields.

## Private calendar feeds

- The token is the only credential a calendar app can present, so it lives in the URL path. It is random (256 bits), contains no user data, is stored hashed, shown once, and can be rotated or revoked by its owner (or revoked by a Super Admin through deactivation).
- Responses: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.
- Internal notes are **not** included even in the private feed, limiting damage if an address leaks.
- Treat the address like a password: anyone who has it can read the board calendar until it is rotated.

## Other measures

- Server actions are same-origin POSTs (Next.js checks `Origin`); cookies are `SameSite=Lax`.
- Links entered by users (registration, online, attachments) are restricted to `http(s)`.
- Output is rendered by React (escaped); descriptions are plain text, never HTML.
- CSV export neutralises spreadsheet formulas.
- File imports: 8 MB limit, type sniffed from content, parsed in memory, never stored or executed.
- Security headers: HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Audit log: every publish/unpublish, status change, reschedule, override (with reason), role change, rule change, import approval. Speaker contact fields are recorded as "changed", not by value.

## Hardening checklist for production

- [ ] HTTPS only (default on Vercel/Netlify); set `APP_URL` to the real origin.
- [ ] Strong `SEED_ADMIN_PASSWORD`; change it after first sign-in by issuing yourself a sign-in link.
- [ ] Create the restricted role and set `DATABASE_URL_PUBLIC`.
- [ ] Set `CRON_SECRET` if you use scheduled publication via cron.
- [ ] Database backups enabled at the provider.
- [ ] Keep at least two Super Admins (handover between boards).
- [ ] Optional: add a Content-Security-Policy and error monitoring (see `docs/DEPLOYMENT.md`).

## Known limitations

- No two-factor authentication.
- Rate limiting is per account + IP in the database; there is no global request rate limiter (use the host's firewall if needed).
- No Content-Security-Policy header is set by default (the theme bootstrap uses a small inline script; a nonce-based CSP can be added).
