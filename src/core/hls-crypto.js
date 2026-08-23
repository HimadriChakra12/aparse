(function(){
const NS = window.__hlsSaver;

// HLS AES-128 encryption: segments are AES-CBC encrypted, keyed by a
// #EXT-X-KEY:METHOD=AES-128,URI="...",IV=0x... line in the media playlist.
// If IV is omitted, the spec says to use the segment's media sequence
// number as a 16-byte big-endian integer instead.
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
    // Use the page's own crypto.subtle for consistency with the rest of
    // the pageWindow-routing fix -- avoids any repeat of the Xray-isolation
    // issue that broke XHR/fetch capture earlier.
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

// Parses a #EXT-X-KEY: line into {method, uri, ivBytes|null}, or null for
// METHOD=NONE (explicitly unencrypted) / a line we don't understand.
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

// Decrypts a segment's ArrayBuffer if keyInfo indicates AES-128; returns
// the buffer unchanged (or throws for an unsupported method) otherwise.
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
