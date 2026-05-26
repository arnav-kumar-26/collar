# Collar — Setup Guide (Outdated)

Collar is an LLM-powered code validation extension for VS Code. It analyses your
code against your team's rules and flags violations in real time.

---

## What you need

- VS Code 1.85 or later
- A Supabase account (free tier is fine) — https://supabase.com
- A GitHub account (used for sign-in)

---

## Step 1 — Create your Supabase project

1. Go to https://app.supabase.com and create a new project
2. Choose any name, region, and database password
3. Wait for the project to finish provisioning (~1 minute)

---

## Step 2 — Run the schema

1. In your Supabase project, go to **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the `schema.sql` file included with this package
4. Paste the entire contents into the SQL editor
5. Click **Run**

This creates all the tables, security policies, and seed rules Collar needs.

---

## Step 3 — Add yourself to the invitations table

Collar requires an invitation before allowing sign-in. Add your GitHub email:

1. In Supabase, go to **Table Editor → invitations**
2. Click **Insert row**
3. Fill in:
   - `email` — the email address linked to your GitHub account
   - `role` — set to `developer` (or `admin` if you are managing the team)
4. Save the row

> You can find your GitHub email at https://github.com/settings/emails

---

## Step 4 — Install the extension

1. Open VS Code
2. Go to the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Click the `···` menu at the top right of the Extensions panel
4. Select **Install from VSIX...**
5. Choose the `collar-0.1.0.vsix` file

---

## Step 5 — Connect to your Supabase project

When you first open the Collar sidebar (shield icon in the activity bar), it will
ask for two values from your Supabase project.

To find them:

1. In Supabase, go to **Project Settings → API**
2. Copy the **Project URL** — looks like `https://xxxx.supabase.co`
3. Copy the **anon public** key under Project API keys

Paste these into the prompts VS Code shows. They are stored securely in VS Code's
secret storage and never shared.

---

## Step 6 — Sign in

1. Click **Sign in with GitHub** in the Collar sidebar
2. Your browser opens and asks you to authorise with GitHub
3. After authorising, VS Code reopens and Collar activates

If you see "Access denied", check that the email on your GitHub account matches
the one you added to the invitations table in Step 3.

---

## What happens next

Once signed in, Collar automatically scans your workspace and highlights any
violations of your team's rules. Violations appear:

- As coloured underlines in the editor
- In the **Violations** tab in the Collar sidebar
- In a `violations.md` file written to your workspace root

You can ask Collar to explain any violation using the **Chat** tab, or click
**✨ Auto-fix** in the status bar to attempt automatic fixes.

---

## Troubleshooting

**"No credentials" on startup** — Re-enter your Supabase URL and anon key using
the command palette: `Collar: Clear Credentials`, then restart VS Code.

**"Session expired"** — Click Sign In again. Sessions last 1 hour by default.

**No violations detected** — Make sure your workspace folder is open (not just a
single file). Collar requires an open folder to scan.

**Auto-fix made a mistake** — Use `git checkout .` to revert all changes if you
committed before running Auto-fix. Individual file changes can be undone with
`Ctrl+Z` / `Cmd+Z`.
