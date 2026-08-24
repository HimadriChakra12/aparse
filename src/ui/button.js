(function(){
const NS = window.__hlsSaver;

function sanitizeFilename(title){
    title = (title || '').split('|')[0].split(' — ')[0].trim();
    title = title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
    return title;
}

// Confirmed markup: the lecture title lives in a dedicated info card,
//   <div class="mb-6 rounded-2xl border ... bg-white dark:bg-gray-900/50 p-5 ...">
//     <h1 class="text-lg sm:text-xl md:text-2xl lg:text-3xl font-extrabold ...">
//       Dynamics (গতিবিদ্যা) - 01
//     </h1>
//     <div class="flex items-center gap-2 mt-2">...by Apurbo Opu...</div>
//   </div>
// Scope the lookup to that card (`div.rounded-2xl h1.font-extrabold`) so
// we grab the actual lecture-title heading and not some other h1 that
// happens to share a class elsewhere on the page. Falls back to the
// looser `h1.font-extrabold` (any matching heading) in case the wrapper's
// classes change, since font-extrabold + the responsive text-size classes
// still narrow it down reliably on this site.
function extractHeadingTitle(){
    const el = document.querySelector('div.rounded-2xl h1.font-extrabold')
            || document.querySelector('h1.font-extrabold');
    return el ? el.textContent : null;
}

// Pulls the lecture name so downloads are distinguishable instead of all
// landing under the same generic filename. Tries the actual on-page
// heading first (most accurate -- the specific lecture, not the course);
// falls back to document.title (Next.js apps often set this, but on this
// site it turns out to be the course/programme name, not the lecture).
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
            // Clicking the button again while a download is running cancels it,
            // instead of silently ignoring the click.
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
        try{
            await NS.runDownload(selected.url, selected.text, updateButton);
            updateButton('Download');
        }catch(err){
            console.error('[HLS Saver]', err);
            if(err?.message !== 'Cancelled'){
                alert('HLS download failed:\n\n' + (err?.message || err));
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
