# Airbnb Calendar — PWA

Standalone, installable copy of the "Airbnb Multi-calendar" Page. No runtime network calls for
Airbnb data: the snapshot is embedded in `data.js` at build time.

**Live site:** https://casitasinc-afk.github.io/airbnb-calendar/

This directory is the GitHub Pages site root for public repo
[casitasinc-afk/airbnb-calendar](https://github.com/casitasinc-afk/airbnb-calendar)
(branch `main`). Paths in `manifest.webmanifest` (`start_url` / `scope`: `.`) and
`navigator.serviceWorker.register("sw.js")` are relative, so the app also still works when
served from the temporary Cloudflare tunnel at `/`.

Files: `index.html` (UI), `data.js` (generated data), `manifest.webmanifest`, `sw.js`
(generated from `sw.js.tmpl`; offline cache), `icons/` (192, 512, maskable 512), `.nojekyll`.

## Install on Android (Chrome)
1. Open the live site URL in **Chrome** on the phone.
2. Tap the **⋮** menu (top right).
3. Tap **Install app** (or **Add to Home screen** → **Install**).
4. Launch "Calendar" from the home screen — opens full-screen, works offline with the last
   snapshot. When online it fetches the newest published snapshot automatically
   (network-first); close and reopen the app to see a new version.

## Rebuild and publish
```bash
python3 /workspace/airbnb_calendar/refresh.py
python3 /workspace/airbnb_calendar/build_pwa.py --publish
# or: /workspace/airbnb_calendar/publish_pwa.sh
```
Hourly refresh should run `build_pwa.py --publish` (or `publish_pwa.sh`) after the Page's
EditCanvas DATA swap, so this site stays in sync.

## Housebot (guest chat)

Guests open a plain text chat at
`https://casitasinc-afk.github.io/airbnb-calendar/housebot/?boat=Anahita`
(use the listing name from the calendar for `boat`). There is a small static boat icon
and no voice or speaking animation. The page calls the Supabase Edge Function `housebot`.
That function is the only place that talks to OpenAI. The key is the function secret
`OPENAI_API_KEY`. It is not in this repo and not in the page.

The bot answers only from `housebot_knowledge` (check-in 15:00, check-out 10:00, marina
parking, the toilet rule, and whatever you add). It does not know Wi-Fi until you fill
that row in. It never repeats a lockbox, keybox, door, or PIN code: do not put those in
the knowledge table. If it does not know, or the guest needs a decision (early check-in,
late check-out, something broken), it tells the guest the host team will reply, and the
question shows up in the calendar under **✉ Messages**, marked **Housebot**, with the
listing, guest name, time, and question. Reply in that thread. The guest sees the reply
in the same Housebot chat after they refresh the page (or come back to the tab). Nothing
is sent to Airbnb.

A session may send 12 messages an hour and 60 in total. Each message is at most 800
characters.

The model defaults to `gpt-5-mini`. OpenAI shuts that model down on **11 December 2026**.
Before then, set the secret `HOUSEBOT_MODEL` to `gpt-6.1-terra` (no code change).

### What you do once, in order

Project ref: `pamzwqmjeizcieciaijf`.

1. **Run the migration.** In the Supabase dashboard open **SQL Editor**, paste the whole
   file `supabase/migrations/20261123193000_housebot.sql`, and run it. Or, with the
   [Supabase CLI](https://supabase.com/docs/guides/cli) logged in as an owner:

   ```bash
   supabase link --project-ref pamzwqmjeizcieciaijf
   supabase db query --linked -f supabase/migrations/20261123193000_housebot.sql
   ```

2. **Deploy the function.** From this repo:

   ```bash
   supabase functions deploy housebot --project-ref pamzwqmjeizcieciaijf
   ```

   `supabase/config.toml` sets `verify_jwt = false` for this function because the browser's
   preflight does not send a JWT. The function still rejects calls that do not present
   this project's anon key (the same public key already in the calendar). Leave that
   setting as it is.

3. **Set the OpenAI secret** (dashboard → Edge Functions → Secrets, or the CLI). You need
   the Owner or Administrator role:

   ```bash
   supabase secrets set OPENAI_API_KEY=sk-... --project-ref pamzwqmjeizcieciaijf
   ```

   Optional, before 11 December 2026:

   ```bash
   supabase secrets set HOUSEBOT_MODEL=gpt-6.1-terra --project-ref pamzwqmjeizcieciaijf
   ```

   The function reads a new secret immediately. You do not redeploy for a secret change.
   Do not commit the key. Do not put it in `index.html` or `housebot/index.html`.

4. **Edit the knowledge base** in Supabase → **Table Editor** → `housebot_knowledge`.
   An empty `listing` applies to every property. The row `topic = wifi` currently says
   `NOT SET`. Replace its `body` with the network name and password guests are allowed
   to see. To override one place only, insert a row with that listing name and the same
   topic, for example:

   ```sql
   insert into public.housebot_knowledge (listing, topic, body, sort)
   values ('Anahita', 'wifi', 'Wi-Fi network: ExampleGuest. Password: example-only.', 100);
   ```

   The next guest message uses the table. No redeploy. `housebot/knowledge.json` is the
   seed copied in by the migration; editing the file later does nothing until you change
   the matching table row. Do not put entry codes in this table.

5. **Merge this branch** so GitHub Pages publishes `/housebot/`. Until that merge, the
   QR codes point at a page that is not live yet.

6. **Print the QR codes** in `housebot/qr/`. Open `housebot/qr/print.html`, print, and
   put each code in that houseboat or house. `choose.png` is the page where the guest
   picks the place themselves. The others open the named listing
   (`?boat=Anahita`, and the same for every name in the calendar).

### If the calendar is rebuilt from `build_pwa.py`

That script regenerates `sw.js` from its own template. This repo's `sw.js` and
`sw.js.tmpl` tell the service worker not to substitute the calendar when a guest opens
`/housebot/` offline. Copy that `housebot` exception into the builder's template, or the
next publish will drop it. Online, Housebot still loads either way.

### Not done from this repository

This change does not run the migration, deploy the function, or set `OPENAI_API_KEY`.
Those need your Supabase owner access. Until step 3, Housebot still saves the guest's
question into the calendar inbox and says the host team will reply, but it cannot answer
from the notes. Until step 1, questions cannot be stored and the guest is told to write
on Airbnb.
