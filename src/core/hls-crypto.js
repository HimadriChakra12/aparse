(function(){
const NS = window.__hlsSaver;

const keyCache = new Map(); // key URI -> Promise<CryptoKey>

function ivFromSequence(seq){
    const iv = new Uint8Array(16);
    let n = seq;
    for(let i = 15; i >= 0 && n > 0; i--){
        iv[i] = n & 0xff;
        n = Math.floor(n / 256);
    }
    return iv;
}

function getSubtle(){
    return (NS.pageWindow.crypto || crypto).subtle;
}

function getKey(keyUri){
    if(!keyCache.has(keyUri)){
        keyCache.set(keyUri, (async () => {
            const r = await NS.pageWindow.fetch(keyUri, {cache: 'no-store', credentials: 'omit'});
            if(!r.ok) throw Error(`Key fetch failed: ${r.status} ${keyUri}`);
            const bytes = await r.arrayBuffer();
            return getSubtle().importKey('raw', bytes, {name: 'AES-CBC'}, false, ['decrypt']);
        })());
    }
    return keyCache.get(keyUri);
}

NS.parseKeyLine = function(line, playlistUrl){
    const methodMatch = line.match(/METHOD=([^,]+)/i);
    const method = methodMatch ? methodMatch[1].trim() : 'NONE';
    if(method === 'NONE') return null;

    const uriMatch = line.match(/URI="([^"]+)"/i);
    if(!uriMatch) return null;
    const uri = new URL(uriMatch[1], playlistUrl).href;

    let ivBytes = null;
    const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);
    if(ivMatch){
        const hex = ivMatch[1].padStart(32, '0');
        ivBytes = new Uint8Array(16);
        for(let i = 0; i < 16; i++) ivBytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }

    return {method, uri, ivBytes};
};

NS.decryptSegmentIfNeeded = async function(buffer, keyInfo, seq){
    if(!keyInfo) return buffer;
    if(keyInfo.method !== 'AES-128'){
        NS.log('Unsupported HLS encryption method, passing through undecrypted:', keyInfo.method);
        return buffer;
    }
    const cryptoKey = await getKey(keyInfo.uri);
    const iv = keyInfo.ivBytes || ivFromSequence(seq);
    return getSubtle().decrypt({name: 'AES-CBC', iv}, cryptoKey, buffer);
};
})();
