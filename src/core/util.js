(function(){
const NS = window.__hlsSaver;

// Matches .m3u8 URLs. HLS segment URLs may be named .ts, .dts, or anything
// else the site chooses to obfuscate with — extension is never trusted
// for segments, only for playlists.
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

// Returns the index of the 720p entry within an hls.js `levels` array,
// used by hls-instance.js to force `hls.loadLevel`/`hls.currentLevel`.
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
