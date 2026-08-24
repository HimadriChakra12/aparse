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
