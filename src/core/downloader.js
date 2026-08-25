(function(){
const NS = window.__hlsSaver;

const BATCH_SIZE = 50;

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

NS.runDownload = async function(masterOrMediaUrl, masterOrMediaText, updateStatus){
    const controller = new AbortController();
    NS.currentDownloadController = controller;
    NS.pauseAllPlayback();
    NS.broadcastToFrames('pause-playback');
    try{
        const playlist = await NS.resolve720pPlaylist(masterOrMediaUrl, masterOrMediaText);
        const files = NS.parseMediaPlaylist(playlist.url, playlist.text);
        if(!files.length) throw Error('No media segments found.');

        updateStatus('Loading ffmpeg.wasm...');
        const ffmpeg = await NS.getFFmpeg();

        NS.log(`Downloading ${files.length} segments`);
        const names = await fetchAndBatch(ffmpeg, files, updateStatus, controller.signal);

        let blob;
        let extension = 'mp4';
        try{
            blob = await NS.finishRemux(ffmpeg, names, pct => {
                updateStatus(`Remuxing ${Math.round(pct * 100)}%`);
            }, controller.signal);
        }catch(e){
            NS.log('ffmpeg.wasm remux failed, falling back to raw concat:', e);
            updateStatus('Remux failed, using raw concat...');
            blob = await NS.rawConcatFromFFmpeg(ffmpeg, names);
            extension = 'ts';
        }

        updateStatus('Preparing...');
        const baseName = (NS.getVideoTitle ? NS.getVideoTitle() : null) || 'video_720p';
        triggerDownload(blob, `${baseName}.${extension}`);
    }finally{
        NS.currentDownloadController = null;
        NS.terminateFFmpeg();
        NS.resumeAllPlayback();
        NS.broadcastToFrames('resume-playback');
    }
};
})();
