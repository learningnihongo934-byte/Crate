# Crate

Spotify, but with the parts Spotify leaves out. Live at **https://crate.rennko.tech**.

## Crate for Mac (the easy way)
Download **Crate.dmg** from the [latest release](https://github.com/learningnihongo934-byte/Crate/releases/latest) and drag it to Applications. On first launch, right-click → Open, because the app isn't notarized. Allow Crate to control Spotify when macOS asks.

The app works with the **Spotify app on your Mac** through its AppleScript interface, so it works on free accounts with no login or setup:
- Play, pause, skip, seek, volume, shuffle and repeat, from the window, the bottom bar, the menu bar icon or the keyboard (Space / J / L)
- A real **Up Next** queue: Crate starts each queued song as the current one ends
- Logs every song you play with real listening time, so your stats build themselves
- A sleep timer that fades out, and an A–B loop for practising a section
- Rooms where a **Drop** starts the song in everyone's Spotify at the same moment

The app is a thin Electron shell (`app/`) that loads crate.rennko.tech and exposes a fixed set of Spotify commands (`app/preload.js`).

## The web version
Crate also runs in the browser and keeps your data there. It works in two layers:

**Without a Spotify login** (works for any account, free included)
- **Stats anytime**: import your Spotify data export (the zip, read in the browser) for lifetime stats over any date range: real minutes, top songs/artists/albums, play log, monthly chart.
- **Listening clock**: hour × weekday heatmap and a daily calendar.
- **Obsessions**: songs you put on repeat, streaks of days in a row, songs you loved then dropped, most-skipped songs, new artists per month.
- **Share cards**: Wrapped-style PNGs (summary, top artists, top songs, clock) for any range, at 4:5 or 9:16.
- **Up Next**: Crate's own queue (free accounts can't edit Spotify's). Press `N` to open the next song in Spotify.
- **Rooms**: listen with friends using a code. You see what everyone is playing, share a queue and chat, and **Drop** a song for a 4-second countdown so everyone presses play together. Guests don't need a login.

**With a Spotify login** (a developer app whose owner has Premium; you can be one of its 5 users)
- Live **now playing** with your full history for that song, plus like and add-to-playlist.
- New plays are logged automatically, so your history keeps growing after the export.
- **Playlist tools**: sort by any column (including your own play count), find and remove duplicates, true shuffle, split by decade, artist or played/unplayed, merge, copy, CSV export, and undo through saved versions.
- **Smart playlists**: rules that fill real playlists: top tracks, liked songs by date, random liked songs, merged playlists, most played in your history, on repeat, forgotten favorites, liked but never played. Spotify-based rules can refresh daily in the cloud through a Cloudflare cron.
- **Genre map**: genres weighted by minutes, and how your mix changed year by year.

## Setting up the Spotify login
Since February 2026, Spotify only lets a development-mode app log people in if the app's owner has Premium, and each app is capped at 5 users. The Premium account creates an app at developer.spotify.com/dashboard with:
- Redirect URI `https://crate.rennko.tech/callback`
- Web API turned on
- Your Spotify email added under User Management

Then paste the Client ID into **Data & Spotify**. There is no client secret, because login uses PKCE.

## Build
```sh
./build.sh          # copy public/ → dist/
./build.sh check    # + syntax check
./build.sh dev      # local Worker at http://127.0.0.1:8850
./build.sh deploy   # publish to crate.rennko.tech
./build.sh app      # build the Mac app + dmg, install to /Applications
```

## Layout
- `public/`: the site, plain ES modules with no bundler. `js/views/*` holds one file per page; `js/rules.js` is shared with the Worker.
- `worker/index.js`: `/api/art` (Spotify oEmbed art, edge-cached), `/api/img` (CORS proxy for share cards), the `Room` Durable Object (WebSocket rooms), the `Vault` Durable Object (holds refresh tokens for cloud smart playlists only after you turn them on), and the daily cron.

Made by **Virat Reddy Kaukuntla** ([@learningnihongo934-byte](https://github.com/learningnihongo934-byte))
