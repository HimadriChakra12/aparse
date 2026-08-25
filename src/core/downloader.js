(function(){
const NS = window.__hlsSaver;

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

NS.runDownload = async function(masterOrMediaUrl, masterOrMediaText, updateStatus){
    const controller = new AbortController();
    NS.currentDownloadController = controller;
    try{
        const playlist = await NS.resolve720pPlaylist(masterOrMediaUrl, masterOrMediaText);
        const files = NS.parseMediaPlaylist(playlist.url, playlist.text);
        if(!files.length) throw Error('No media segments found.');

        updateStatus('Loading ffmpeg.wasm...');
        const ffmpeg = await NS.getFFmpeg();

        NS.log(`Downloading ${files.length} segments`);
        const names = new Array(files.length);
        await NS.fetchAllSegments(files, async (i, buffer) => {
            names[i] = await NS.writeSegment(ffmpeg, i, buffer);
        }, (done, total, note) => {
            if(note) updateStatus(`${note} (${Math.round(done / total * 100)}%)`);
            else updateStatus(`Downloading ${Math.round(done / total * 100)}%`);
        }, controller.signal);

        let blob;
        let extension = 'mp4';
        updateStatus('Remuxing to MP4...');
        try{
            blob = await NS.finishRemux(ffmpeg, names, controller.signal);
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
    }
};
})();
