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
