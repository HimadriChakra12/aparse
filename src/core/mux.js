(function(){
const NS = window.__hlsSaver;

const MUXJS_URL = 'https://unpkg.com/mux.js@7.0.3/dist/mux.min.js';

let muxjsLoadPromise = null;

function loadScript(src){
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(Error('Failed to load script: ' + src));
        document.head.appendChild(s);
    });
}

function loadMuxjs(){
    if(muxjsLoadPromise) return muxjsLoadPromise;
    muxjsLoadPromise = (async () => {
        if(!NS.pageWindow.muxjs){
            await loadScript(MUXJS_URL);
        }
        return NS.pageWindow.muxjs;
    })();
    return muxjsLoadPromise;
}

NS.remuxToMp4 = async function(chunks, onProgress, signal){
    if(onProgress) onProgress('Loading mux.js...');
    const muxjs = await loadMuxjs();

    if(onProgress) onProgress('Remuxing to MP4...');
    const transmuxer = new muxjs.mp4.Transmuxer();

    let initSegment = null;
    const mediaSegments = [];

    await new Promise((resolve, reject) => {
        transmuxer.on('data', segment => {
            if(!initSegment && segment.initSegment) initSegment = segment.initSegment;
            mediaSegments.push(segment.data);
        });
        transmuxer.on('done', resolve);

        try{
            for(let i = 0; i < chunks.length; i++){
                if(signal?.aborted) throw Error('Cancelled');
                transmuxer.push(new Uint8Array(chunks[i]));
                if(onProgress) onProgress(`Remuxing ${i + 1}/${chunks.length} (${Math.round((i + 1) / chunks.length * 100)}%)`);
            }
            transmuxer.flush();
        }catch(e){ reject(e); }
    });

    if(!initSegment || mediaSegments.length === 0) throw Error('mux.js produced no output.');

    return new Blob([initSegment, ...mediaSegments], {type: 'video/mp4'});
};

NS.rawConcatBlob = function(chunks){
    return new Blob(chunks, {type: 'video/mp2t'});
};
})();
