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

NS.finishRemux = async function(ffmpeg, names, signal){
    if(signal?.aborted) throw Error('Cancelled');
    const concatList = names.map(n => `file '${n}'`).join('\n');
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

    if(signal?.aborted) throw Error('Cancelled');
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
