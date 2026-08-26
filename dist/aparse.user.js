// ==UserScript==
// @name         Apars Classroom HLS Saver
// @namespace    apars-aparse
// @version      7.14.0
// @description  Download 720p HLS stream (forced level select + ffmpeg.wasm remux)
// @match        https://*.aparsclassroom.com/*
// @match        https://iframe.mediadelivery.net/*
// @match        https://*.mediadelivery.net/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

// ---- namespace.js ----
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

// ---- core/util.js ----
(function(){
const NS = window.__hlsSaver;

NS.isHLS = function(u){
    return typeof u === 'string' && /\.m3u8(?:[?#]|$)/i.test(u);
};

NS.addPlaylist = function(url, text){
    if(!url || !text) return;
    if(!(text.includes('#EXTM3U') || text.includes('#EXT-X-'))) return;
    const old = NS.playlists.get(url);
    if(old === text) return;
    NS.playlists.set(url, text);
    NS.log('Captured playlist:', url, text.length, 'bytes');
};

NS.find720pVariant = function(masterURL, text){
    const lines = text.split(/\r?\n/).map(x => x.trim());
    for(let i = 0; i < lines.length; i++){
        if(!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const m = lines[i].match(/RESOLUTION\s*=\s*(\d+)x(\d+)/i);
        if(m && +m[2] === 720 && lines[i+1] && !lines[i+1].startsWith('#'))
            return new URL(lines[i+1], masterURL).href;
    }
    for(let i = 0; i < lines.length; i++){
        if(lines[i].startsWith('#EXT-X-STREAM-INF') && /720p|\b720\b/i.test(lines[i]) && lines[i+1] && !lines[i+1].startsWith('#'))
            return new URL(lines[i+1], masterURL).href;
    }
    return null;
};

NS.find720pLevelIndex = function(levels){
    if(!Array.isArray(levels)) return -1;
    let idx = levels.findIndex(l => l && l.height === 720);
    if(idx !== -1) return idx;
    idx = levels.findIndex(l => l && /720/.test(l.name || l.url || ''));
    return idx;
};

NS.getMasterPlaylist = function(){
    for(const [url, text] of NS.playlists){
        if(text.includes('#EXT-X-STREAM-INF')) return {url, text};
    }
    return null;
};

NS.getMediaPlaylist = function(){
    for(const [url, text] of NS.playlists){
        if(text.includes('#EXTINF') || text.includes('#EXT-X-TARGETDURATION')) return {url, text};
    }
    return null;
};
})();

// ---- core/frame-bridge.js ----
(function(){
const NS = window.__hlsSaver;

NS.isTopFrame = (window.top === window);

if(!NS.isTopFrame){
    const origAddPlaylist = NS.addPlaylist;
    NS.addPlaylist = function(url, text){
        origAddPlaylist(url, text);
        try{
            window.top.postMessage({__hlsSaver: true, type: 'playlist', url, text}, '*');
        }catch(e){ NS.log('postMessage to top failed:', e); }
    };
}

window.addEventListener('message', e => {
    const d = e.data;
    if(!d || d.__hlsSaver !== true) return;
    if(d.type === 'playlist' && NS.isTopFrame){
        NS.log('Playlist received from iframe:', d.url);
        NS.addPlaylist(d.url, d.text);
    }else if(d.type === 'pause-playback'){
        NS.pauseAllPlayback();
    }else if(d.type === 'resume-playback'){
        NS.resumeAllPlayback();
    }
});

NS.broadcastToFrames = function(type){
    document.querySelectorAll('iframe').forEach(f => {
        try{ f.contentWindow.postMessage({__hlsSaver: true, type}, '*'); }catch(e){}
    });
};
})();

// ---- core/network-hooks.js ----
(function(){
const NS = window.__hlsSaver;

function extractText(xhr){
    const type = xhr.responseType;
    if(type === '' || type === 'text'){
        return xhr.responseText;
    }
    if(type === 'arraybuffer' && xhr.response){
        try{ return new TextDecoder('utf-8').decode(xhr.response); }catch{ return null; }
    }
    if(type === 'blob' && xhr.response){
        return xhr.response.text();
    }
    return null;
}

function hookXHR(){
    const OrigXHR = NS.pageWindow.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function(method, url, ...rest){
        this.__hlsSaverURL = url;
        return origOpen.call(this, method, url, ...rest);
    };

    OrigXHR.prototype.send = function(...args){
        if(NS.isHLS(this.__hlsSaverURL)){
            this.addEventListener('load', function(){
                try{
                    if(this.status >= 200 && this.status < 300){
                        const result = extractText(this);
                        if(result && typeof result.then === 'function'){
                            result.then(t => NS.addPlaylist(this.__hlsSaverURL, t))
                                  .catch(e => NS.log('XHR blob text read failed:', e));
                        }else if(result){
                            NS.addPlaylist(this.__hlsSaverURL, result);
                        }else{
                            NS.log('XHR captured but could not extract text:', this.__hlsSaverURL, this.responseType);
                        }
                    }
                }catch(e){ NS.log('XHR capture error:', e); }
            });
        }
        return origSend.apply(this, args);
    };
}

function hookFetch(){
    const origFetch = NS.pageWindow.fetch;
    NS.pageWindow.fetch = async function(input, init){
        const url = typeof input === 'string' ? input : input?.url;
        const res = await origFetch.call(this, input, init);
        if(NS.isHLS(url)){
            try{
                const clone = res.clone();
                clone.text().then(t => NS.addPlaylist(url, t)).catch(e => NS.log('fetch clone read failed:', e));
            }catch(e){ NS.log('fetch clone error:', e); }
        }
        return res;
    };
}

const seenResourceURLs = new Set();
function scanResourceTimingFallback(){
    try{
        for(const entry of NS.pageWindow.performance.getEntriesByType('resource')){
            const url = entry.name;
            if(!NS.isHLS(url) || seenResourceURLs.has(url) || NS.playlists.has(url)) continue;
            seenResourceURLs.add(url);
            NS.pageWindow.fetch(url, {cache: 'no-store', credentials: 'omit'})
                .then(r => r.ok ? r.text() : null)
                .then(t => { if(t) NS.addPlaylist(url, t); })
                .catch(e => NS.log('Resource-timing fallback fetch failed:', url, e));
        }
    }catch(e){ NS.log('Resource-timing scan failed:', e); }
}

NS.startResourceTimingFallback = function(){
    try{ NS.pageWindow.performance.setResourceTimingBufferSize(10000); }catch{}
    scanResourceTimingFallback();
    setInterval(scanResourceTimingFallback, 1000);
};

NS.installNetworkHooks = function(){
    try{ hookXHR(); }catch(e){ NS.log('XHR hook failed:', e); }
    try{ hookFetch(); }catch(e){ NS.log('fetch hook failed:', e); }
    NS.startResourceTimingFallback();
};
})();

// ---- core/hls-instance.js ----
(function(){
const NS = window.__hlsSaver;

NS.hlsInstances = new Set();

NS.installHlsConstructorHook = function(){
    const tryHook = () => {
        const HlsGlobal = NS.pageWindow.Hls;
        if(!HlsGlobal || HlsGlobal.__hlsSaverHooked) return false;
        const OrigHls = HlsGlobal;
        function WrappedHls(...args){
            const instance = new OrigHls(...args);
            NS.hlsInstances.add(instance);
            NS.log('hls.js instance captured');
            return instance;
        }
        WrappedHls.prototype = OrigHls.prototype;
        Object.setPrototypeOf(WrappedHls, OrigHls);
        Object.getOwnPropertyNames(OrigHls).forEach(k => {
            if(k === 'prototype' || k === 'length' || k === 'name') return;
            try{ WrappedHls[k] = OrigHls[k]; }catch{}
        });
        WrappedHls.__hlsSaverHooked = true;
        NS.pageWindow.Hls = WrappedHls;
        NS.log('Hls constructor hooked');
        return true;
    };
    if(tryHook()) return;
    const iv = setInterval(() => { if(tryHook()) clearInterval(iv); }, 300);
    setTimeout(() => clearInterval(iv), 20000);
};

function scanWindowForHlsInstance(){
    try{
        for(const key of Object.getOwnPropertyNames(NS.pageWindow)){
            try{
                const v = NS.pageWindow[key];
                if(v && typeof v === 'object' && Array.isArray(v.levels) && typeof v.loadLevel !== 'undefined'){
                    NS.hlsInstances.add(v);
                }
            }catch{}
        }
    }catch{}
}

NS.force720p = function(){
    if(NS.hlsInstances.size === 0) scanWindowForHlsInstance();
    for(const hls of NS.hlsInstances){
        try{
            const idx = NS.find720pLevelIndex(hls.levels);
            if(idx === -1) continue;
            NS.log('Forcing hls.js level to 720p, index', idx);
            hls.loadLevel = idx;
            hls.currentLevel = idx;
            return true;
        }catch(e){ NS.log('force720p error on instance:', e); }
    }
    return false;
};

NS.deriveVariantUrlFromPattern = function(knownUrl, height){
    try{
        const m = knownUrl.match(/^(.*\/)(\d+)p\/video\.m3u8/);
        if(m) return `${m[1]}${height}p/video.m3u8`;
        const m2 = knownUrl.match(/^(.*\/)playlist\.m3u8/);
        if(m2) return `${m2[1]}${height}p/video.m3u8`;
    }catch{}
    return null;
};

NS.pauseAllPlayback = function(){
    document.querySelectorAll('video').forEach(v => { try{ v.pause(); }catch(e){} });
    for(const hls of NS.hlsInstances){
        try{ hls.stopLoad(); }catch(e){}
    }
};

NS.resumeAllPlayback = function(){
    for(const hls of NS.hlsInstances){
        try{ hls.startLoad(); }catch(e){}
    }
};
})();

// ---- core/playlist-resolver.js ----
(function(){
const NS = window.__hlsSaver;

function waitForPlaylist(url, timeoutMs = 8000){
    return new Promise((resolve, reject) => {
        if(NS.playlists.has(url)) return resolve(NS.playlists.get(url));
        const start = Date.now();
        const iv = setInterval(() => {
            if(NS.playlists.has(url)){
                clearInterval(iv);
                resolve(NS.playlists.get(url));
            }else if(Date.now() - start > timeoutMs){
                clearInterval(iv);
                reject(Error('Timed out waiting for variant playlist: ' + url));
            }
        }, 150);
    });
}

NS.resolve720pPlaylist = async function(masterUrl, masterText){
    if(!masterText.includes('#EXT-X-STREAM-INF')) return {url: masterUrl, text: masterText};

    const variant = NS.find720pVariant(masterUrl, masterText);
    if(!variant) throw Error('No 720p variant found in master playlist.');

    if(NS.playlists.has(variant)) return {url: variant, text: NS.playlists.get(variant)};

    const derived = NS.deriveVariantUrlFromPattern(masterUrl, 720) || variant;
    try{
        const r = await NS.pageWindow.fetch(derived, {cache: 'no-store', credentials: 'omit'});
        if(r.ok){
            const text = await r.text();
            if(text.includes('#EXTM3U') || text.includes('#EXT-X-')){
                NS.addPlaylist(derived, text);
                return {url: derived, text};
            }
        }
        NS.log('Direct fetch of derived 720p URL did not return a playlist, falling back:', derived, r.status);
    }catch(e){
        NS.log('Direct fetch of derived 720p URL failed, falling back:', e);
    }

    const forced = NS.force720p();
    NS.log(forced ? 'Requested 720p level switch via hls.js' : 'No hls.js instance found, falling back to passive wait');

    const text = await waitForPlaylist(variant).catch(() => null);
    if(text) return {url: variant, text};

    throw Error('720p variant playlist was not captured. Try seeking/scrubbing the video once, then click Download again.');
};
})();

// ---- core/hls-crypto.js ----
(function(){
const NS = window.__hlsSaver;

const keyCache = new Map(); // key URI -> Promise<CryptoKey>

function ivFromSequence(seq){
    const iv = new Uint8Array(16);
    let n = seq;
    for(let i = 15; i >= 0 && n > 0; i--){
        iv[i] = n & 0xff;
        n = Math.floor(n / 256);
    }
    return iv;
}

function getSubtle(){
    return (NS.pageWindow.crypto || crypto).subtle;
}

function getKey(keyUri){
    if(!keyCache.has(keyUri)){
        keyCache.set(keyUri, (async () => {
            const r = await NS.pageWindow.fetch(keyUri, {cache: 'no-store', credentials: 'omit'});
            if(!r.ok) throw Error(`Key fetch failed: ${r.status} ${keyUri}`);
            const bytes = await r.arrayBuffer();
            return getSubtle().importKey('raw', bytes, {name: 'AES-CBC'}, false, ['decrypt']);
        })());
    }
    return keyCache.get(keyUri);
}

NS.parseKeyLine = function(line, playlistUrl){
    const methodMatch = line.match(/METHOD=([^,]+)/i);
    const method = methodMatch ? methodMatch[1].trim() : 'NONE';
    if(method === 'NONE') return null;

    const uriMatch = line.match(/URI="([^"]+)"/i);
    if(!uriMatch) return null;
    const uri = new URL(uriMatch[1], playlistUrl).href;

    let ivBytes = null;
    const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);
    if(ivMatch){
        const hex = ivMatch[1].padStart(32, '0');
        ivBytes = new Uint8Array(16);
        for(let i = 0; i < 16; i++) ivBytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }

    return {method, uri, ivBytes};
};

NS.decryptSegmentIfNeeded = async function(buffer, keyInfo, seq){
    if(!keyInfo) return buffer;
    if(keyInfo.method !== 'AES-128'){
        NS.log('Unsupported HLS encryption method, passing through undecrypted:', keyInfo.method);
        return buffer;
    }
    const cryptoKey = await getKey(keyInfo.uri);
    const iv = keyInfo.ivBytes || ivFromSequence(seq);
    return getSubtle().decrypt({name: 'AES-CBC', iv}, cryptoKey, buffer);
};
})();

// ---- core/segments.js ----
(function(){
const NS = window.__hlsSaver;

NS.parseMediaPlaylist = function(url, text){
    const lines = text.split(/\r?\n/).map(x => x.trim());
    const files = [];
    let init = null;
    let currentKey = null;
    let seq = 0;

    for(const line of lines){
        if(line.startsWith('#EXT-X-MEDIA-SEQUENCE:')){
            seq = parseInt(line.split(':')[1], 10) || 0;
            continue;
        }
        if(line.startsWith('#EXT-X-KEY:')){
            currentKey = NS.parseKeyLine(line, url);
            continue;
        }
        if(line.startsWith('#EXT-X-MAP:')){
            const m = line.match(/URI="([^"]+)"/i);
            if(m) init = {url: new URL(m[1], url).href, key: currentKey, seq};
            continue;
        }
        if(!line || line.startsWith('#') || line.startsWith('data:')) continue;
        try{
            files.push({url: new URL(line, url).href, key: currentKey, seq});
            seq++;
        }catch{}
    }
    if(init) files.unshift(init);
    return files;
};

NS.fetchSegment = async function(descriptor, signal){
    const r = await NS.pageWindow.fetch(descriptor.url, {cache: 'no-store', credentials: 'omit', signal});
    if(!r.ok) throw Error(`Segment failed: ${r.status} ${descriptor.url}`);
    const buffer = await r.arrayBuffer();
    return NS.decryptSegmentIfNeeded(buffer, descriptor.key, descriptor.seq);
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchSegmentWithRetry(descriptor, index, total, signal, onProgress){
    let lastErr;
    for(let attempt = 1; attempt <= MAX_RETRIES; attempt++){
        if(signal?.aborted) throw Error('Cancelled');
        try{
            return await NS.fetchSegment(descriptor, signal);
        }catch(e){
            lastErr = e;
            if(signal?.aborted) throw Error('Cancelled');
            NS.log(`Segment ${index + 1}/${total} failed (attempt ${attempt}/${MAX_RETRIES}):`, e.message || e);
            if(attempt < MAX_RETRIES){
                if(onProgress) onProgress(index, total, `retrying segment ${index + 1} (${attempt}/${MAX_RETRIES})`);
                await sleep(RETRY_BASE_DELAY_MS * attempt);
            }
        }
    }
    throw Error(`Segment ${index + 1}/${total} failed after ${MAX_RETRIES} attempts: ${lastErr?.message || lastErr}`);
}

const CONCURRENCY = 40;

NS.fetchAllSegments = async function(files, sink, onProgress, signal){
    let nextIndex = 0;
    let completed = 0;

    async function worker(){
        while(true){
            if(signal?.aborted) throw Error('Cancelled');
            const i = nextIndex++;
            if(i >= files.length) return;
            const buffer = await fetchSegmentWithRetry(files[i], i, files.length, signal, onProgress);
            await sink(i, buffer);
            completed++;
            NS.log(`Segment ${completed}/${files.length} downloaded (${buffer.byteLength} bytes)`);
            if(onProgress) onProgress(completed, files.length);
        }
    }

    const workerCount = Math.min(CONCURRENCY, files.length);
    const workers = Array.from({length: workerCount}, () => worker());
    await Promise.all(workers);
};
})();

// ---- core/remux.js ----
(function(){
const NS = window.__hlsSaver;

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js';
const FFMPEG_CORE_WASM_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm';
const FFMPEG_LIB_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
const FFMPEG_WORKER_CHUNK_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js';

let ffmpegLoadPromise = null;
let ffmpegInstance = null;

function loadScript(src){
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(Error('Failed to load script: ' + src));
        document.head.appendChild(s);
    });
}

async function toBlobURL(url, mimeType){
    const res = await NS.pageWindow.fetch(url, {cache: 'no-store', credentials: 'omit'});
    if(!res.ok) throw Error(`Failed to fetch ${url}: ${res.status}`);
    const buf = await res.arrayBuffer();
    return URL.createObjectURL(new Blob([buf], {type: mimeType}));
}

NS.getFFmpeg = function(){
    if(ffmpegLoadPromise) return ffmpegLoadPromise;
    ffmpegLoadPromise = (async () => {
        if(!NS.pageWindow.FFmpegWASM){
            await loadScript(FFMPEG_LIB_URL);
        }
        const {FFmpeg} = NS.pageWindow.FFmpegWASM;
        const ffmpeg = new FFmpeg();
        const classWorkerURL = await toBlobURL(FFMPEG_WORKER_CHUNK_URL, 'text/javascript');
        const coreURL = await toBlobURL(FFMPEG_CORE_URL, 'text/javascript');
        const wasmURL = await toBlobURL(FFMPEG_CORE_WASM_URL, 'application/wasm');
        await ffmpeg.load({coreURL, wasmURL, classWorkerURL});
        ffmpegInstance = ffmpeg;
        return ffmpeg;
    })();
    return ffmpegLoadPromise;
};

NS.terminateFFmpeg = function(){
    if(ffmpegInstance){
        try{ ffmpegInstance.terminate(); }catch(e){ NS.log('ffmpeg terminate failed:', e); }
    }
    ffmpegInstance = null;
    ffmpegLoadPromise = null;
};

NS.writeSegment = async function(ffmpeg, index, buffer){
    const name = `seg${String(index).padStart(5, '0')}.ts`;
    await ffmpeg.writeFile(name, new Uint8Array(buffer));
    return name;
};

NS.finishRemux = async function(ffmpeg, names, onProgress, signal){
    if(signal?.aborted) throw Error('Cancelled');
    const concatList = names.map(n => `file '${n}'`).join('\n');
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

    if(signal?.aborted) throw Error('Cancelled');

    if(onProgress){
        ffmpeg.on('progress', ({progress}) => {
            const pct = Math.max(0, Math.min(1, progress || 0));
            onProgress(pct);
        });
    }

    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4']);

    for(const name of names){
        try{ await ffmpeg.deleteFile(name); }catch(e){}
    }
    try{ await ffmpeg.deleteFile('concat.txt'); }catch(e){}

    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], {type: 'video/mp4'});
    try{ await ffmpeg.deleteFile('output.mp4'); }catch(e){}
    return blob;
};

NS.rawConcatFromFFmpeg = async function(ffmpeg, names){
    const parts = [];
    for(const name of names){
        const data = await ffmpeg.readFile(name);
        parts.push(data.buffer ? data.buffer : data);
        try{ await ffmpeg.deleteFile(name); }catch(e){}
    }
    return new Blob(parts, {type: 'video/mp2t'});
};
})();

// ---- core/partdownloader.js ----
(function(){
const NS = window.__hlsSaver;

const BATCH_SIZE = 50;
const PART_SIZE = 750;

function triggerDownload(blob, filename){
    const a = document.createElement('a');
    const u = URL.createObjectURL(blob);
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
}

NS.currentDownloadController = null;

NS.cancelDownload = function(){
    if(NS.currentDownloadController){
        NS.currentDownloadController.abort();
        NS.log('Download cancelled by user');
    }
};

async function fetchAndBatch(ffmpeg, files, updateStatus, signal){
    const pending = new Map();
    let nextFlushIndex = 0;
    let currentBatch = [];
    let batchCount = 0;
    const names = [];

    async function flushBatch(){
        if(currentBatch.length === 0) return;
        let total = 0;
        for(const b of currentBatch) total += b.byteLength;
        const combined = new Uint8Array(total);
        let off = 0;
        for(const b of currentBatch){
            combined.set(new Uint8Array(b), off);
            off += b.byteLength;
        }
        const name = `batch${String(batchCount).padStart(5, '0')}.ts`;
        await ffmpeg.writeFile(name, combined);
        names.push(name);
        batchCount++;
        currentBatch = [];
    }

    async function tryFlush(){
        while(pending.has(nextFlushIndex)){
            currentBatch.push(pending.get(nextFlushIndex));
            pending.delete(nextFlushIndex);
            nextFlushIndex++;
            if(currentBatch.length >= BATCH_SIZE) await flushBatch();
        }
    }

    await NS.fetchAllSegments(files, async (i, buffer) => {
        pending.set(i, buffer);
        await tryFlush();
    }, (done, total, note) => {
        const pct = Math.round(done / total * 100);
        if(note) updateStatus(`${note} (${pct}%)`);
        else updateStatus(`Downloading segment ${done}/${total} (${pct}%)`);
    }, signal);

    await flushBatch();
    return names;
}

async function runPart(partFiles, partLabel, updateStatus, signal, outputName){
    updateStatus(`${partLabel}: loading ffmpeg.wasm...`);
    const ffmpeg = await NS.getFFmpeg();
    try{
        NS.log(`${partLabel}: downloading ${partFiles.length} segments`);
        const names = await fetchAndBatch(ffmpeg, partFiles, (text) => updateStatus(`${partLabel}: ${text}`), signal);

        try{
            const blob = await NS.finishRemux(ffmpeg, names, pct => {
                updateStatus(`${partLabel}: remuxing ${Math.round(pct * 100)}%`);
            }, signal, outputName);
            return {blob, extension: outputName.endsWith('.mp4') ? 'mp4' : 'ts'};
        }catch(e){
            NS.log(`${partLabel}: remux failed, falling back to raw concat:`, e);
            updateStatus(`${partLabel}: remux failed, using raw concat...`);
            return {blob: await NS.rawConcatFromFFmpeg(ffmpeg, names), extension: 'ts'};
        }
    }finally{
        NS.terminateFFmpeg();
    }
}

async function foldMerge(runningBlob, nextBlob, outputName, updateStatus, signal){
    updateStatus('Merging: loading ffmpeg.wasm...');
    const ffmpeg = await NS.getFFmpeg();
    try{
        updateStatus('Merging: writing running output...');
        const runningBuf = await runningBlob.arrayBuffer();
        await ffmpeg.writeFile('running.ts', new Uint8Array(runningBuf));

        updateStatus('Merging: writing next part...');
        const nextBuf = await nextBlob.arrayBuffer();
        await ffmpeg.writeFile('next.ts', new Uint8Array(nextBuf));

        const names = ['running.ts', 'next.ts'];
        try{
            const blob = await NS.finishRemux(ffmpeg, names, pct => {
                updateStatus(`Merging: ${Math.round(pct * 100)}%`);
            }, signal, outputName);
            return {blob, extension: outputName.endsWith('.mp4') ? 'mp4' : 'ts'};
        }catch(e){
            NS.log('Merge failed, falling back to raw concat:', e);
            updateStatus('Merge failed, using raw concat...');
            return {blob: await NS.rawConcatFromFFmpeg(ffmpeg, names), extension: 'ts'};
        }
    }finally{
        NS.terminateFFmpeg();
    }
}

NS.runDownload = async function(masterOrMediaUrl, masterOrMediaText, updateStatus){
    const controller = new AbortController();
    NS.currentDownloadController = controller;
    NS.pauseAllPlayback();
    NS.broadcastToFrames('pause-playback');
    try{
        const playlist = await NS.resolve720pPlaylist(masterOrMediaUrl, masterOrMediaText);
        const files = NS.parseMediaPlaylist(playlist.url, playlist.text);
        if(!files.length) throw Error('No media segments found.');

        const baseName = (NS.getVideoTitle ? NS.getVideoTitle() : null) || 'video_720p';
        const partCount = Math.ceil(files.length / PART_SIZE);
        NS.log(`Downloading ${files.length} segments in ${partCount} part(s) of up to ${PART_SIZE} segments each`);

        let blob, extension;
        if(partCount === 1){
            const partFiles = files.slice(0, PART_SIZE);
            const result = await runPart(partFiles, 'Download', updateStatus, controller.signal, 'output.mp4');
            blob = result.blob;
            extension = result.extension;
        }else{
            let runningBlob = null;
            for(let p = 0; p < partCount; p++){
                if(controller.signal.aborted) throw Error('Cancelled');
                const partFiles = files.slice(p * PART_SIZE, (p + 1) * PART_SIZE);
                const partLabel = `Part ${p + 1}/${partCount}`;
                const result = await runPart(partFiles, partLabel, updateStatus, controller.signal, 'part.ts');

                if(runningBlob === null){
                    runningBlob = result.blob;
                }else{
                    const isLast = (p === partCount - 1);
                    const outputName = isLast ? 'output.mp4' : 'merged.ts';
                    const merged = await foldMerge(runningBlob, result.blob, outputName, updateStatus, controller.signal);
                    runningBlob = merged.blob;
                    extension = merged.extension;
                }
            }
            blob = runningBlob;
        }

        updateStatus('Preparing...');
        triggerDownload(blob, `${baseName}.${extension}`);
        updateStatus('Done.');
    }finally{
        NS.currentDownloadController = null;
        NS.terminateFFmpeg();
        NS.resumeAllPlayback();
        NS.broadcastToFrames('resume-playback');
    }
};
})();

// ---- ui/button.js ----
(function(){
const NS = window.__hlsSaver;

function sanitizeFilename(title){
    title = (title || '').split('|')[0].split(' — ')[0].trim();
    title = title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
    return title;
}

function extractHeadingTitle(){
    const el = document.querySelector('div.rounded-2xl h1.font-extrabold')
            || document.querySelector('h1.font-extrabold');
    return el ? el.textContent : null;
}

NS.getVideoTitle = function(){
    const heading = sanitizeFilename(extractHeadingTitle());
    if(heading) return heading;

    const fromTitle = sanitizeFilename(document.title);
    if(fromTitle) return fromTitle;

    return 'video_720p';
};

function findButton(){
    const icon = document.querySelector('svg.lucide-download');
    if(!icon) return null;
    const b = icon.closest('.flex-1');
    if(!b || !/download/i.test(b.textContent)) return null;
    return b;
}

function getInfoLine(){
    if(NS.infoLine && document.contains(NS.infoLine)) return NS.infoLine;
    const card = document.querySelector('div.rounded-2xl');
    if(!card) return null;
    const line = document.createElement('div');
    line.className = 'text-sm text-gray-500 dark:text-gray-400 mt-2';
    line.dataset.hlsSaverInfo = '1';
    card.appendChild(line);
    NS.infoLine = line;
    return line;
}

function updateInfo(text){
    const line = getInfoLine();
    if(line) line.textContent = text ? `[HLS Saver] ${text}` : '';
}

function findStatusSpan(){
    if(NS.statusSpan && NS.downloadButton.contains(NS.statusSpan)) return NS.statusSpan;
    const spans = NS.downloadButton.querySelectorAll('span');
    for(const s of spans){
        const v = s.textContent.trim().toLowerCase();
        if(v === 'download' || /^(finding|downloading|preparing|writing|remuxing|loading|remux|retrying|cancelling|part|final)/.test(v)){
            NS.statusSpan = s;
            return s;
        }
    }
    return null;
}

function updateButton(text){
    if(!NS.downloadButton) return;
    const span = findStatusSpan();
    if(span) span.textContent = text;
}

function setBusy(v){
    NS.busy = v;
    if(!NS.downloadButton) return;
    NS.downloadButton.style.opacity = v ? '0.6' : '';
    NS.downloadButton.style.pointerEvents = v ? 'none' : '';
}

function attachButton(b){
    if(!b || b.dataset.hlsSaverAttached) return;
    NS.downloadButton = b;
    b.dataset.hlsSaverAttached = '1';
    b.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if(NS.busy){
            NS.cancelDownload();
            updateButton('Cancelling...');
            return;
        }

        const selected = NS.getMasterPlaylist() || NS.getMediaPlaylist();
        if(!selected){
            updateButton('Download');
            alert('No HLS playlist detected.\n\nPlay the video for a few seconds, then click Download again.');
            return;
        }

        setBusy(true);
        updateButton('Preparing...');
        updateInfo('Preparing...');
        try{
            await NS.runDownload(selected.url, selected.text, text => {
                updateButton(text);
                updateInfo(text);
            });
            updateButton('Download');
            updateInfo('Done.');
        }catch(err){
            console.error('[HLS Saver]', err);
            if(err?.message !== 'Cancelled'){
                alert('HLS download failed:\n\n' + (err?.message || err));
                updateInfo('Failed: ' + (err?.message || err));
            }else{
                updateInfo('Cancelled.');
            }
            updateButton('Download');
        }
        setBusy(false);
    }, true);
}

NS.watchForButton = function(){
    const find = () => {
        if(NS.downloadButton && document.contains(NS.downloadButton)) return;
        const b = findButton();
        if(b) attachButton(b);
    };
    find();
    new MutationObserver(find).observe(document.documentElement, {childList: true, subtree: true});
};
})();

// ---- core/entry.js ----
(function(){
const NS = window.__hlsSaver;

function start(){
    NS.installNetworkHooks();
    NS.installHlsConstructorHook();
    if(NS.isTopFrame){
        NS.watchForButton();
    }
    NS.log(`Apars HLS Saver v${NS.version} active (frame: ${NS.isTopFrame ? 'top' : 'iframe:' + location.hostname})`);
}

if(document.documentElement) start();
else document.addEventListener('DOMContentLoaded', start, {once: true});
})();

