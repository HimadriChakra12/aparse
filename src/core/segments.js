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
