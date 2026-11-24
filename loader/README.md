# Auction wake-up loader

A self-contained static page for the IPL Auction Night game. It is meant to
live on a host that stays on (Render static sites do not sleep). While the
free web service at https://ipl-auction-45i3.onrender.com is spinning up,
this page shows rotating cricket-fan cartoons, pings `/healthz`, and jumps
into the game once the server answers. Room invites are preserved:

- `https://<loader>/?room=ABC123`
- `https://<loader>/r/ABC123` (needs the rewrite in `_redirects`)

The cartoons are original drawings. They do not use photographs or likenesses
of real players.

## Recommended hosting (not created yet)

Use a **new Render static site in the existing `asutoss` workspace**
(`tea-dc05b8qfngtc73b21qn0`). This does not need a new Render account. It
does create one extra free service, which needs your approval before anyone
clicks through.

1. Open the [Render Dashboard](https://dashboard.render.com) signed in as the
   existing `asutoss` workspace (ashutoshpal0456@gmail.com).
2. Click **New → Static Site**. Connect the existing GitHub repo
   `asutoss/ipl-auction` (the same repo as the game).
3. Set:
   - **Name:** `ipl-auction-loader` (or similar)
   - **Branch:** `main` (only after this work has been pushed)
   - **Root directory:** leave empty
   - **Build command:** leave empty
   - **Publish directory:** `loader`
4. Deploy. Render will give you a URL such as
   `https://ipl-auction-loader.onrender.com`. Static sites are free, sit on
   a CDN, and do not spin down.
5. Confirm `_redirects` is published so `/r/CODE` still serves this page.
6. Try `https://<loader-url>/?room=ABC123`. When the game is asleep this
   page should appear; after about a minute it should redirect to
   `https://ipl-auction-45i3.onrender.com/r/ABC123`.
7. Optionally add a custom domain on the static site, and later point the
   game’s WhatsApp invite links at the loader URL so friends never see
   Render’s own spin-up page.

Until this static site exists, visitors who open the game URL directly will
still see Render’s default wake-up page. The in-app meme carousel still
covers the slower first socket connection once the game HTML has loaded.

## Local preview

From the repo root:

```bash
npx --yes serve loader -p 4173
```

Or run the game (`npm start`) and open `/loader/`.
