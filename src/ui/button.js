(function(){
const NS = window.__hlsSaver;

function sanitizeFilename(title){
    title = (title || '').split('|')[0].split(' — ')[0].trim();
    title = title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
    return title;
}

function extractHeadingTitle(){
    const el = document.querySelector('div.rounded-2xl h1.font-extrabold')
            || document.querySelector('h1.font-extrabold');
    return el ? el.textContent : null;
}

NS.getVideoTitle = function(){
    const heading = sanitizeFilename(extractHeadingTitle());
    if(heading) return heading;

    const fromTitle = sanitizeFilename(document.title);
    if(fromTitle) return fromTitle;

    return 'video_720p';
};

function findButton(){
    const icon = document.querySelector('svg.lucide-download');
    if(!icon) return null;
    const b = icon.closest('.flex-1');
    if(!b || !/download/i.test(b.textContent)) return null;
    return b;
}

function getInfoLine(){
    if(NS.infoLine && document.contains(NS.infoLine)) return NS.infoLine;
    const card = document.querySelector('div.rounded-2xl');
    if(!card) return null;
    const line = document.createElement('div');
    line.className = 'text-sm text-gray-500 dark:text-gray-400 mt-2';
    line.dataset.hlsSaverInfo = '1';
    card.appendChild(line);
    NS.infoLine = line;
    return line;
}

function updateInfo(text){
    const line = getInfoLine();
    if(line) line.textContent = text ? `[HLS Saver] ${text}` : '';
}

function updateButton(text){
    if(!NS.downloadButton) return;
    const spans = NS.downloadButton.querySelectorAll('span');
    for(const s of spans){
        const v = s.textContent.trim().toLowerCase();
        if(v === 'download' || /^(finding|downloading|preparing|writing|remuxing|loading|remux|retrying|cancelling)/.test(v)){
            s.textContent = text;
            return;
        }
    }
}

function setBusy(v){
    NS.busy = v;
    if(!NS.downloadButton) return;
    NS.downloadButton.style.opacity = v ? '0.6' : '';
    NS.downloadButton.style.pointerEvents = v ? 'none' : '';
}

function attachButton(b){
    if(!b || b.dataset.hlsSaverAttached) return;
    NS.downloadButton = b;
    b.dataset.hlsSaverAttached = '1';
    b.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if(NS.busy){
            NS.cancelDownload();
            updateButton('Cancelling...');
            return;
        }

        const selected = NS.getMasterPlaylist() || NS.getMediaPlaylist();
        if(!selected){
            updateButton('Download');
            alert('No HLS playlist detected.\n\nPlay the video for a few seconds, then click Download again.');
            return;
        }

        setBusy(true);
        updateButton('Preparing...');
        updateInfo('Preparing...');
        try{
            await NS.runDownload(selected.url, selected.text, text => {
                updateButton(text);
                updateInfo(text);
            });
            updateButton('Download');
            updateInfo('Done.');
        }catch(err){
            console.error('[HLS Saver]', err);
            if(err?.message !== 'Cancelled'){
                alert('HLS download failed:\n\n' + (err?.message || err));
                updateInfo('Failed: ' + (err?.message || err));
            }else{
                updateInfo('Cancelled.');
            }
            updateButton('Download');
        }
        setBusy(false);
    }, true);
}

NS.watchForButton = function(){
    const find = () => {
        if(NS.downloadButton && document.contains(NS.downloadButton)) return;
        const b = findButton();
        if(b) attachButton(b);
    };
    find();
    new MutationObserver(find).observe(document.documentElement, {childList: true, subtree: true});
};
})();
