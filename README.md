# AaditOS

A private planner for Aadit Mehta — a ninth grader at Wilcox High School in
Santa Clara who also builds software.

Three screens, and that is the whole app.

| Screen      | What it is for                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Today**   | What is due, what to do next, what happens today, and one box to capture anything.                                               |
| **Classes** | Each class: what is due in it, and the thoughts and ideas you had about it.                                                      |
| **Ask**     | A full assistant: your day from your real data, homework help, any number of photos and PDFs, pictures it draws, chats it keeps. |

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
what lets it answer _why_ something is hard rather than only _when_ it is due.

The capture box files three kinds of thing:

| Kind      | Example                                        | Where it lands       |
| --------- | ---------------------------------------------- | -------------------- |
| **task**  | "algebra pset due tues"                        | Today, and the class |
| **event** | "robotics build session thursday 3:30 in N102" | Today's schedule     |
| **note**  | "I keep messing up the sign when I factor"     | The class page       |

One sentence often contains more than one — a deadline _and_ an observation —
and both are filed separately.

---

## Quick start

```bash
bun install
bun run dev            # http://localhost:8080
```

Sign in with the password (below). There is no demo or sample mode: the app
shows nothing until a real session exists. Without a Supabase project
configured, a signed-in workspace stays in this browser's `localStorage`.

```bash
bun run verify         # typecheck + lint + test + build — run this before pushing
bun run test:e2e       # Playwright, builds and serves itself
```

---

## Signing in

**One password.** The sign-in page is a single field. It works on a school
Chromebook, where third-party Google OAuth is blocked outright. The typed
password is never the Supabase password: the server compares it against
`APP_PASSWORD` (alias `APP_PASSCODE`) in constant time, derives the account's
real 48-character password as `HMAC(ACCOUNT_PASSWORD_SECRET, email)`, and
exchanges that with Supabase for an ordinary session. Rate limited to 5
attempts a minute, which is what makes a short password acceptable. Run
`bun run passcode:provision` once to set it.

**Continue with Google** appears only when the password is not configured on
the server. There is no demo mode and no anonymous way in.

---

## Staying in sync

The calendar is kept current in three overlapping ways, so no single one
failing leaves the app stale:

| Where          | How often                 | What it does                                         |
| -------------- | ------------------------- | ---------------------------------------------------- |
| GitHub Actions | every 15 min, 6am–11pm PT | Hits `/api/cron/sync`, which **writes to Supabase**. |
| Vercel Cron    | once a day                | The floor, if Actions is ever paused.                |
| The open tab   | every 5 min, and on focus | Wilcox + weather, straight into the browser.         |

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

The Integrations page (avatar → Integrations, or `/integrations`) shows every
app with its mark, its state, and the one action that changes it. Everything
is read-only: the app never writes to another service.

| Provider                | Needs                             | What it does                                                                                              |
| ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Wilcox calendars**    | nothing                           | School, district, athletics and counseling calendars, scraped, normalized, deduped.                       |
| **Santa Clara weather** | nothing                           | Today's conditions from Open-Meteo.                                                                       |
| **Google Classroom**    | OAuth client + Connect            | Courses, coursework and your own submission state.                                                        |
| **Google Calendar**     | same connection                   | Personal events, next 45 days.                                                                            |
| **Gmail**               | same client + a separate Connect  | Recent mail (7 days, no promotions) into the Inbox. `gmail.readonly`, asked for only when you connect it. |
| **Aeries**              | API certificate from the district | The official gradebook: classes, teachers, periods, scores.                                               |
| **GitHub**              | `GITHUB_TOKEN`                    | Issues assigned to you, PRs waiting on you, your open PRs → Inbox.                                        |
| **Slack**               | `SLACK_USER_TOKEN`                | Messages that mention you, and DMs, last 7 days → Inbox.                                                  |
| **Notion**              | `NOTION_TOKEN`                    | Pages edited this week; open rows of `NOTION_TASKS_DATABASE_ID` → Inbox.                                  |
| **Assistant**           | `OPENAI_API_KEY`                  | Capture and Ask. Without a key both say so plainly and generate nothing.                                  |

**The Inbox.** Gmail, GitHub, Slack and Notion do not write tasks. They feed
an Inbox panel on Today, each item with its source's mark. **File** sends the
text through capture — which decides whether it is a task, an event or a note
— and **Dismiss** makes it go away. The assistant can read the Inbox too
(`list_inbox`), so "did anyone email me about the field trip" has an answer.

Token-based providers (GitHub, Slack, Notion, Aeries) sync automatically with
Wilcox and the weather. Google and Gmail sync only when you press Sync,
because their consent can lapse and an unattended retry would error every
five minutes.

---

## Images

Drop a photo onto the capture box, paste a screenshot, or use the paperclip —
a picture of the assignment sheet, the whiteboard, the rubric. The browser
downscales it (longest edge 1600px, JPEG for photos, PNG for screenshots),
the model reads it alongside whatever you typed, and the image is attached to
every task and note it files. Thumbnails show on the row; tap one for the full
picture.

Bytes never live in a database row. A real account stores them in a private
Supabase Storage bucket under the owner's id (signed URLs, one hour); a
workspace without Supabase keeps them in IndexedDB. Both need nothing from you, except
that a Supabase project must have `supabase/migrations/0005_attachments.sql`
applied — it adds the `attachments` column and the bucket with owner-only
policies.

---

## The assistant never runs out

Two things make that true.

**No cap for you.** The AI endpoints verify the Supabase session the browser
sends. A verified owner has no daily request cap (`OPENAI_DAILY_REQUEST_CAP`
defaults to `0`, meaning none); only a caller with no session — a stranger who
finds the endpoint — gets the small `OPENAI_GUEST_DAILY_CAP`.

**A ladder, not a key.** Every call walks `key × model` rungs in order —
`OPENAI_MODEL`, then `OPENAI_FALLBACK_MODELS`, then the same list on
`OPENAI_API_KEY_FALLBACK` — and steps down on anything that is the
provider's fault: a 429 rate limit, an exhausted quota, a 5xx, a model that
key cannot use. One short retry on the same rung first, so a hiccup does not
change the model mid-conversation. Three calls at most run at once, so a burst
cannot trip a per-minute limit by itself. Set the spare key and the assistant
keeps answering when the first account is out of credit.

---

## Behind the resume

The app has no address of its own. It is mounted at
`aaditmehta.dev/<a long number>/`, and the way to that number is on the
portfolio: scroll to the bottom of aaditmehta.dev, open **Resume**, scroll to
the bottom of the resume, press the small **resume** button, and type the
number. Then the password.

Three things make that hold:

- **A base path.** `APP_BASE_PATH=/<number>` at build time becomes Vite's
  `base`, TanStack Start's router basepath and Nitro's `baseURL`, so every
  route, asset, fetch, icon and the service worker live under the prefix.
  `src/lib/base-path.ts` is the one place hand-written URLs get it from.
- **A gate.** The portfolio's proxy sends `x-aaditos-gate`. With
  `AADITOS_GATE_SECRET` set, a request without it gets a 404 from
  `src/server/gate.ts` before the app sees it, so the deployment's own URL
  shows nothing. The host's cron call to `/api/cron/sync` is the one
  exception, and that route checks `CRON_SECRET` itself.
- **A grant.** Typing the number earns the browser a signed, expiring
  HttpOnly cookie from the portfolio, and the proxy refuses the hidden path
  without it. The URL on its own opens nothing — not in incognito, not on
  another computer. Each device walks the resume once.
- **The password.** Unchanged, see "Signing in". The number is a door, not a lock.

The number lives only in environment variables — here and on Vercel, for both
projects — never in a repository and never in a browser bundle.

## Environment

Copy `.env.example` to `.env`. **Every variable is optional** — the app runs
fully without them.

| Variable                    | Scope  | Purpose                                                                                                                                       |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`            | server | Enables Capture and Ask.                                                                                                                      |
| `OPENAI_API_KEY_FALLBACK`   | server | A spare key on another account. What "never runs out" rests on.                                                                               |
| `OPENAI_MODEL`              | server | Defaults to `gpt-5.6-terra`. See the note in `src/server/env.ts`.                                                                             |
| `OPENAI_FALLBACK_MODELS`    | server | Comma list tried after `OPENAI_MODEL`. Default: luna, sol, terra, 5.5, 5.4, 5.4-mini, 5.4-nano, 5.2 — each has its own daily budget.          |
| `OPENAI_IMAGE_MODEL`        | server | The painter behind "draw me…". Default `gpt-image-2`; falls back to `OPENAI_IMAGE_FALLBACK_MODELS`. Needs image credit on the OpenAI account. |
| `OPENAI_MAX_OUTPUT_TOKENS`  | server | Per-response ceiling. Default `4000`, hard cap `16000`.                                                                                       |
| `OPENAI_DAILY_REQUEST_CAP`  | server | Owner's daily stop. Default `0` = none.                                                                                                       |
| `OPENAI_GUEST_DAILY_CAP`    | server | Daily calls for a caller with no session. Default `40`.                                                                                       |
| `GITHUB_TOKEN`              | server | Fine-grained token, read-only on issues and pull requests.                                                                                    |
| `SLACK_USER_TOKEN`          | server | `xoxp-…` user token with `search:read` and `users:read`.                                                                                      |
| `NOTION_TOKEN`              | server | Internal integration secret; share pages with it in Notion.                                                                                   |
| `NOTION_TASKS_DATABASE_ID`  | server | Optional: a tasks database whose open rows feed the Inbox.                                                                                    |
| `AERIES_BASE_URL/CERT/…`    | server | District Aeries API certificate, school code and student id.                                                                                  |
| `SAFETY_IDENTIFIER_SALT`    | server | Salt for the hashed `safety_identifier` sent to OpenAI.                                                                                       |
| `VITE_SUPABASE_URL`         | client | Supabase project URL (public by design).                                                                                                      |
| `VITE_SUPABASE_ANON_KEY`    | client | Supabase anon key (public by design; RLS is the protection).                                                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **Required for the scheduled sync to write.** Bypasses RLS.                                                                                   |
| `GOOGLE_CLIENT_ID/SECRET`   | server | Google OAuth client.                                                                                                                          |
| `CRON_SECRET`               | server | Protects `/api/cron/sync`. Without it the endpoint returns 503.                                                                               |
| `APP_BASE_PATH`             | build  | The prefix the app is mounted under, e.g. `/123…`. Default `/`. See "Behind the resume".                                                      |
| `AADITOS_GATE_SECRET`       | server | Required in `x-aaditos-gate` on every request when set; otherwise 404. Shared with the portfolio's proxy.                                     |
| `APP_PUBLIC_ORIGIN`         | server | The origin people reach the app at (`https://aaditmehta.dev`) when it differs from the host. Used for OAuth redirect URIs.                    |
| `TOKEN_ENCRYPTION_KEY`      | server | AES-GCM key for the Google refresh token.                                                                                                     |
| `APP_PASSWORD`              | server | The one password typed on the sign-in page (`APP_PASSCODE` also works).                                                                       |
| `ACCOUNT_PASSWORD_SECRET`   | server | 32+ random chars. Derives each account's real Supabase password.                                                                              |

Only the two `VITE_`-prefixed variables reach the browser. The production
client bundle contains no `process.env` reads and no secret values — verified
by grepping `.vercel/output/static` after each build.

---

## Database

```bash
supabase db push        # applies supabase/migrations/*
```

Four tables carry the app: `tasks`, `courses`, `assignments`, `events`, plus
`notes` for thoughts and ideas, and a private `attachments` storage bucket for
images (`0005_attachments.sql`), and chats plus PDFs (`0006_chat.sql`). Row Level Security is **enabled and forced** on
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
  server/          provider adapters, env, auth, the AI ladder and runtime — never imported by the client
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
bun run test           # 291 unit + component tests
bun run test:e2e       # 12 end-to-end, across Chromebook / desktop / mobile
```

The e2e suite signs in with the real password, so it needs `E2E_PASSCODE`
(and a server with Supabase and `APP_PASSCODE` configured — point
`E2E_BASE_URL` at `bun run dev`). Without it, only the "the app is not public"
check runs and the rest is skipped. The journey it checks: sign in → open a
class → write a thought → turn it into a task → complete it → reload and
confirm it stuck. It also asserts every screen renders one `h1` with no
console errors, which is what catches a broken route.

---

## Deployment

Vercel, from `main`. `vercel.json` sets the build command, the daily cron and
the security headers. Set every server variable in the Vercel dashboard —
`.env` is local only and is git-ignored.
