(function(){
const NS = window.__hlsSaver;

// Segment URLs are fetched exactly as given -- the `.dts` naming this site
// uses is just an obfuscated extension, it has no bearing on how we fetch
// or read the bytes. Each entry is a descriptor {url, key, seq} rather than
// a bare URL, so encryption context (see hls-crypto.js) travels with it:
// AES-128 key info comes from #EXT-X-KEY, and the IV falls back to the
// segment's own media sequence number when not given explicitly.
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

// Segments were never passively captured (only playlists are, via the
// network hooks), so this is the one place we still issue our own fetch.
// credentials:'omit' matches what worked for playlists once cross-origin
// credentialed requests were removed -- same CDN, same-origin rules apply.
// Decryption (if the segment carries key info) happens right after fetch,
// before the bytes go anywhere else.
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

// signal: an AbortSignal (from NS.currentDownloadController) so a running
// download can be cancelled mid-loop instead of running to completion.
NS.fetchAllSegments = async function(files, onProgress, signal){
    const chunks = [];
    for(let i = 0; i < files.length; i++){
        if(signal?.aborted) throw Error('Cancelled');
        chunks.push(await fetchSegmentWithRetry(files[i], i, files.length, signal, onProgress));
        if(onProgress) onProgress(i + 1, files.length);
    }
    return chunks;
};
})();
