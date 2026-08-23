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

// Tracks the in-flight download so the UI can offer a Cancel action.
// Only one download runs at a time (enforced by the button's busy flag).
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

        NS.log(`Downloading ${files.length} segments`);
        const chunks = await NS.fetchAllSegments(files, (done, total, note) => {
            if(note) updateStatus(`${note} (${Math.round(done / total * 100)}%)`);
            else updateStatus(`Downloading ${Math.round(done / total * 100)}%`);
        }, controller.signal);

        let blob;
        try{
            blob = await NS.remuxToMp4(chunks, msg => updateStatus(msg), controller.signal);
        }catch(e){
            NS.log('ffmpeg.wasm remux failed, falling back to raw concat:', e);
            updateStatus('Remux failed, using raw concat...');
            blob = NS.rawConcatBlob(chunks);
        }

        updateStatus('Preparing...');
        triggerDownload(blob, 'video_720p.mp4');
    }finally{
        NS.currentDownloadController = null;
    }
};
})();
