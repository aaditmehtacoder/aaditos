# AaditOS

A private personal operating system for Aadit Mehta — a ninth grader at Wilcox
High School in Santa Clara who also builds software.

It exists to answer three questions, in this order:

1. **What is happening today?**
2. **What is most important right now?**
3. **What should I do next?**

Everything on screen serves one of those. School, assignments, the Wilcox
calendars, personal tasks, the Venu AI internship, Pick44, Origami Prep,
OpenRubric, GitHub, Vercel, opportunities, focus sessions, Spotify,
notifications and the Orbit assistant all live behind one authenticated shell.

---

## Contents

- [Technology](#technology)
- [Quick start](#quick-start)
- [Signing in](#signing-in)
- [Demo mode](#demo-mode)
- [Integration status](#integration-status)
- [Environment variables](#environment-variables)
- [Database setup (Supabase)](#database-setup-supabase)
- [Provider setup](#provider-setup) — or follow **[SETUP.md](./SETUP.md)** step by step
- [Architecture](#architecture)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known provider restrictions](#known-provider-restrictions)

---

## Technology

| Layer         | Choice                                                             |
| ------------- | ------------------------------------------------------------------ |
| Framework     | TanStack Start (React 19, file-based routing, SSR + server routes)  |
| Build         | Vite 8, Nitro                                                       |
| Styling       | Tailwind CSS v4 with an oklch design-token system                   |
| Components    | shadcn/ui (Radix primitives), Lucide icons                          |
| Data          | Repository abstraction — browser storage by default, Supabase ready |
| Auth          | Supabase — Google OAuth or a passcode, plus an explicit demo mode    |
| AI            | OpenAI **Responses API** (streaming, strict-schema tools)           |
| Package mgr   | **bun** (`bun.lock` is the lockfile of record)                      |
| Tests         | Vitest + Testing Library, Playwright                                |

The project was scaffolded by Lovable on TanStack Start and that architecture
was kept deliberately — it already provides SSR, file-based routing, and
first-class server routes, which is exactly what the server-only integrations
need.

---

## Quick start

```bash
bun install
bun run dev            # http://localhost:8080
```

Open the app, press **Explore demo mode**, and everything works — no
credentials, no database, no API keys.

Other commands:

```bash
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
bun run test           # vitest (unit + component)
bun run test:e2e       # playwright (builds and serves automatically)
bun run build          # production build
bun run verify         # typecheck + lint + test + build
bun run icons          # regenerate the PWA icon set
```

To run the production server locally:

```bash
bun run build:node     # nitro node-server preset
bun run start          # http://localhost:3000 (or $PORT)
```

---

## Signing in

Two doors into the same accounts, plus demo mode.

**Continue with Google** — the normal path, through Supabase OAuth.

**Passcode** — the path that works on a school Chromebook, where third-party
Google OAuth is blocked outright and the Google button simply cannot complete.
Pick an account, type one short passcode, done.

The passcode you type is never the Supabase password. Supabase rejects anything
under six characters, and a three-letter password would be weak regardless, so
the server:

1. compares the typed passcode against `APP_PASSCODE` in constant time,
2. derives that account's real 48-character password as
   `HMAC(ACCOUNT_PASSWORD_SECRET, email)`, and
3. exchanges it with Supabase for an ordinary session.

The browser only ever sees a passcode and a session — never the real password
and never the derivation secret. The endpoint is rate limited to 5 attempts a
minute and 40 a day per caller, which is what makes a short passcode acceptable.

Accounts reached this way are the *same rows* Google sign-in creates, so all
existing data and every RLS policy still apply, and Google sign-in keeps working.

```bash
# One-time: set the derived password on each account. Idempotent.
bun run passcode:provision
```

Needs `APP_PASSCODE`, `ACCOUNT_PASSWORD_SECRET` (32+ random chars) and
`SUPABASE_SERVICE_ROLE_KEY`. Rotating `ACCOUNT_PASSWORD_SECRET` invalidates every
derived password at once — that is the revocation mechanism; re-run the script
afterwards. Edit `PASSCODE_ACCOUNTS` in `src/server/passcode.ts` to change which
accounts are offered.

---

## Demo mode

Demo mode is an explicit choice on the sign-in page, never a fallback that
pretends to be real.

- Seeds a realistic workspace generated relative to today's date: courses,
  assignments, tasks, six projects, eight opportunities, a week of focus
  sessions and notifications.
- Everything demo-seeded is tagged `source: "demo"` and rendered with a **Demo**
  badge. The top bar shows **Demo data** on every page.
- All data lives in this browser's `localStorage`. Nothing is uploaded.
- Every feature is usable: create and complete tasks, filter and search, start
  and finish focus sessions, walk the opportunity pipeline, open confirmation
  flows, inspect integration setup screens.
- **Real** public integrations still work in demo mode: the Wilcox calendars and
  Santa Clara weather need no credentials, and pressing *Sync* really fetches
  them.
- Settings → Data → **Reset demo data** restores the seed; **Delete all data**
  wipes it.

---

## Integration status

This table is the honest state of every provider. The Integrations page in the
app renders the same information from `src/lib/integrations/registry.ts`.

| Provider              | Status                        | What actually works                                                                                   |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Day planner**       | ✅ Fully implemented           | A real time grid for today: classes and events in place, open gaps you can click to schedule work into, a live now-line, and "Plan my day" which previews before it writes. |
| **Wilcox calendars**  | ✅ Fully implemented           | School, district, athletics and counseling calendars — fetched live, normalized, deduplicated. No credentials needed. |
| **Santa Clara weather** | ✅ Fully implemented         | Current conditions and today's high/low from Open-Meteo. No credentials needed.                        |
| **Inbox (email → plan)** | ✅ Fully implemented (paste) · 🔑 Gmail pull needs Google | Paste any club or school email and Compass pulls out every dated commitment — one item per date, each with the sentence it came from. Confirm each one to save it. Pulling straight from Gmail needs the `gmail.readonly` scope; pasting needs nothing. |
| **Task / focus / CRM data** | ✅ Fully implemented     | Full CRUD, persisted, optimistic updates with rollback, offline-safe.                                  |
| **OpenAI (Orbit)**    | 🔑 Implemented — needs `OPENAI_API_KEY` | Streaming Responses API, 12 typed tools, Structured Outputs, rate limits. Without the key the UI shows a configuration state and generates nothing. |
| **GitHub**            | 🔑 Implemented — needs `GITHUB_TOKEN` | Open issues, PRs, latest commit, Actions runs and failures, links to logs. Read-only.            |
| **Vercel**            | 🔑 Implemented — needs `VERCEL_TOKEN` | Production/preview deployments, failed builds, URLs, branch and framework metadata. Read-only.  |
| **Spotify**           | 🔑 Implemented — needs client id/secret/refresh token | Now playing, recently played, playlists. Playback control implemented but **requires Premium**. |
| **Supabase auth + storage** | 🔑 Implemented — needs a project | Google sign-in and per-user Postgres storage with RLS. Migrations included. Not exercised against a live project in this repo — see the note below. |
| **Aeries (SIS)**      | 🚫 Restricted — district-issued certificate | Adapter and normalizers are complete and tested against fixture payloads. Enabling it needs an API certificate that only a district Aeries administrator can issue, and every district hosts its own endpoint. Not verified against a live instance. |
| **Google Calendar**   | 🔑 Implemented — needs an OAuth client | Full consent flow. Personal events merged into Today and the planner. Refresh token kept in a sealed httpOnly cookie. |
| **Google Classroom**  | 🔑 Implemented — needs an OAuth client | Courses, published coursework, due dates and your own submission state (turned in / graded / missing). |
| **Gmail**             | 📋 Planned — opt-in by design | Restricted scope; would only ever run a narrow user-defined query, never a mailbox scan.               |
| **Google Drive**      | 📋 Planned                     | Would use `drive.file` (only files you explicitly pick).                                              |
| **Discord**           | 🚫 Restricted by provider      | Discord gives third-party apps **no** access to your DMs or servers you merely belong to. Only an incoming webhook you create yourself is possible. Manual capture is offered instead. |
| **LinkedIn**          | 🚫 Restricted by provider      | LinkedIn's public API does not expose connections, messages or the feed. Opportunities are captured manually or by pasting a URL. Nothing is scraped. |

> **On Supabase:** the schema, RLS policies, auth flow and repository
> implementation are complete and typechecked, but this repository has never
> been pointed at a live Supabase project, so that path is documented as
> "needs credentials" rather than "verified". The browser-storage path is the
> one exercised by the test suite.

---

## Environment variables

Copy `.env.example` to `.env`. **Every variable is optional** — the app runs
fully without them.

| Variable                    | Scope  | Purpose                                                        |
| --------------------------- | ------ | -------------------------------------------------------------- |
| `OPENAI_API_KEY`            | server | Enables Orbit. Without it, Orbit shows a configuration state.   |
| `OPENAI_MODEL`              | server | Defaults to `gpt-5.6-luna`.                                    |
| `OPENAI_MAX_OUTPUT_TOKENS`  | server | Per-response ceiling. Default `1800`.                           |
| `OPENAI_DAILY_REQUEST_CAP`  | server | Spending guard: max Orbit calls per caller per UTC day (`300`). |
| `SAFETY_IDENTIFIER_SALT`    | server | Salt for the hashed `safety_identifier` sent to OpenAI.         |
| `VITE_SUPABASE_URL`         | client | Supabase project URL (public by design).                        |
| `VITE_SUPABASE_ANON_KEY`    | client | Supabase anon key (public by design; RLS is the protection).    |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Only if you extend the cron job to write to Postgres.           |
| `GITHUB_TOKEN`              | server | Read-only PAT for issues, PRs and Actions.                      |
| `GITHUB_OWNER`              | server | Optional default owner.                                         |
| `VERCEL_TOKEN`              | server | Read-scope account token.                                       |
| `VERCEL_TEAM_ID`            | server | Only when projects live under a team.                           |
| `SPOTIFY_CLIENT_ID`         | server | Spotify app client id.                                          |
| `SPOTIFY_CLIENT_SECRET`     | server | Spotify app secret.                                             |
| `SPOTIFY_REFRESH_TOKEN`     | server | Long-lived refresh token for your own account.                  |
| `GOOGLE_CLIENT_ID`          | server | Google OAuth client (Calendar / Classroom / Drive).             |
| `GOOGLE_CLIENT_SECRET`      | server | Google OAuth secret.                                            |
| `AERIES_BASE_URL`           | server | The district's own Aeries API host.                             |
| `AERIES_CERT`               | server | District-issued API certificate (`AERIES-CERT` header).         |
| `AERIES_STUDENT_ID`         | server | Your Aeries student id.                                         |
| `AERIES_SCHOOL_CODE`        | server | School code within the district. Defaults to `1`.               |
| `AERIES_PATH_*`             | server | Endpoint overrides for Aeries versions with different paths.    |
| `CRON_SECRET`               | server | Protects `/api/cron/sync`. Without it the endpoint returns 503. |
| `TOKEN_ENCRYPTION_KEY`      | server | AES-GCM key for provider refresh tokens. Required before any token is persisted. |
| `APP_PASSCODE`              | server | The short passcode typed on the sign-in page. Never a Supabase password. |
| `ACCOUNT_PASSWORD_SECRET`   | server | 32+ random chars. Derives each account's real Supabase password. Rotating it locks everyone out until `bun run passcode:provision` is re-run. |

Only the two `VITE_`-prefixed variables reach the browser. The production client
bundle contains **no** `process.env` reads and no secret values — verified by
grepping `.output/public` after each build.

---

## Database setup (Supabase)

Without Supabase, AaditOS stores everything in the browser and works completely.
Add Supabase when you want Google sign-in and data that follows you across
devices.

1. Create a project at <https://supabase.com/dashboard>.
2. Apply the migration:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push          # applies supabase/migrations/0001_init.sql
   ```

   Or paste `supabase/migrations/0001_init.sql` into the SQL editor.

3. Copy the project URL and anon key into `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
4. Enable Google in **Authentication → Providers**.
5. Add these **Redirect URLs** in **Authentication → URL Configuration**:

   ```
   http://localhost:8080/auth/callback
   https://<your-app>.vercel.app/auth/callback
   ```

What the migration installs:

- 17 tables with UUID primary keys, ownership columns, created/updated
  timestamps and soft deletion on `tasks`.
- `(user_id, source, source_ref)` unique constraints on `courses`, `tasks` and
  `assignments`, and `(user_id, dedupe_key)` on `notifications` — so repeated
  imports update instead of duplicating.
- Row Level Security **enabled and forced** on every table, with an
  `auth.uid() = user_id` policy (`auth.uid() = id` on `profiles`).
- `revoke all ... from anon`, so the anon role cannot read private rows even if
  a policy were dropped later.
- A trigger that creates a `profiles` row on sign-up.
- `ai_usage_events` records model, token counts and success only — never prompt
  or response content.

---

## Provider setup

> **[SETUP.md](./SETUP.md) is the step-by-step version** — every provider, free,
> with the exact clicks. The summaries below are the reference.

### Google (Calendar / Classroom / Gmail / Drive)

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com).
2. Enable the Google Calendar, Classroom and Drive APIs.
3. Create an **OAuth 2.0 Client ID** (Web application).
4. Authorized redirect URI: `https://<your-app>.vercel.app/auth/callback`
   (and `http://localhost:8080/auth/callback` for local work).
5. Request exactly the scopes in `GOOGLE_SCOPES` (`src/server/providers/google.ts`):
   - `.../auth/calendar.readonly`
   - `.../auth/calendar.events` — **the only write scope.** Used solely when you
     press Confirm on an extracted event. It can add and edit events; unlike the
     full `calendar` scope it cannot delete or share a calendar.
   - `.../auth/classroom.courses.readonly`
   - `.../auth/classroom.coursework.me.readonly`
   - `.../auth/classroom.student-submissions.me.readonly`
   - `.../auth/gmail.readonly` — read-only, and further narrowed by the search
     query in `src/server/providers/gmail.ts`. Nothing is sent or deleted.

**Adding a scope requires reconnecting.** An existing refresh token keeps working
for the scopes it was granted and returns 403 only on the new one. The
Integrations card detects this (`missingScopes` from `/api/google/status`), says
which capability is missing, and shows a **Reconnect** button.

**Expect a school-managed account to block this.** Santa Clara USD, like most
districts, can disallow third-party OAuth apps on student accounts. When that
happens Google refuses at the consent screen. AaditOS surfaces that as an error
on the Integrations card and every other part of the app keeps working.

**Expect a supervised (Family Link) account to need a parent.** A Google account
managed through Family Link cannot grant these scopes on its own: the consent
flow diverts to a "Choose a parent" screen and the linked parent must sign in and
approve. This is enforced by Google, not by AaditOS. Until a parent approves,
Gmail pull and Calendar write stay off — and the Inbox page still works by
pasting an email in, which needs no Google connection at all.

### GitHub

1. <https://github.com/settings/tokens> → **Fine-grained personal access token**.
2. Repository access: only the repos linked to your projects.
3. Permissions (all **Read-only**): Contents, Issues, Pull requests, Actions.
4. Set `GITHUB_TOKEN`.

AaditOS never reruns a workflow, merges a PR, or pushes.

### Vercel

1. <https://vercel.com/account/tokens> → create a token.
2. Set `VERCEL_TOKEN`, and `VERCEL_TEAM_ID` if the projects are under a team.

### Spotify

1. <https://developer.spotify.com/dashboard> → create an app.
2. Add a redirect URI (any URL you control, e.g. `http://localhost:8080/callback`).
3. Authorize once with these scopes to obtain a refresh token:
   `user-read-playback-state user-read-currently-playing user-read-recently-played playlist-read-private user-modify-playback-state`
4. Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`.

Playback control needs **Spotify Premium**. On a free account the API returns
403 and AaditOS disables the controls with that reason shown.

### OpenAI

1. <https://platform.openai.com/api-keys> → create a key.
2. Set `OPENAI_API_KEY`, optionally `OPENAI_MODEL`.
3. Optionally set a usage limit in the OpenAI dashboard; AaditOS additionally
   enforces `OPENAI_DAILY_REQUEST_CAP` and a 12-requests-per-minute window.

### Aeries

Aeries holds the official gradebook, and it is the hardest integration to
enable — not technically, but organisationally.

1. Ask the district's Aeries administrator for an **API certificate** scoped to
   your own student record. This is the blocker: districts issue certificates to
   staff and vetted systems, rarely to a student.
2. Set `AERIES_BASE_URL` to the district's Aeries host (each district runs its
   own; there is no shared Aeries API).
3. Set `AERIES_CERT`, `AERIES_STUDENT_ID` and `AERIES_SCHOOL_CODE`.
4. If a request returns 404, your Aeries version uses different endpoint paths.
   Override them with `AERIES_PATH_CLASSES`, `AERIES_PATH_GRADEBOOKS` and
   `AERIES_PATH_GRADES`.

What is implemented and tested: the normalizers that turn Aeries payloads into
courses, assignments and grades. They tolerate the casing differences between
Aeries versions, never treat a blank score as a zero, and produce stable ids so
re-syncing updates rather than duplicates. What is **not** verified: the network
calls, because no reachable Aeries instance exists to test against.

### Wilcox

Nothing to configure. Santa Clara USD publishes no ICS or RSS feed for these
calendars, so `src/server/providers/wilcox.ts` reads the school's public
Finalsite calendar elements through a single typed adapter with validation,
per-month caching, timeouts and unit tests. Only public information is read.

---

## Architecture

```
src/
  lib/core/          Domain types + pure logic (priority, normalize, nl-task, schedule, time)
  lib/repo/          Repository interface, LocalRepository, SupabaseRepository, demo seed
  lib/auth/          Supabase client, session context, config
  lib/orbit/         Snapshot builder, tool definitions + executors, streaming client
  lib/integrations/  Provider registry, wire contracts, sync hook
  lib/hooks/         useToday (the single derivation of "today"), useFocusTimer
  server/            Server-only: env, providers, sync, Orbit runtime, rate limiting, schemas
  routes/            Pages + API routes (api.*.ts are server-handler-only routes)
  components/os/     App shell, primitives, task row, quick add, Orbit blocks
supabase/migrations/ Versioned SQL with RLS
```

**Decisions worth knowing:**

- **The planner is the product.** Today's middle column is a time grid, not a
  list. `src/lib/core/planner.ts` builds the block layout (including
  side-by-side lanes for overlaps), computes the real gaps, and can fill them —
  `autoPlanDay` returns a *proposal* that the UI previews before writing.
  Scheduling only ever sets `startAt`; a due date is never moved.
- **One derivation of "today".** `useToday()` computes school status, timeline,
  conflicts, ranking, free windows and weekly progress. Today, Focus, Orbit and
  the palette all read from it, so they cannot disagree.
- **Next Move is computed, not hardcoded.** `scoreTask` combines an urgency
  curve, priority weight, how well the estimate fits the *next actual free
  window*, category, in-progress state and subtask progress — and returns the
  reasons it used, which the card renders.
- **Server-only means server-only.** Anything touching a token lives under
  `src/server/**`. Shared wire types live in `lib/integrations/contracts.ts`, so
  the client can type a response without importing the module that reads
  secrets. TanStack Start's import-protection plugin fails the build if that is
  ever violated.
- **Orbit proposes, never acts.** Read tools run automatically over a compact
  snapshot; `propose_task` and `update_task` return a proposal that renders as a
  confirmation card and does nothing until you press Save.
- **Timers use wall-clock timestamps,** not tick counting, and mirror to storage
  on every state change — so a refresh or a closed lid resumes correctly.
- **Failures are isolated.** `runSync` runs each provider independently; a dead
  Spotify token cannot stop the Wilcox calendar or GitHub.

---

## Testing

```bash
bun run test           # 227 unit + component tests
bun run test:e2e       # 24 Playwright tests across 3 viewports
```

Unit and component coverage:

| Area                                | File                        |
| ----------------------------------- | --------------------------- |
| Next Move prioritisation, free-time | `tests/priority.test.ts`     |
| Event normalization + deduplication | `tests/normalize.test.ts`    |
| Natural-language task parsing       | `tests/nl-task.test.ts`      |
| Wilcox adapter + parser             | `tests/wilcox.test.ts`       |
| Repository persistence + isolation  | `tests/repository.test.ts`   |
| Orbit tools (read + write)          | `tests/orbit-tools.test.ts`  |
| Day planner layout, gaps, auto-plan | `tests/planner.test.ts`      |
| Aeries normalizers                  | `tests/aeries.test.ts`       |
| Google Calendar + Classroom mapping | `tests/google.test.ts`       |
| GitHub adapter (real API fixtures)  | `tests/github.test.ts`       |
| API validation + rate limiting      | `tests/api-validation.test.ts` |
| Task flow + auth boundary           | `tests/task-flow.test.tsx`   |

The Playwright suite runs the primary journey at **1366×768 (Chromebook)**,
**1440×900** and **390×844**, and asserts the console stays clean.

Visual QA:

```bash
node scripts/screenshots.mjs http://127.0.0.1:4173 ./.screenshots
```

Renders all 12 pages at all three viewports in both themes, fails on horizontal
overflow or console errors, and writes 72 screenshots for inspection.

---

## Deployment

The production build is Vercel-ready. Nitro auto-detects Vercel, so no preset
configuration is needed there.

**One-time setup**

1. Import the repository at <https://vercel.com/new>.
2. Build command `bun run build`, install command `bun install`
   (already set in `vercel.json`).
3. Add the environment variables you want from the table above.
4. If using Supabase, add the callback URL from
   [Database setup](#database-setup-supabase).

**Deploy**

```bash
vercel --prod
```

`vercel.json` also configures:

- A daily cron at 13:00 UTC (06:00 PT) hitting `/api/cron/sync`, authenticated
  with `CRON_SECRET`.
- Security headers (`X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy`).
- `Cache-Control: no-store` on every `/api/*` response.

**What the cron actually does:** it refreshes the server-side provider caches
(Wilcox HTML, weather, GitHub, Vercel, Spotify) so the next client sync is fast
and rate limits stay low. It does **not** write to a workspace, because in the
default configuration the workspace lives in the browser. With Supabase
configured, extend `src/routes/api.cron.sync.ts` to persist through
`SupabaseRepository` using the service-role key.

**Other hosts:** `bun run build:node && bun run start` produces a plain Node
server (`.output/server/index.mjs`). Set `NITRO_PRESET` for anything else.

---

## PWA and offline

- Installable: `public/manifest.webmanifest` with maskable icons and shortcuts
  to Today, Tasks, Focus and Orbit.
- `public/sw.js` caches the app shell and build assets, serves navigations
  network-first with a 3.5s timeout, and falls back to `public/offline.html`.
- `/api/weather` is the **only** API response cached. Every other `/api/*`
  response is network-only, so no personal data and no Orbit conversation is
  ever written to the cache.
- Offline, the app shows a banner, keeps working against local data, and queues
  writes that could not reach a remote store, replaying them on reconnect.

## Motion

One small vocabulary, defined in `src/styles.css` and used everywhere:

- Content that has just arrived rises 6px and fades in, staggered by index.
- Completing a task pops the check and settles the row, then fades and strikes
  the text — the state change is legible without reading it.
- The now-line on the planner pulses slowly; skeletons use a slow sheen rather
  than a blink.
- Everything sits in the 150–260ms band on `cubic-bezier(0.16, 1, 0.3, 1)`.

Nothing is decorative. All of it is disabled wholesale by
`prefers-reduced-motion` and by **Settings → Appearance → Reduce motion**.

## Accessibility

Semantic landmarks and one `h1` per page; a skip link; visible focus rings on
everything; labelled controls; tables with captions and scoped headers; status
regions with `aria-live`; charts paired with expandable text summaries; status
communicated by text as well as colour; `prefers-reduced-motion` honoured plus
an in-app **Reduce motion** switch.

---

## Known provider restrictions

Recorded here so nothing in the UI ever overstates what it can do.

1. **Santa Clara USD publishes no calendar feed.** No ICS, no RSS. The Wilcox
   integration reads public Finalsite calendar pages through an isolated,
   tested, cached adapter. If the school's markup changes, the parser returns
   zero events and the sync is reported as *failed* rather than silently empty.
2. **No official bell schedule exists in machine-readable form.** Period times
   in `src/lib/core/schedule.ts` are local defaults, and both the School page
   and Settings say so.
3. **School-managed Google accounts commonly block third-party OAuth.** This is
   enforced by Google Workspace admin policy, not by AaditOS.
4. **`gmail.readonly` is a Google restricted scope.** Fine for personal use of
   your own account; publishing it to other users requires a CASA assessment.
5. **Spotify playback control requires Premium.** Free accounts get a 403 and
   the controls are disabled with that reason displayed.
6. **Discord provides no third-party access to personal DMs or member servers.**
   Self-bots violate Discord's terms. Only self-created webhooks are viable.
7. **LinkedIn's public API exposes no connections, messages or feed.** Manual
   capture only.
8. **Aeries has no central API and no student-issuable credential.** Each
   district hosts its own instance and an administrator issues the certificate.
   Endpoint paths also vary by Aeries version, which is why they are
   configurable.
9. **Grades computed inside AaditOS use only imported graded items** and are not
   an official gradebook. Connect Aeries for the official figure.
