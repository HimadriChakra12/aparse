(function(){
const NS = window.__hlsSaver;

// Confirmed via Network tab Initiator column: requests are "hls.min.js:1
// (xhr)" — this IS hls.js. (Earlier guess that the console's quality-match
// object meant Shaka was wrong: hls.js's own Level class also carries
// _urlId, fragmentError, supportedPromise, etc. in newer versions.)
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

// Fallback scan in case the constructor hook installed after hls.js already
// created its instance (same timing risk as the network hooks).
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

// Forces the player onto the 720p rendition via hls.js's public API.
// Returns true if a level switch was actually issued.
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

// Backup strategy needing no player internals at all: this CDN's variant
// URLs follow a fixed pattern confirmed directly from your Network tab —
//   https://vz-2d726a87-cba.b-cdn.net/<id>/720p/video.m3u8
// Given any playlist URL already captured (master or another resolution),
// derive the 720p URL by substitution.
NS.deriveVariantUrlFromPattern = function(knownUrl, height){
    try{
        const m = knownUrl.match(/^(.*\/)(\d+)p\/video\.m3u8/);
        if(m) return `${m[1]}${height}p/video.m3u8`;
        const m2 = knownUrl.match(/^(.*\/)playlist\.m3u8/);
        if(m2) return `${m2[1]}${height}p/video.m3u8`;
    }catch{}
    return null;
};
})();
