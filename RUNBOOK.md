# AaditOS runbook

Everything needed to get from this repo to a working install on your Chromebook,
in order. Each step says what it unlocks and how to tell it worked.

Steps 1–5 are the whole app. Steps 6–8 are optional capabilities that each fail
gracefully if you skip them.

---

## 0. Before you start

You need: a Vercel account, the Supabase project (already created), and a
terminal. About 25 minutes end to end.

```bash
bun install
bun run verify        # typecheck + lint + tests + production build
```

If `verify` passes, the code is sound and everything below is configuration.

---

## 1. Push the repo

```bash
git init
git add -A
git commit -m "AaditOS"
git remote add origin https://github.com/aaditmehtacoder/aaditos.git
git branch -M main
git push -u origin main
```

`.env` is gitignored and must stay that way. Everything secret lives there.

**Check:** the GitHub repo shows your files and **no `.env`**.

---

## 2. Deploy to Vercel

The build targets Vercel (`NITRO_PRESET=vercel`). Import the GitHub repo at
[vercel.com/new](https://vercel.com/new) — build command and output are already
correct via `vercel.json`.

**Check:** the deployment succeeds and the URL loads a sign-in page.

At this point the app works: demo mode, the Wilcox calendars and the weather all
run with no credentials at all.

---

## 3. Environment variables

Paste these into **Vercel → Settings → Environment Variables**. Copy the values
from your local `.env` — they are already generated there.

| Variable | Why |
|---|---|
| `VITE_SUPABASE_URL` | Database + auth. Public. |
| `VITE_SUPABASE_ANON_KEY` | Public by design; RLS is what protects data. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Passcode provisioning and push. |
| `APP_PASSCODE` | The passcode you type. Currently `cwb`. |
| `ACCOUNT_PASSWORD_SECRET` | **Secret.** Derives each account's real password. |
| `TOKEN_ENCRYPTION_KEY` | **Secret.** Seals the Google and push cookies. |
| `OPENAI_API_KEY` | **Secret.** Compass, quick-add and email extraction. |
| `CRON_SECRET` | **Secret.** Protects the scheduled endpoints. |
| `VITE_VAPID_PUBLIC_KEY` | Push. Public by design. |
| `VAPID_PRIVATE_KEY` | **Secret.** Signs push requests. |
| `VAPID_SUBJECT` | Contact address for push services. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Calendar, Classroom, Gmail. |
| `GITHUB_TOKEN`, `VERCEL_TOKEN`, `SPOTIFY_*` | Optional provider extras. |

Redeploy after adding them — Vercel does not apply env changes to an existing
build.

**Check:** `https://<your-app>/api/config` returns `"supabase": true` and
`"openai": true`.

---

## 4. Database

Two things to run in **Supabase → SQL Editor**, in order:

1. `supabase/migrations/0001_init.sql` — tables and RLS *(already applied)*
2. `supabase/migrations/0003_push_subscriptions.sql` — push *(already applied)*

**Check:** Table Editor lists `tasks`, `events`, `courses` and
`push_subscriptions`.

---

## 5. Passcode sign-in — the Chromebook door

Your school Chromebook blocks third-party Google OAuth, so "Continue with
Google" cannot complete there. This is the way in.

```bash
bun run passcode:provision
```

Prints `✓` per account. Already run for all three, so only re-run if you change
`ACCOUNT_PASSWORD_SECRET`.

**Check:** open the deployed URL, pick an account, type `cwb`, and you land on
Today as that account — not demo mode. The sidebar shows the real email.

> Changing the passcode: set `APP_PASSCODE` in Vercel **and** `.env`, then re-run
> the provision script. Changing `ACCOUNT_PASSWORD_SECRET` locks every account
> out until you re-run it.

---

## 6. Install on the Chromebook

Notifications and offline both need the app installed, not just bookmarked.

1. Open the deployed URL in Chrome on the Chromebook.
2. Sign in with the passcode.
3. Address bar → **install icon** (or ⋮ → Cast, save and share → **Install page
   as app**).
4. It now has its own icon in the launcher and its own window.

**Check:** the app opens without browser tabs or an address bar.

---

## 7. Notifications

Two layers. The first works immediately; the second needs one toggle per device.

### While the app is open

1. In the app → **Notifications**.
2. **Enable notifications** → Chrome asks → **Allow**.
3. A test notification appears immediately. If it does not, the button says so
   rather than failing silently.

You now get alerts for work due in the next hour, work that just went overdue,
and failed syncs. Each fires **once** — a task moving from due-soon to overdue is
two separate alerts, and nothing repeats on reload.

Mute whole categories with the switches on the same page. **Reset alert history**
re-announces anything still pending, which is the way to re-test.

### While the app is closed

On the same page, turn on **Alerts while AaditOS is closed**.

This subscribes the device to web push. Do it **once per device** — your
Chromebook and your laptop each need their own toggle, because a push
subscription belongs to one browser on one machine.

The push itself carries **no content**: the app fetches what to say when it
arrives, so Google's push servers never see your task titles.

**Two schedulers drive it, for a reason.** Vercel's Hobby plan allows exactly one
cron run per day, and a once-daily push cannot tell you something is due in an
hour. So:

- **Vercel cron**, 7am Pacific daily — the floor. Always runs.
- **GitHub Actions**, hourly 6am–10pm Pacific — the real cadence. Free, no plan
  change needed.

To turn on the hourly one, add two repository secrets at **GitHub → Settings →
Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `APP_URL` | `https://<your-app>.vercel.app` (no trailing slash) |
| `CRON_SECRET` | the same value as in Vercel |

Then **Actions → Push notifications → Run workflow** to test it immediately.

> Two GitHub caveats worth knowing: scheduled runs can be delayed by 5–30 minutes
> at peak, and GitHub pauses schedules on repos with no activity for 60 days. If
> that happens, notifications quietly degrade to the daily Vercel cron rather
> than stopping — push any commit to re-enable.
>
> Upgrading Vercel to Pro would let the Vercel cron run hourly on its own and
> make the Actions workflow unnecessary. That costs money and is entirely your
> call; nothing here needs it.

**Check:** toggle it on, close the app entirely, and wait for the next hour mark
with something due. Or force it now:

```bash
curl "https://<your-app>/api/cron/push?secret=<CRON_SECRET>"
# → {"ok":true,"total":1,"sent":1,"failed":0,"pruned":0}
```

`sent: 1` means it reached the push service. `total: 0` means no device is
subscribed yet.

> **ChromeOS gotcha:** notifications are suppressed in Do Not Disturb and while
> casting. Check the system tray if a push reports `sent` but nothing appears.

---

## 8. Google — Calendar write and Gmail

Optional. Everything else works without it, including the Inbox page, which
accepts a pasted email and needs no Google connection at all.

1. In the app → **Integrations** → Google Calendar card → **Connect** (or
   **Reconnect** if it says the consent is missing scopes).
2. Approve the consent screen.

This grants read access to Calendar, Classroom and Gmail, plus permission to
**add** calendar events — the only write in the app, and only when you press
Confirm.

**Check:** the card reads "Connected as …" with no "Reconnect needed" badge.

> **`aaditmehta1` is a supervised Family Link account.** Google diverts its
> consent to a "Choose a parent" screen and `mark.menon1212@gmail.com` has to
> sign in and approve. Nothing in the app can bypass that.
>
> **School accounts** often block third-party OAuth entirely. If yours does,
> consent fails and the app reports it plainly — paste emails into Inbox instead.

---

## Using it

**Add anything** — press **⌘J** / the **Quick add** button, write it how you would
say it (`robotics club p120 at 4pm`), and **Refine with Compass** turns it into a
dated task. Confirm before it saves.

**Turn an email into a plan** — **Inbox** → paste the whole email → **Read it**.
It pulls out every dated commitment as its own item, quotes the sentence each one
came from, and skips anything cancelled. Confirm the ones you want. With Google
connected, confirming an event also adds it to your real Google Calendar.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Could not load your workspace" | A seed or query failed | Reload. If it persists, check the browser console. |
| Passcode says "no passcode password yet" | Provisioning never ran, or the secret changed | `bun run passcode:provision` |
| Notifications never appear | Permission denied, or ChromeOS Do Not Disturb | Chrome → site settings → Notifications → Allow |
| Push says `sent` but nothing shows | DND, or the app was uninstalled | Check the tray; re-toggle the switch |
| Gmail card says "refused the request" | Consent predates the Gmail scope | Integrations → **Reconnect** |
| Calendar event saved "to AaditOS only" | Same — missing `calendar.events` | Integrations → **Reconnect** |
| Compass returns "not configured" | `OPENAI_API_KEY` missing on the server | Add it in Vercel, redeploy |

---

## What runs on a schedule

| Endpoint | When | Does |
|---|---|---|
| `/api/cron/sync` | 6am Pacific daily (Vercel) | Refreshes provider caches |
| `/api/cron/push` | 7am Pacific daily (Vercel) | Floor — always runs |
| `/api/cron/push` | Hourly 6am–10pm Pacific (GitHub Actions) | Real cadence |

Both require `CRON_SECRET` and return 401 without it.
