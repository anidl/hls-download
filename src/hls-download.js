// build-in
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

// extra
const shlp = require('sei-helper');
const got = require('got').extend({
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:70.0) Gecko/20100101 Firefox/70.0' },
});

// hls class
class hlsDownload {
    constructor(options){
        // check playlist
        if(
            !options
            || !options.m3u8json 
            || !options.m3u8json.segments 
            || options.m3u8json.segments.length === 0
        ){
            throw new Error('Playlist is empty!');
        }
        // init options
        this.data = {};
        this.data.parts = {
            first: options.m3u8json.mediaSequence || 0,
            total: options.m3u8json.segments.length,
            completed: 0,
        };
        // global params
        this.data.m3u8json    = options.m3u8json;
        this.data.outputFile  = options.output || options.filename || options.fn || 'stream.ts';
        this.data.threads     = options.threads || options.tcount || options.pcount || 5;
        this.data.retries     = options.retries || options.rcount || 4;
        this.data.offset      = options.offset || options.partsOffset || 0;
        this.data.baseurl     = options.baseurl || false;
        this.data.proxy       = options.proxy || false;
        this.data.skipInit    = options.skipInit || false;
        this.data.keys        = {};
        // extra globals
        this.data.checkPartLength = true;
        this.data.isResume = this.data.offset > 0 ? true : ( options.typeStream || options.isResume );
        this.data.headers = options.headers;
    }
    async download(){
        // set output
        const fn = this.data.outputFile;
        // try load resume file
        if(fs.existsSync(fn) && fs.existsSync(`${fn}.resume`) && this.data.offset < 1){
            try{
                console.log('[INFO] Resume data found! Trying to resume...');
                const resumeData = JSON.parse(fs.readFileSync(`${fn}.resume`, 'utf-8'));
                if(
                    resumeData.total == this.data.m3u8json.segments.length
                    && resumeData.completed != resumeData.total
                    && !isNaN(resumeData.completed)
                ){
                    this.data.offset = resumeData.completed;
                    this.data.isResume = true;
                }
            }
            catch(e){
                console.log('[ERROR] Resume failed, downloading will be not resumed!');
                console.log(e);
            }
        }
        // stream
        /*
        if(m3u8cfg.mediaSequence > 0){
            isStream = true;
        }
        if(m3u8cfg.mediaSequence > 0){
            // stream status
            dledSeg  = nextSeg > 0 ? nextSeg - 1 : 0;
            firstSeg = m3u8cfg.mediaSequence;
            startSeg = nextSeg > 0 ? nextSeg : firstSeg;
            lastSeg  = firstSeg + m3u8cfg.segments.length;
            segCount = dledSeg < firstSeg ? m3u8cfg.segments.length : lastSeg - dledSeg;
            // log stream data
            console.log(`[INFO] ~ Stream download status ~`);
            console.log(`  Last downloaded segment: ${dledSeg}`);
            console.log(`  Segments range         : ${startSeg} (${firstSeg}) - ${lastSeg}`);
            console.log(`  Segments count         : ${segCount}`);
            // update
            m3u8cfg.mediaSequence = startSeg;
            nextSeg               = lastSeg + 1;
            m3u8cfg.segments = m3u8cfg.segments.slice(m3u8cfg.segments.length - segCount);
        }
        */
        // ask before rewrite file
        if (fs.existsSync(`${fn}`) && !this.data.isResume) {
            let rwts = ( this.data.forceRw ? 'y' : false ) 
                || await shlp.question(`[Q] File «${fn}» already exists! Rewrite? (y/N)`);
            rwts = rwts || 'N';
            if (!['Y', 'y'].includes(rwts[0])) {
                return { ok: true, parts: this.data.parts };
            }
            console.log(`[INFO] Deleting «${fn}»...`);
            fs.unlinkSync(fn);
        }
        // show output filename
        if (fs.existsSync(fn) && this.data.isResume) {
            console.log(`[INFO] Adding content to «${fn}»...`);
        }
        else{
            console.log(`[INFO] Saving stream to «${fn}»...`);
        }
        // init proxy
        const proxy = this.data.proxy ? extFn.initProxy(this.data.proxy) : false;
        // start time
        this.data.dateStart = Date.now();
        let segments = this.data.m3u8json.segments;
        // download init part
        if (segments[0].map && this.data.offset === 0 && !this.data.skipInit) {
            console.log(`[INFO] Download and save init part...`);
            const initSeg = segments[0].map;
            if(segments[0].key){
                initSeg.key = segments[0].key;
            }
            try{
                const initDl = await this.downloadPart(initSeg, 'init', proxy);
                fs.writeFileSync(fn, initDl.dec, { flag: 'a' });
                console.log(`[INFO] Init part downloaded.`);
            }
            catch(e){
                console.log(`[ERROR] Part init download error:\n\t${e.message}`);
                return { ok: false, parts: this.data.parts };
            }
        }
        else if(segments[0].map && this.data.offset === 0 && this.data.skipInit){
            console.log('[WARN] Skipping init part can lead to broken video!');
        }
        // resuming ...
        if(this.data.offset > 0){
            segments = segments.slice(this.data.offset);
            console.log(`[INFO] Resuming download from part ${this.data.offset+1}...`);
            this.data.parts.completed = this.data.offset;
        }
        // dl process
        for (let p = 0; p < segments.length / this.data.threads; p++) {
            // set offsets
            let offset = p * this.data.threads;
            let dlOffset = offset + this.data.threads;
            // map download threads
            let prq = new Map();
            for (let px = offset; px < dlOffset && px < segments.length; px++) {
                prq.set(px, this.downloadPart(segments[px], px, proxy));
            }
            // download threads
            let res = [], errcnt = 0;
            for (let i = prq.size; i--;) {
                try {
                    let r = await Promise.race(prq.values());
                    prq.delete(r.p);
                    res[r.p - offset] = r.dec;
                }
                catch (error) {
                    prq.delete(error.p);
                    console.log('[ERROR] Part %s download error:\n\t%s',
                        error.p + 1 + this.data.offset, error.message);
                    errcnt++;
                }
            }
            // catch error
            if (errcnt > 0) {
                console.log(`[ERROR] ${errcnt} parts not downloaded`);
                return { ok: false, parts: this.data.parts };
                break;
            }
            // log downloaded
            let totalSeg = segments.length;
            let downloadedSeg = dlOffset < totalSeg ? dlOffset : totalSeg;
            this.data.parts.completed = downloadedSeg + this.data.offset;
            extFn.logDownloadInfo(
                this.data.dateStart, downloadedSeg, totalSeg,
                this.data.parts.completed, this.data.parts.total
            );
            // write downloaded
            for (let r of res) {
                fs.writeFileSync(fn, r, { flag: 'a' });
            }
        }
        // return result
        return { ok: true, parts: this.data.parts };
    }
    async downloadPart(seg, segIndex, proxy){
        const sURI = extFn.getURI(this.data.baseurl, seg.uri);
        let decipher, part, dec, p = segIndex;
        try {
            if (seg.key != undefined) {
                decipher = await this.downloadKey(seg.key, p, proxy);
            }
            part = await extFn.getData(p, sURI, this.data.headers, proxy, this.data.retries, [
                (res, retryWithMergedOptions) => {
                    if(this.data.checkPartLength && res.headers['content-length']){
                        if(!res.body || res.body.length != res.headers['content-length']){
                            // 'Part not fully downloaded'
                            return retryWithMergedOptions();
                        }
                    }
                    return res;
                }
            ]);
            if(this.data.checkPartLength && !part.headers['content-length']){
                this.data.checkPartLength = false;
                console.log(`[WARN] Part ${segIndex+1}: can't check parts size!`);
            }
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
    async downloadKey(key, segIndex, proxy){
        const kURI = extFn.getURI(this.data.baseurl, key.uri);
        const p = segIndex == 'init' ? 0 : segIndex;
        if (!this.data.keys[kURI]) {
            const rkey = await extFn.getData(p, kURI, this.data.headers, proxy, this.data.retries, [
                (res, retryWithMergedOptions) => {
                    if (!res || !res.body) {
                        // 'Key get error'
                        return retryWithMergedOptions();
                    }
                    if(res.body.length != 16){
                        // 'Key not fully downloaded'
                        return retryWithMergedOptions();
                    }
                    return res;
                }
            ]);
            this.data.keys[kURI] = rkey.body;
        }
        // get ivs
        let iv = Buffer.alloc(16);
        let ivs = key.iv ? key.iv : [0, 0, 0, p + 1];
        for (let i in ivs) {
            iv.writeUInt32BE(ivs[i], i * 4);
        }
        return crypto.createDecipheriv('aes-128-cbc', this.data.keys[kURI], iv);
    }
}

const extFn = {
    getURI: (baseurl, uri) => {
        const httpURI = /^https{0,1}:/.test(uri);
        if (!baseurl && !httpURI) {
            throw new Error('No base and not http(s) uri');
        }
        else if (httpURI) {
            return uri;
        }
        return baseurl + uri;
    },
    logDownloadInfo: (dateStart, partsDL, partsTotal, partsDLRes, partsTotalRes) => {
        const dateElapsed = Date.now() - dateStart;
        const percentFxd = (partsDL / partsTotal * 100).toFixed();
        const percent = percentFxd < 100 ? percentFxd : (partsTotal == partsDL ? 100 : 99);
        const revParts = parseInt(dateElapsed * (partsTotal / partsDL - 1));
        const time = shlp.formatTime((revParts / 1000).toFixed());
        console.log(`[INFO] ${partsDLRes} of ${partsTotalRes} parts downloaded [${percent}%] (${time})`);
    },
    initProxy: (proxy) => {
        return {};
        /*
        const host = proxy.host && proxy.host.match(':') 
            ? proxy.host.split(':')[0] : ( proxy.host ? proxy.host : proxy.ip );
        const port = proxy.host && proxy.host.match(':') 
            ? proxy.host.split(':')[1] : ( proxy.port ? proxy.port : null );
        const user = proxy.user || proxy['socks-login'];
        const pass = proxy.pass || proxy['socks-pass'];
        const auth = user && pass ? [user, pass].join(':') : null;
        if(host && port || proxy.url){
            const ProxyAgent = require('proxy-agent');
        }
        if(host && port){
            return new ProxyAgent(url.format({
                protocol: proxy.type,
                slashes: true,
                auth: auth,
                hostname: host,
                port: port,
            }));
        }
        else if(proxy.url){
            return new ProxyAgent(proxy.url);
        }
        */
    },
    getData: (partIndex, uri, headers, proxy, retry, afterResponse) => {
        // get file if uri is local
        if (uri.startsWith('file://')) {
            return {
                body: fs.readFileSync(url.fileURLToPath(uri)),
            };
        }
        // base options
        headers = headers ? headers : {};
        let options = { headers, retry, responseType: 'buffer', hooks: {
            afterResponse,
            beforeRetry: [
                (options, error, retryCount) => {
                    console.log('[WARN] Part %s: %d attempt to retrieve data', partIndex, retryCount + 1);
                    console.log(`\tERROR: ${error.message}`);
                }
            ]
        }};
        // proxy
        if (proxy) {
            // options.agent = proxy;
        }
        // do request
        return got(uri, options);
    }
};

module.exports = hlsDownload;
