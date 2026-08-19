# AaditOS

A private planner for Aadit Mehta — a ninth grader at Wilcox High School in
Santa Clara who also builds software.

Three screens, and that is the whole app.

| Screen      | What it is for                                                                    |
| ----------- | --------------------------------------------------------------------------------- |
| **Today**   | What is due, what to do next, what happens today, and one box to capture anything. |
| **Classes** | Each class: what is due in it, and the thoughts and ideas you had about it.        |
| **Ask**     | A question about any of the above, answered from your real data.                   |

Settings lives behind the avatar. There is nothing else.

---

## The two ideas that matter

**One box, no forms.** Type anything into the capture box — `fin lit packet all
5 pages friday`, or a whole club email pasted in — and the server works out
what each piece is and saves it. A todo list is hard to keep because it only
accepts todos; this accepts sentences.

**Notes belong to classes.** Not everything worth remembering is a task.
"Robson wants the thesis to be arguable, mine is just a summary" has no
deadline and never will, so a planner either loses it or invents a fake due
date for it. Here it is a **note** on the English page, and it can become a
task later if it turns out to be one. The assistant reads notes too, which is
what lets it answer *why* something is hard rather than only *when* it is due.

The capture box files three kinds of thing:

| Kind      | Example                                                     | Where it lands       |
| --------- | ----------------------------------------------------------- | -------------------- |
| **task**  | "algebra pset due tues"                                     | Today, and the class |
| **event** | "robotics build session thursday 3:30 in N102"              | Today's schedule     |
| **note**  | "I keep messing up the sign when I factor"                  | The class page       |

One sentence often contains more than one — a deadline *and* an observation —
and both are filed separately.

---

## Quick start

```bash
bun install
bun run dev            # http://localhost:8080
```

Press **Explore demo mode** and everything works — no credentials, no database,
no API keys. Demo data lives in `localStorage` and is never uploaded.

```bash
bun run verify         # typecheck + lint + test + build — run this before pushing
bun run test:e2e       # Playwright, builds and serves itself
```

---

## Signing in

**Passcode** — the path that works on a school Chromebook, where third-party
Google OAuth is blocked outright. The typed passcode is never the Supabase
password: the server compares it against `APP_PASSCODE` in constant time,
derives the account's real 48-character password as
`HMAC(ACCOUNT_PASSWORD_SECRET, email)`, and exchanges that with Supabase for an
ordinary session. Rate limited to 5 attempts a minute, which is what makes a
short passcode acceptable. Run `bun run passcode:provision` once to set it.

**Continue with Google** — the normal path, through Supabase OAuth.

**Demo mode** — an explicit choice on the sign-in page, never a silent
fallback.

---

## Staying in sync

The calendar is kept current in three overlapping ways, so no single one
failing leaves the app stale:

| Where                | How often                    | What it does                                        |
| -------------------- | ---------------------------- | --------------------------------------------------- |
| GitHub Actions       | every 15 min, 6am–11pm PT    | Hits `/api/cron/sync`, which **writes to Supabase**. |
| Vercel Cron          | once a day                   | The floor, if Actions is ever paused.                |
| The open tab         | every 5 min, and on focus    | Wilcox + weather, straight into the browser.         |

`/api/cron/sync` does not just warm a cache — it fetches the Wilcox calendars
once and persists the normalized result into every active account with the
service-role key. Open the app after three days away and the week is already
right.

Google is deliberately **not** in the scheduled job: its refresh token lives in
a sealed cookie belonging to one browser session, and an unattended retry
against lapsed consent would produce an error every fifteen minutes. Google
syncs from the browser, where a human can re-consent.

GitHub Actions needs two repository secrets — Settings → Secrets and variables
→ Actions:

```
APP_URL      https://aaditos.aaditmehta.dev
CRON_SECRET  the same value as in Vercel
```

---

## What is connected

| Provider                        | State                     | What it does                                                                       |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| **Wilcox calendars**            | On, no credentials        | School, district, athletics and counseling calendars, normalized and deduplicated.  |
| **Santa Clara weather**         | On, no credentials        | Today's conditions from Open-Meteo.                                                 |
| **Google Calendar + Classroom** | Needs an OAuth client     | Personal events, courses, coursework and your own submission state. **Read-only.**  |
| **OpenAI**                      | Needs `OPENAI_API_KEY`    | Capture and Ask. Without the key both say so plainly and generate nothing.          |

Every Google scope is read-only. The `calendar.events` write scope and the
Gmail scope were both removed with the features that used them — which also
means a school-managed account is reviewed against a much smaller ask.

---

## Environment

Copy `.env.example` to `.env`. **Every variable is optional** — the app runs
fully without them.

| Variable                    | Scope  | Purpose                                                          |
| --------------------------- | ------ | ---------------------------------------------------------------- |
| `OPENAI_API_KEY`            | server | Enables Capture and Ask.                                          |
| `OPENAI_MODEL`              | server | Defaults to `gpt-5.6-terra`. See the note in `src/server/env.ts`. |
| `OPENAI_MAX_OUTPUT_TOKENS`  | server | Per-response ceiling. Default `1800`.                             |
| `OPENAI_DAILY_REQUEST_CAP`  | server | Spending guard: max calls per caller per UTC day.                 |
| `SAFETY_IDENTIFIER_SALT`    | server | Salt for the hashed `safety_identifier` sent to OpenAI.           |
| `VITE_SUPABASE_URL`         | client | Supabase project URL (public by design).                          |
| `VITE_SUPABASE_ANON_KEY`    | client | Supabase anon key (public by design; RLS is the protection).      |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **Required for the scheduled sync to write.** Bypasses RLS.       |
| `GOOGLE_CLIENT_ID/SECRET`   | server | Google OAuth client.                                              |
| `CRON_SECRET`               | server | Protects `/api/cron/sync`. Without it the endpoint returns 503.   |
| `TOKEN_ENCRYPTION_KEY`      | server | AES-GCM key for the Google refresh token.                         |
| `APP_PASSCODE`              | server | The short passcode typed on the sign-in page.                     |
| `ACCOUNT_PASSWORD_SECRET`   | server | 32+ random chars. Derives each account's real Supabase password.  |

Only the two `VITE_`-prefixed variables reach the browser. The production
client bundle contains no `process.env` reads and no secret values — verified
by grepping `.vercel/output/static` after each build.

---

## Database

```bash
supabase db push        # applies supabase/migrations/*
```

Four tables carry the app: `tasks`, `courses`, `assignments`, `events`, plus
`notes` for thoughts and ideas. Row Level Security is **enabled and forced** on
every one, with an `auth.uid() = user_id` policy, and `anon` is revoked
outright so it cannot read private rows even if a policy were dropped later.

`notes.task_id` is `on delete set null`, not cascade: deleting the task a note
became must not delete the thought behind it.

---

## Architecture

```
src/
  routes/          file-based routes; api.* are server-only handlers
  components/os/   the app's own components (shell, capture, rows, primitives)
  components/ui/   shadcn/ui primitives
  lib/core/        domain types, time, ranking, schedule, normalization
  lib/repo/        Repository interface + local and Supabase implementations
  lib/compass/     assistant snapshot, typed tools, chat hook
  server/          provider adapters, env, the OpenAI runtime — never imported by the client
```

The UI only ever talks to the `Repository` interface, so browser storage and
Postgres are a configuration change rather than a rewrite. Mutations apply
optimistically, roll back on failure, and queue in an outbox when the device is
offline.

**Ranking.** "Next up" is computed from due date, priority, estimated time and
the uninterrupted window you actually have before your next commitment — and it
shows its reasons, so it can be argued with rather than obeyed.

**The assistant** calls typed, strict-schema read tools over a compact snapshot
before answering, and states the numbers it used. `propose_task` and
`update_task` save nothing; they render a card the user confirms. Capture is
the one path that writes directly, and it offers Undo instead — you already
decided when you typed it.

---

## Testing

```bash
bun run test           # 264 unit + component tests
bun run test:e2e       # 12 end-to-end, across Chromebook / desktop / mobile
```

The e2e suite runs entirely in demo mode with no credentials, and checks the
real journey: sign in → open a class → write a thought → turn it into a task →
complete it → reload and confirm it stuck. It also asserts every screen renders
one `h1` with no console errors, which is what catches a broken route.

---

## Deployment

Vercel, from `main`. `vercel.json` sets the build command, the daily cron and
the security headers. Set every server variable in the Vercel dashboard —
`.env` is local only and is git-ignored.
