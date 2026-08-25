(function(){
const NS = window.__hlsSaver;

NS.isTopFrame = (window.top === window);

if(!NS.isTopFrame){
    const origAddPlaylist = NS.addPlaylist;
    NS.addPlaylist = function(url, text){
        origAddPlaylist(url, text);
        try{
            window.top.postMessage({__hlsSaver: true, type: 'playlist', url, text}, '*');
        }catch(e){ NS.log('postMessage to top failed:', e); }
    };
}

window.addEventListener('message', e => {
    const d = e.data;
    if(!d || d.__hlsSaver !== true) return;
    if(d.type === 'playlist' && NS.isTopFrame){
        NS.log('Playlist received from iframe:', d.url);
        NS.addPlaylist(d.url, d.text);
    }else if(d.type === 'pause-playback'){
        NS.pauseAllPlayback();
    }else if(d.type === 'resume-playback'){
        NS.resumeAllPlayback();
    }
});

NS.broadcastToFrames = function(type){
    document.querySelectorAll('iframe').forEach(f => {
        try{ f.contentWindow.postMessage({__hlsSaver: true, type}, '*'); }catch(e){}
    });
};
})();
