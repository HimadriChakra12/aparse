(function(){
const NS = window.__hlsSaver;

// We capture playlist text straight from the SAME request HLS.js already
// made and that already succeeded, instead of issuing a second cross-origin
// fetch. That avoids the credentials/CORS mismatch that broke v6
// (CDN sends Access-Control-Allow-Origin: * with no credentials header;
// `credentials:'include'` on a cross-origin request rejects that response).
function extractText(xhr){
    const type = xhr.responseType;
    if(type === '' || type === 'text'){
        return xhr.responseText;
    }
    if(type === 'arraybuffer' && xhr.response){
        try{ return new TextDecoder('utf-8').decode(xhr.response); }catch{ return null; }
    }
    if(type === 'blob' && xhr.response){
        // Blob requires an async read; handled by caller via a promise path.
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

// Independent fallback: scans PerformanceResourceTiming entries for m3u8
// URLs and direct-fetches anything not already captured. Catches cases
// where our XHR/fetch monkeypatch installed after hls.js already grabbed
// its own reference to the originals (can happen even at document-start
// depending on extension sandboxing/injection order). credentials:'omit'
// because this CDN's CORS response has no Access-Control-Allow-Credentials,
// so a credentialed cross-origin request is rejected even though the
// underlying network call succeeds.
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
