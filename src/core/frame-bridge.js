(function(){
const NS = window.__hlsSaver;

// The player renders inside a cross-origin <iframe> (iframe.mediadelivery.net),
// which has its own separate window/document. A userscript matched only to
// aparsclassroom.com never sees hls.js's requests there — this is almost
// certainly why capture came back completely empty despite the Network tab
// showing successful requests. We now inject into BOTH the top page and the
// iframe (see @match in tools/build.js); each frame captures independently,
// and the iframe forwards anything it captures up to the top frame, since
// cross-origin frames can't share JS objects directly.
NS.isTopFrame = (window.top === window);

if(!NS.isTopFrame){
    const origAddPlaylist = NS.addPlaylist;
    NS.addPlaylist = function(url, text){
        origAddPlaylist(url, text);
        try{
            window.top.postMessage({__hlsSaver: true, type: 'playlist', url, text}, '*');
        }catch(e){ NS.log('postMessage to top failed:', e); }
    };
}else{
    window.addEventListener('message', e => {
        const d = e.data;
        if(d && d.__hlsSaver === true && d.type === 'playlist'){
            NS.log('Playlist received from iframe:', d.url);
            NS.addPlaylist(d.url, d.text);
        }
    });
}
})();
