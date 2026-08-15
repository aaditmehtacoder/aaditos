# Turning the integrations on — free, step by step

Every integration in AaditOS can be enabled **at no cost**. Nothing below needs
a paid plan, a company, or a credit card, with two exceptions that are called
out explicitly (OpenAI, and Spotify playback control).

Work top to bottom. Each section says what it unlocks, roughly how long it
takes, and exactly where the value goes.

**Where things go:** put values in a file called `.env` in the project root for
local work, and in **Vercel → Settings → Environment Variables** for the
deployed app. Copy `.env.example` to `.env` to start:

```bash
cp .env.example .env
```

Restart the dev server after editing `.env` — it is read at boot.

---

## Contents

| # | Integration | Cost | Time | Needs an account? |
|---|-------------|------|------|-------------------|
| 0 | [Wilcox calendars + weather](#0-wilcox-calendars-and-weather) | Free | 0 min | No |
| 1 | [GitHub](#1-github) | Free | 3 min | You have one |
| 2 | [Vercel](#2-vercel) | Free | 2 min | Free tier |
| 3 | [Google Calendar + Classroom](#3-google-calendar-and-classroom) | Free | 15 min | Free |
| 4 | [Supabase (sign-in + sync across devices)](#4-supabase) | Free tier | 10 min | Free |
| 5 | [Spotify](#5-spotify) | Free* | 10 min | Free |
| 6 | [OpenAI / Orbit](#6-openai-orbit) | **Paid** | 3 min | Paid |
| 7 | [Aeries](#7-aeries) | Free | — | Blocked by district |
| 8 | [Encryption + cron secrets](#8-secrets-you-generate-yourself) | Free | 1 min | No |

\* Spotify's API is free; *playback control* requires Premium. Everything else
about Spotify works on a free account.

---

## 0. Wilcox calendars and weather

**Already working. Nothing to do.**

Open **Integrations → Sync now**. AaditOS pulls the real Wilcox school,
district, athletics and counseling calendars, and Santa Clara weather. No
account, no key, no configuration — these read public data.

If you want to confirm it: after syncing, **School → Calendar** fills with the
actual school year.

---

## 1. GitHub

**Unlocks:** open issues, pull requests, the latest commit, and GitHub Actions
runs — including which workflow failed and a link to its logs — on each project.

**Cost:** free. **Time:** ~3 minutes.

1. Go to <https://github.com/settings/tokens?type=beta> (Settings → Developer
   settings → Personal access tokens → **Fine-grained tokens**).
2. Click **Generate new token**.
3. Fill in:
   - **Token name:** `AaditOS`
   - **Expiration:** 90 days (you will regenerate it; that is fine and safer)
   - **Repository access:** *Only select repositories* → pick the repos you list
     on your projects (e.g. `origami-prep`, `pick44`, `openrubric`)
4. Under **Permissions → Repository permissions**, set all four to
   **Read-only**:
   - Contents
   - Issues
   - Pull requests
   - Actions
5. Click **Generate token** and copy it. It starts with `github_pat_`.
6. Put it in `.env`:

   ```
   GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
   ```

7. Restart the dev server, then **Integrations → GitHub → Sync**.

> **Read-only on purpose.** AaditOS never reruns a workflow, merges a pull
> request, or pushes. If you grant write permissions it still will not use them.

**Check it worked:** open a project that has a `githubRepo` set (Origami Prep in
the demo data) → **GitHub** tab → you should see real issue and PR counts, the
latest commit, and workflow runs.

---

## 2. Vercel

**Unlocks:** production and preview deployment status, failed builds, deployment
URLs, branch and framework metadata.

**Cost:** free (Hobby plan). **Time:** ~2 minutes.

1. Go to <https://vercel.com/account/tokens>.
2. Click **Create Token**.
   - **Name:** `AaditOS`
   - **Scope:** your personal account (or the team that owns the projects)
   - **Expiration:** whatever you are comfortable with
3. Copy the token and add it:

   ```
   VERCEL_TOKEN=xxxxxxxxxxxx
   ```

4. **Only if the projects live under a team**, also set the team id. Find it at
   Vercel → your team → **Settings → General → Team ID**:

   ```
   VERCEL_TEAM_ID=team_xxxxxxxxxxxx
   ```

5. Restart, then **Integrations → Vercel → Sync**.

> Vercel tokens are account-wide — there is no read-only scope. AaditOS only
> ever issues `GET` requests to `/v6/deployments` and `/v9/projects`.

---

## 3. Google Calendar and Classroom

**Unlocks:** your personal calendar events merged into Today and the planner,
plus Classroom courses, published coursework, due dates, and your own submission
state (turned in / graded / missing).

**Cost:** free. **Time:** ~15 minutes the first time.

This is the longest one because Google requires you to create a project. Follow
it exactly; the redirect URI is the step people get wrong.

### 3a. Create the project

1. Go to <https://console.cloud.google.com/projectcreate>.
2. **Project name:** `AaditOS`. Click **Create**. Wait for it to finish.
3. Make sure `AaditOS` is the selected project in the top bar.

### 3b. Enable the two APIs

1. Go to <https://console.cloud.google.com/apis/library>.
2. Search **Google Calendar API** → click it → **Enable**.
3. Search **Google Classroom API** → click it → **Enable**.

### 3c. Configure the consent screen

1. Go to <https://console.cloud.google.com/auth/overview>.
2. Click **Get started**.
3. **App name:** `AaditOS`. **User support email:** your email.
4. **Audience:** choose **External**.
5. **Contact information:** your email. Agree and **Create**.
6. Go to **Audience** in the left menu → under **Test users**, click
   **Add users** → add your own Google address (the one whose calendar and
   Classroom you want). Save.

> Leave the app in **Testing**. You do not need to publish or get verified — a
> testing app works indefinitely for the test users you list. This is the free,
> correct path for a personal tool.

### 3d. Create the OAuth client

1. Go to <https://console.cloud.google.com/auth/clients> → **Create client**.
2. **Application type:** Web application.
3. **Name:** `AaditOS web`.
4. Under **Authorized redirect URIs**, click **Add URI** and add **both**:

   ```
   http://localhost:8080/api/google/callback
   https://YOUR-APP.vercel.app/api/google/callback
   ```

   Replace `YOUR-APP` with your actual Vercel subdomain. These must match
   character for character — no trailing slash.
5. **Create**. Copy the **Client ID** and **Client secret**.

### 3e. Add the values

```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
TOKEN_ENCRYPTION_KEY=<a long random string — see section 8>
```

`TOKEN_ENCRYPTION_KEY` is **required** here. AaditOS stores your Google refresh
token in a sealed, httpOnly cookie encrypted with it, and refuses to start the
connect flow without it rather than storing a token unencrypted.

### 3f. Connect

1. Restart the dev server.
2. Go to **Integrations → Google Calendar → Connect**.
3. Google will warn *"Google hasn't verified this app"* — that is expected for a
   testing app. Click **Advanced → Go to AaditOS (unsafe)**. It is your own app.
4. Approve the read-only permissions.
5. You land back on Integrations showing **Connected as you@gmail.com**.
6. Click **Sync**.

**Check it worked:** Today → the planner should now show your real calendar
events. School → Assignments should list Classroom coursework.

### If your school account is blocked

Santa Clara USD, like most districts, can disallow third-party OAuth apps on
student accounts. If consent fails with *"access blocked"* or *"admin policy"*:

- That block is enforced by Google Workspace, not by AaditOS.
- **Use your personal Gmail account instead** — Calendar will work fully.
  Classroom will only show courses that personal account is enrolled in.
- Everything else in AaditOS keeps working; the failure is isolated.

---

## 4. Supabase

**Unlocks:** real Google sign-in, and your data following you across devices
instead of living in one browser.

**Cost:** free tier. **Time:** ~10 minutes.

**You do not need this.** Without Supabase, AaditOS stores everything in the
browser and works completely. Add it when you want your tasks on both your
Chromebook and your phone.

1. Go to <https://supabase.com/dashboard> → **New project**.
   - **Name:** `aaditos`
   - **Database password:** generate one and save it in a password manager
   - **Region:** West US (North California) is closest to Santa Clara
2. Wait for provisioning (~2 minutes).
3. **Apply the schema.** Open **SQL Editor → New query**, paste the entire
   contents of `supabase/migrations/0001_init.sql`, and **Run**. This creates
   all 17 tables with Row Level Security enabled.
4. Go to **Project Settings → API** and copy:

   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

   Both of these are public by design. Row Level Security is what protects the
   data, and the migration installs it.
5. **Enable Google sign-in.** Go to **Authentication → Sign In / Providers →
   Google**, toggle it on, and paste the **same** Client ID and Client secret
   from section 3d. Save.
6. **Add the callback URLs.** Go to **Authentication → URL Configuration →
   Redirect URLs** and add:

   ```
   http://localhost:8080/auth/callback
   https://YOUR-APP.vercel.app/auth/callback
   ```

7. Back in Google Cloud (section 3d), also add Supabase's own callback to your
   OAuth client's authorized redirect URIs:

   ```
   https://xxxxxxxx.supabase.co/auth/v1/callback
   ```

8. Restart. The sign-in page's **Continue with Google** button is now enabled.

> **Honest note:** the schema, policies and repository code are complete and
> typechecked, but this path has never been run against a live Supabase project
> from this repo. The browser-storage path is the one covered by the test suite.
> If you hit something, tell me and I will fix it.

---

## 5. Spotify

**Unlocks:** now playing and recently played on the Focus page, your playlists,
and picking a focus playlist. Playback controls too, **if** you have Premium.

**Cost:** the API is free. Playback control needs Premium — Spotify enforces
that, not AaditOS. **Time:** ~10 minutes.

### 5a. Create the app

1. Go to <https://developer.spotify.com/dashboard> and log in with your normal
   Spotify account.
2. **Create app**.
   - **App name:** `AaditOS`
   - **Redirect URI:** `http://127.0.0.1:8080/spotify-callback`
     (Spotify rejects `localhost` now — use `127.0.0.1`)
   - Check **Web API**
3. Save. Open **Settings** and copy the **Client ID** and **Client secret**.

### 5b. Get a refresh token

This is a one-time exchange. You need it because Spotify's user data requires
*your* authorization, not just the app's.

1. Put your Client ID into this URL and open it in a browser:

   ```
   https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://127.0.0.1:8080/spotify-callback&scope=user-read-playback-state%20user-read-currently-playing%20user-read-recently-played%20playlist-read-private%20user-modify-playback-state
   ```

2. Approve. The browser will fail to load the page — that is fine. Copy the
   `code=` value out of the address bar.
3. Exchange it for a refresh token (replace all three placeholders):

   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code" \
     -d "code=THE_CODE_FROM_THE_URL" \
     -d "redirect_uri=http://127.0.0.1:8080/spotify-callback" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET"
   ```

4. The response contains `"refresh_token"`. That value does not expire.

### 5c. Add the values

```
SPOTIFY_CLIENT_ID=xxxxxxxx
SPOTIFY_CLIENT_SECRET=xxxxxxxx
SPOTIFY_REFRESH_TOKEN=AQxxxxxxxx
```

Restart, then **Focus → Focus soundtrack → Sync**.

> On a free account the playback buttons are **disabled with the reason shown**
> rather than failing silently. Now playing, recent tracks and playlists all
> still work.

---

## 6. OpenAI (Orbit)

**Unlocks:** Orbit — planning your afternoon, summarizing what you missed,
breaking down assignments, finding conflicts.

**Cost:** **this one is not free.** OpenAI requires a prepaid balance; there is
no free tier for the API. **Time:** ~3 minutes.

**Everything else in AaditOS works without it.** Orbit shows an honest "not
configured" state and generates nothing.

1. Go to <https://platform.openai.com/settings/organization/billing> and add
   credit. The minimum is usually $5, which lasts a long time at this usage.
2. Go to <https://platform.openai.com/api-keys> → **Create new secret key**.
   - **Name:** `AaditOS`
   - **Permissions:** Restricted → **Model capabilities: Write** is enough
3. Copy the key (starts with `sk-`) and add it:

   ```
   OPENAI_API_KEY=sk-xxxxxxxx
   ```

4. **Set a spending cap** at
   <https://platform.openai.com/settings/organization/limits> — set a monthly
   budget you are comfortable with. Do this before you use it.

AaditOS adds its own guards on top: 12 requests per minute and
`OPENAI_DAILY_REQUEST_CAP` (default 300) per day.

Optional:

```
OPENAI_MODEL=gpt-5.6-luna           # the default; cheapest 5.6 tier
OPENAI_MAX_OUTPUT_TOKENS=1800       # per response
OPENAI_DAILY_REQUEST_CAP=100        # lower it to spend less
```

> **Privacy:** requests are sent with `store: false`, so OpenAI retains nothing.
> A salted hash is sent as the safety identifier — never your name or email.
> Prompt content is never logged; only token counts.

---

## 7. Aeries

**Unlocks:** the official gradebook — class schedule, gradebook assignments and
real course grades.

**Cost:** free. **Time:** unknown, because it is not up to you.

**This one is genuinely blocked, and I want to be straight about why:**

- Aeries has **no central API**. Every district runs its own server.
- Access requires an **API certificate issued by a district Aeries
  administrator**.
- Districts issue those to staff and vetted systems. They essentially never
  issue one to a student.

So the realistic path is: ask. Email whoever runs Aeries at Santa Clara USD (IT
or the registrar) and explain it is a personal planner that reads only your own
record. Expect a no, but it costs nothing to ask.

If you do get a certificate:

```
AERIES_BASE_URL=https://aeries.santaclarausd.org
AERIES_CERT=xxxxxxxx
AERIES_STUDENT_ID=xxxxxx
AERIES_SCHOOL_CODE=1
```

If a request returns 404, your district's Aeries version uses different endpoint
paths. Override them:

```
AERIES_PATH_CLASSES=/api/v5/schools/{school}/classes/{student}
AERIES_PATH_GRADEBOOKS=/api/v5/schools/{school}/gradebooks/student/{student}
AERIES_PATH_GRADES=/api/v5/schools/{school}/StudentGrades/{student}
```

The parsing code is written and tested against fixture payloads. The network
calls are **not** verified, because no reachable Aeries instance exists to test
against.

**In the meantime:** Google Classroom (section 3) covers most of the same
ground — coursework, due dates and submission state — and you can enable that
yourself.

---

## 8. Secrets you generate yourself

Two values are not from any provider; you invent them.

**`TOKEN_ENCRYPTION_KEY`** — encrypts the Google refresh token. Required before
AaditOS will store any provider token.

**`CRON_SECRET`** — protects the scheduled sync endpoint. Without it,
`/api/cron/sync` returns 503 and refuses to run.

Generate both:

```bash
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 48 | tr -d '\n')"
echo "CRON_SECRET=$(openssl rand -base64 32 | tr -d '\n')"
echo "SAFETY_IDENTIFIER_SALT=$(openssl rand -base64 32 | tr -d '\n')"
```

Paste the output into `.env`. Use the **same values** in Vercel so sessions
survive a deploy — changing `TOKEN_ENCRYPTION_KEY` disconnects Google and
everyone has to reconnect.

---

## Putting it in production

Everything above goes into **Vercel → your project → Settings → Environment
Variables**. Two rules:

1. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are safe in the
   browser. Every other variable is server-only and must never get a `VITE_`
   prefix — that prefix is what ships a value to the client bundle.
2. After adding variables, **redeploy**. Vercel does not apply them to an
   existing deployment.

Then add your production callback URLs:

- Google Cloud → OAuth client → `https://YOUR-APP.vercel.app/api/google/callback`
- Supabase → URL Configuration → `https://YOUR-APP.vercel.app/auth/callback`

---

## Checking your work

**Integrations page** tells you the truth for every provider. It reads real
server state, not guesses:

| Badge | Meaning |
|-------|---------|
| **Ready to sync** | Works now, no credentials needed |
| **Connected** | A real request succeeded |
| **Ready to connect** | Configured, needs the browser consent step |
| **Needs credentials** | Environment variables are missing |
| **Error** | The last real request failed — the reason is shown |
| **Restricted by provider** | The provider does not permit this at all |

From a terminal you can check what the server thinks is configured:

```bash
curl -s http://localhost:8080/api/config
```

That returns booleans only — never a key, token or secret.

---

## What can never be made to work

Not laziness, not missing effort — these are provider policy:

- **Discord** gives third-party apps no access to your DMs or to servers you are
  merely a member of. Self-bots violate their terms. Only a webhook you create
  in your own server is possible.
- **LinkedIn**'s public API exposes no connections, messages or feed.
- **Gmail's** `gmail.readonly` is a restricted scope. Fine for your own account
  in a testing app; publishing it to other people requires a paid CASA security
  assessment.
- **Aeries**, as described in section 7.

AaditOS labels all of these honestly rather than showing a Connect button that
cannot work.
