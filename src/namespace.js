// Resolve the REAL page window. Under Tampermonkey on Firefox, `window`
// inside a userscript can be an Xray-wrapped view that is NOT the same
// object identity the page's own scripts (hls.min.js) see — patching
// XMLHttpRequest.prototype through that wrapper silently does nothing to
// the page's actual requests. unsafeWindow is Tampermonkey's explicit
// escape hatch to the real page window; @grant unsafeWindow is required
// for it to exist. Falls back to window for other userscript managers
// that don't need the escape hatch (Violentmonkey often doesn't).
const PAGE_WINDOW = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

// Shared namespace for the HLS Saver userscript.
// Every module attaches to window.__hlsSaver instead of using globals directly,
// so tools/build.c can concatenate files in dependency order without import/export.
// 7.11.1 is substituted by tools/build.c from tools/VERSION,
// so this never drifts from the @version in the userscript header again.
window.__hlsSaver = window.__hlsSaver || {
    version: '7.11.1',
    pageWindow: PAGE_WINDOW,
    playlists: new Map(),   // url -> m3u8 text
    downloadButton: null,
    busy: false,
    log(...a){ console.log('[HLS Saver]', ...a); },
};

// Also expose the SAME object on the real page window. Internally every
// module still reads `window.__hlsSaver` (the userscript's own scope,
// self-consistent across all our files) -- this mirror exists purely so
// the actual browser devtools console, which evaluates in true page
// context, can inspect __hlsSaver for debugging. Without this, internal
// logging can show captured playlists while `window.__hlsSaver` typed
// into the console still reads as undefined, which is confusing but not
// a sign anything is actually broken.
try{ PAGE_WINDOW.__hlsSaver = window.__hlsSaver; }catch(e){ /* ignore */ }
