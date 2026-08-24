const PAGE_WINDOW = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

window.__hlsSaver = window.__hlsSaver || {
    version: '7.11.1',
    pageWindow: PAGE_WINDOW,
    playlists: new Map(),   // url -> m3u8 text
    downloadButton: null,
    busy: false,
    log(...a){ console.log('[HLS Saver]', ...a); },
};

try{ PAGE_WINDOW.__hlsSaver = window.__hlsSaver; }catch(e){ /* ignore */ }
