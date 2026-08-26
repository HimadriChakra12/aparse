(function(){
const NS = window.__hlsSaver;

const BATCH_SIZE = 50;
const PART_SIZE = 750;

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

async function runPart(partFiles, partLabel, updateStatus, signal, outputName){
    updateStatus(`${partLabel}: loading ffmpeg.wasm...`);
    const ffmpeg = await NS.getFFmpeg();
    try{
        NS.log(`${partLabel}: downloading ${partFiles.length} segments`);
        const names = await fetchAndBatch(ffmpeg, partFiles, (text) => updateStatus(`${partLabel}: ${text}`), signal);

        try{
            const blob = await NS.finishRemux(ffmpeg, names, pct => {
                updateStatus(`${partLabel}: remuxing ${Math.round(pct * 100)}%`);
            }, signal, outputName);
            return {blob, extension: outputName.endsWith('.mp4') ? 'mp4' : 'ts'};
        }catch(e){
            NS.log(`${partLabel}: remux failed, falling back to raw concat:`, e);
            updateStatus(`${partLabel}: remux failed, using raw concat...`);
            return {blob: await NS.rawConcatFromFFmpeg(ffmpeg, names), extension: 'ts'};
        }
    }finally{
        NS.terminateFFmpeg();
    }
}

async function foldMerge(runningBlob, nextBlob, outputName, updateStatus, signal){
    updateStatus('Merging: loading ffmpeg.wasm...');
    const ffmpeg = await NS.getFFmpeg();
    try{
        updateStatus('Merging: writing running output...');
        const runningBuf = await runningBlob.arrayBuffer();
        await ffmpeg.writeFile('running.ts', new Uint8Array(runningBuf));

        updateStatus('Merging: writing next part...');
        const nextBuf = await nextBlob.arrayBuffer();
        await ffmpeg.writeFile('next.ts', new Uint8Array(nextBuf));

        const names = ['running.ts', 'next.ts'];
        try{
            const blob = await NS.finishRemux(ffmpeg, names, pct => {
                updateStatus(`Merging: ${Math.round(pct * 100)}%`);
            }, signal, outputName);
            return {blob, extension: outputName.endsWith('.mp4') ? 'mp4' : 'ts'};
        }catch(e){
            NS.log('Merge failed, falling back to raw concat:', e);
            updateStatus('Merge failed, using raw concat...');
            return {blob: await NS.rawConcatFromFFmpeg(ffmpeg, names), extension: 'ts'};
        }
    }finally{
        NS.terminateFFmpeg();
    }
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

        const baseName = (NS.getVideoTitle ? NS.getVideoTitle() : null) || 'video_720p';
        const partCount = Math.ceil(files.length / PART_SIZE);
        NS.log(`Downloading ${files.length} segments in ${partCount} part(s) of up to ${PART_SIZE} segments each`);

        let blob, extension;
        if(partCount === 1){
            const partFiles = files.slice(0, PART_SIZE);
            const result = await runPart(partFiles, 'Download', updateStatus, controller.signal, 'output.mp4');
            blob = result.blob;
            extension = result.extension;
        }else{
            let runningBlob = null;
            for(let p = 0; p < partCount; p++){
                if(controller.signal.aborted) throw Error('Cancelled');
                const partFiles = files.slice(p * PART_SIZE, (p + 1) * PART_SIZE);
                const partLabel = `Part ${p + 1}/${partCount}`;
                const result = await runPart(partFiles, partLabel, updateStatus, controller.signal, 'part.ts');

                if(runningBlob === null){
                    runningBlob = result.blob;
                }else{
                    const isLast = (p === partCount - 1);
                    const outputName = isLast ? 'output.mp4' : 'merged.ts';
                    const merged = await foldMerge(runningBlob, result.blob, outputName, updateStatus, controller.signal);
                    runningBlob = merged.blob;
                    extension = merged.extension;
                }
            }
            blob = runningBlob;
        }

        updateStatus('Preparing...');
        triggerDownload(blob, `${baseName}.${extension}`);
        updateStatus('Done.');
    }finally{
        NS.currentDownloadController = null;
        NS.terminateFFmpeg();
        NS.resumeAllPlayback();
        NS.broadcastToFrames('resume-playback');
    }
};
})();
