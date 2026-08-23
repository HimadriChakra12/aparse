(function(){
const NS = window.__hlsSaver;

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
const FFMPEG_LIB_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';

let ffmpegLoadPromise = null;

function loadScript(src){
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(Error('Failed to load script: ' + src));
        document.head.appendChild(s);
    });
}

async function getFFmpeg(){
    if(ffmpegLoadPromise) return ffmpegLoadPromise;
    ffmpegLoadPromise = (async () => {
        if(!window.FFmpegWASM){
            await loadScript(FFMPEG_LIB_URL);
        }
        const {FFmpeg} = window.FFmpegWASM;
        const ffmpeg = new FFmpeg();
        await ffmpeg.load({coreURL: FFMPEG_CORE_URL});
        return ffmpeg;
    })();
    return ffmpegLoadPromise;
}

// Proper remux: writes each segment into ffmpeg.wasm's virtual FS, builds a
// concat list, and copies streams into a real MP4 container (no re-encode,
// `-c copy`) — fixes seek bar/duration metadata that raw Blob concat leaves
// broken.
NS.remuxToMp4 = async function(chunks, onProgress, signal){
    if(onProgress) onProgress('Loading ffmpeg.wasm...');
    const ffmpeg = await getFFmpeg();

    const names = [];
    for(let i = 0; i < chunks.length; i++){
        if(signal?.aborted) throw Error('Cancelled');
        const name = `seg${String(i).padStart(5, '0')}.ts`;
        await ffmpeg.writeFile(name, new Uint8Array(chunks[i]));
        names.push(name);
        if(onProgress) onProgress(`Writing ${i + 1}/${chunks.length} (${Math.round((i + 1) / chunks.length * 100)}%)`);
    }

    const concatList = names.map(n => `file '${n}'`).join('\n');
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

    if(signal?.aborted) throw Error('Cancelled');
    if(onProgress) onProgress('Remuxing to MP4...');
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4']);

    const data = await ffmpeg.readFile('output.mp4');
    return new Blob([data.buffer], {type: 'video/mp4'});
};

// Fallback used if ffmpeg.wasm fails to load — same behavior as before,
// a raw concatenated Blob. Playable in most players but with broken
// seeking/duration since it isn't a real MP4 container.
NS.rawConcatBlob = function(chunks){
    return new Blob(chunks, {type: 'video/mp4'});
};
})();
