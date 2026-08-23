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

// Given a master/known playlist, resolves {url, text} for the 720p variant.
// Order of attack, cheapest/most-reliable first:
//   1. Already captured passively — use it immediately.
//   2. Derive the URL directly from the known CDN pattern
//      ({base}/{id}/{height}p/video.m3u8, confirmed from console output)
//      and fetch it directly. credentials:'omit' is used because this CDN's
//      CORS response (Access-Control-Allow-Origin: *) does NOT include
//      Access-Control-Allow-Credentials, so a credentialed cross-origin
//      request gets silently rejected by the browser even though the
//      network call itself returns 200 — this was the root cause of the
//      original "No HLS playlist detected" bug.
//   3. Force Shaka Player to switch tracks (this site uses shaka.Player,
//      not hls.js) so the player's own request gets captured passively.
//   4. Fall back to passively waiting in case no player instance was found.
NS.resolve720pPlaylist = async function(masterUrl, masterText){
    if(!masterText.includes('#EXT-X-STREAM-INF')) return {url: masterUrl, text: masterText};

    const variant = NS.find720pVariant(masterUrl, masterText);
    if(!variant) throw Error('No 720p variant found in master playlist.');

    if(NS.playlists.has(variant)) return {url: variant, text: NS.playlists.get(variant)};

    // Strategy 2: direct fetch via known URL pattern.
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

    // Strategy 3/4: force hls.js, or passively wait for it to request it.
    const forced = NS.force720p();
    NS.log(forced ? 'Requested 720p level switch via hls.js' : 'No hls.js instance found, falling back to passive wait');

    const text = await waitForPlaylist(variant).catch(() => null);
    if(text) return {url: variant, text};

    throw Error('720p variant playlist was not captured. Try seeking/scrubbing the video once, then click Download again.');
};
})();
