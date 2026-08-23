(function(){
const NS = window.__hlsSaver;

function start(){
    NS.installNetworkHooks();
    NS.installHlsConstructorHook();
    if(NS.isTopFrame){
        NS.watchForButton();
    }
    NS.log(`Apars HLS Saver v${NS.version} active (frame: ${NS.isTopFrame ? 'top' : 'iframe:' + location.hostname})`);
}

if(document.documentElement) start();
else document.addEventListener('DOMContentLoaded', start, {once: true});
})();
