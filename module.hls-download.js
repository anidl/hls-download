// build-in
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

// modules
const shlp = require('sei-helper');
const got = require('got').extend({
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:65.0) Gecko/20100101 Firefox/65.0' },
});
const ProxyAgent = require('proxy-agent');

// get url
async function getData(uri, headers, proxy, retry) {
    // get file if uri is local
    if (uri.startsWith('file://')) {
        return {
            body: fs.readFileSync(url.fileURLToPath(p)),
        };
    }
    // base options
    headers = headers ? headers : {};
    let options = { headers, retry, encoding: null };
    // proxy
    if (proxy) {
        let host = proxy.host && proxy.host.match(':') ? proxy.host.split(':')[0] : ( proxy.host ? proxy.host : proxy.ip );
        let port = proxy.host && proxy.host.match(':') ? proxy.host.split(':')[1] : ( proxy.port ? proxy.port : null);
        let user = proxy.user || proxy['socks-login'];
        let pass = proxy.pass || proxy['socks-pass'];
        let auth = user && pass ? [user, pass].join(':') : null;
        if(host && port){
            options.agent = new ProxyAgent(url.format({
                protocol: proxy.type,
                slashes: true,
                auth: auth,
                hostname: host,
                port: port,
            }));
        }
        else if(proxy.url){
            options.agent = new ProxyAgent(proxy.url);
        }
        options.timeout = 10000;
    }
    // do request
    return got(uri, options);
}

function getURI(baseurl, uri) {
    const httpURI = /^https{0,1}:/.test(uri);
    if (!baseurl && !httpURI) {
        throw new Error('No base and not http(s) uri');
    }
    else if (httpURI) {
        return uri;
    }
    return baseurl + uri;
}

async function dlparts(m3u8json, fn, baseurl, headers, proxy, pcount, rcount, forceRw, typeStream) {
    let keys = {};
    // ask before rewrite file
    if (fs.existsSync(`${fn}.ts`) && !typeStream) {
        let rwts = ( forceRw ? 'y' : false ) || await shlp.question(`[Q] File «${fn}.ts» already exists! Rewrite? (y/N)`);
        rwts = rwts || 'N';
        if (!['Y', 'y'].includes(rwts[0])) {
            return;
        }
        console.log(`[INFO] Deleting «${fn}.ts»...`);
        fs.unlinkSync(`${fn}.ts`);
    }
    // show target filename
    console.log(`[INFO] Saving stream to «${fn}.ts»...`);
    let dateStart = Date.now();
    // dl parts
    if (m3u8json.segments && m3u8json.segments.length > 0 && m3u8json.segments[0].map) {
        console.log(`[INFO] Download and save init part...`);
        const initIndex = 0;
        const initSeg = { segments: [{ ...m3u8json.segments[initIndex].map }] };
        if(m3u8json.segments[initIndex].key){
            initSeg.segments[initIndex].key = m3u8json.segments[initIndex].key;
        }
        const initDl = await dlpart(initSeg, initIndex, baseurl, keys, headers, proxy, rcount);
        fs.writeFileSync(`${fn}.ts`, initDl.dec, { flag: 'a' });
        console.log(`[INFO] Init part downloaded.`);
    }
    for (let p = 0; p < m3u8json.segments.length / pcount; p++) {
        let offset = p * pcount;
        let prq = new Map();
        for (let px = offset; px < offset + pcount && px < m3u8json.segments.length; px++) {
            prq.set(px, dlpart(m3u8json, px, baseurl, keys, headers, proxy, rcount));
        }
        let res = [];
        let errcnt = 0;
        for (let i = prq.size; i--;) {
            try {
                let r = await Promise.race(prq.values());
                prq.delete(r.p);
                res[r.p - offset] = r.dec;
            }
            catch (error) {
                console.log(`[ERROR] Part ${error.p+1} download error:\n\t${error.message}`);
                errcnt++
            }
        }
        // catch error
        if (errcnt > 0) {
            throw new Error(`${errcnt} parts not downloaded`);
        }
        // log downloaded
        let dled = offset + pcount;
        dled = dled < m3u8json.segments.length ? dled : m3u8json.segments.length;
        getDLedInfo(dateStart, dled, m3u8json.segments.length);
        // write downloaded
        for (let r of res) {
            fs.writeFileSync(`${fn}.ts`, r, { flag: 'a' });
        }
    }
}

function getDLedInfo(dateStart, dled, total) {
    const dateElapsed = Date.now() - dateStart;
    const percentFxd = (dled / total * 100).toFixed();
    const percent = percentFxd < 100 ? percentFxd : (total == dled ? 100 : 99);
    const time = shlp.formatTime(((parseInt(dateElapsed * (total / dled - 1))) / 1000).toFixed());
    console.log(`[INFO] ${dled} parts of ${total} downloaded [${percent}%] (${time})`);
}

async function getDecipher(pd, keys, p, baseurl, headers, proxy, rcount) {
    const kURI = getURI(baseurl, pd.key.uri);
    if (!keys[kURI]) {
        const rkey = await getData(kURI, headers, proxy, rcount);
        if (!rkey || !rkey.body) {
            throw new Error('Key get error');
        }
        keys[kURI] = rkey.body;
    }
    // get ivs
    let iv = Buffer.alloc(16);
    let ivs = pd.key.iv ? pd.key.iv : [0, 0, 0, p + 1];
    for (i in ivs) {
        iv.writeUInt32BE(ivs[i], i * 4);
    }
    return crypto.createDecipheriv('aes-128-cbc', keys[kURI], iv);
}

async function dlpart(m3u8json, p, baseurl, keys, headers, proxy, rcount) {
    let pd = m3u8json.segments[p];
    let decipher, part, dec;
    try {
        if (pd.key != undefined) {
            decipher = await getDecipher(pd, keys, p, baseurl, headers, proxy, rcount);
        }
        part = await getData(getURI(baseurl, pd.uri), headers, proxy, rcount);
        if (decipher == undefined) {
            return { dec: part.body, p };
        }
        dec = decipher.update(part.body);
        dec = Buffer.concat([dec, decipher.final()]);
    }
    catch (error) {
        error.p = p;
        throw error;
    }
    return { dec, p };
}

module.exports = async (options) => {
    // set options
    options.pcount = options.pcount || 5;
    options.rcount = options.rcount || 5;
    const { fn, m3u8json, baseurl, headers, proxy, pcount, rcount, forceRw, typeStream } = options;
    // set status
    let res = { "ok": true };
    // start
    try {
        if(!m3u8json || !m3u8json.segments || m3u8json.segments.length === 0){
            throw new Error('Playlist is empty');
        }
        console.log('[INFO] Starting downloading ts...');
        await dlparts(m3u8json, fn, baseurl, headers, proxy, pcount, rcount, forceRw, typeStream);
    }
    catch (error) {
        res = { "ok": false, error };
    }
    // return status
    return res;
};
