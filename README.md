# Apars Classroom HLS Saver

Userscript to save your own 720p HLS video streams from aparsclassroom.com
while you're logged in and the video is playing — same idea as any
"download this video I already have access to" browser tool.

## Structure

```
-
| dist/            built output: aparse.user.js (install this in Tampermonkey)
| src/
| | namespace.js   shared state (window.__hlsSaver)
| | core/
| | | core/util.js              URL/playlist parsing helpers
| | | frame-bridge.js           bridges playlist captures from the player's iframe to the top frame
| | | network-hooks.js          passive XHR/fetch response capture (no re-fetch, no CORS)
| | | hls-instance.js           hooks the page's Hls.js constructor, forces 720p level
| | | playlist-resolver.js      ties network-hooks + hls-instance together to get the 720p playlist
| | | segments.js               parses media playlist, fetches segments (extension-agnostic)
| | | remux.js                  real MP4 remux via ffmpeg.wasm, raw-concat fallback
| | | downloader.js             orchestrates resolve -> fetch -> remux -> download
| | | entry.js                  installs hooks, starts UI watcher
| | ui/
| | | button.js                 finds/attaches the in-page Download button
| tools/
| | build.c                     C build tool(mujs) to compile the aparse.user.js
| | VERSION                     plain-text version string, single line
| Makefile
```

## Build

```
make build
```

Compiles `tools/build.c` to `tools/build` (only recompiles if build.c
changed), then runs it. Outputs `dist/aparse.user.js`. No Node/JS runtime
needed — install `dist/aparse.user.js` in Tampermonkey/Violentmonkey.

To bump the version, edit `tools/VERSION` and rebuild.

## Chunk status

- [x] Chunk 0 — passive XHR/fetch playlist capture (fixed v6's CORS credentials bug)
- [x] Chunk 1 — force 720p via hooked Hls.js instance (`hls-instance.js`)
- [x] Chunk 2 — segment fetching treats `.dts`/any extension as raw bytes (`segments.js`)
- [x] Chunk 3 — real MP4 remux via ffmpeg.wasm, falls back to raw concat blob on failure (`remux.js`)
- [x] Chunk 4 — segment retry w/ backoff (3 attempts), cancel button (click while busy), per-stage % progress
- [x] Chunk 5 — cross-origin iframe support: player runs inside `iframe.mediadelivery.net`, a separate window our top-frame script couldn't see into. Script now injects into both frames; the iframe captures playlists and forwards them to the top frame via `postMessage` (`frame-bridge.js`)

## Notes

- Segment URLs on this site are named `.dts` but are plain MPEG-TS — the extension is cosmetic obfuscation and is never trusted, segments are always fetched and read as raw bytes.
- Playlists are captured passively from HLS.js's own successful requests rather than re-fetched, since the CDN's CORS headers don't support credentialed cross-origin requests (this was the root cause of v6 always reporting "No HLS playlist detected").
