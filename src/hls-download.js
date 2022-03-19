// build-in
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

// extra
const shlp = require('sei-helper');
const got = require('got');

// The following function should fix an issue with downloading. For more information see https://github.com/sindresorhus/got/issues/1489
const fixMiddleWare = (res) => {
    const isResponseOk = response => {
        const {statusCode} = response;
        const limitStatusCode = response.request.options.followRedirect ? 299 : 399;
    
        return (statusCode >= 200 && statusCode <= limitStatusCode) || statusCode === 304;
    };
    if (isResponseOk(res)) {
        res.request.destroy();
    }
    return res;
};

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
        this.data.timeout     = parseInt(options.timeout) || 60 * 1000; 
        // extra globals
        this.data.checkPartLength = true;
        this.data.isResume = this.data.offset > 0 ? true : ( options.typeStream || options.isResume );
        this.data.headers = options.headers;
        this.bytesDownloaded = 0;
        this.waitTime = options.fsRetryTime || 1000 * 5;
        this.callback = options.callback;
        if (this.callback && typeof this.callback !== 'function') {
            throw new Error('Callback has to be function or undefined');
        }
        this.override = options.override;
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
                    console.log('[INFO] Resume data is ok!');
                    this.data.offset = resumeData.completed;
                    this.data.isResume = true;
                }
                else{
                    console.log('[INFO] Resume data is wrong!');
                    console.log({
                        resume: { total: resumeData.total, dled: resumeData.completed },
                        current: { total: this.data.m3u8json.segments.length },
                    });
                }
            }
            catch(e){
                console.log('[ERROR] Resume failed, downloading will be not resumed!');
                console.log(e);
            }
        }
        // ask before rewrite file
        if (fs.existsSync(`${fn}`) && !this.data.isResume) {
            let rwts = this.override ?? await shlp.question(`[Q] File «${fn}» already exists! Rewrite? ([y]es/[N]o/[c]ontinue)`);
            rwts = rwts || 'N';
            if (['Y', 'y'].includes(rwts[0])) {
                console.log(`[INFO] Deleting «${fn}»...`);
                fs.unlinkSync(fn);
            }
            else if (['C', 'c'].includes(rwts[0])) {
                return { ok: true, parts: this.data.parts };
            }
            else {
                return { ok: false, parts: this.data.parts };
            }
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
            console.log('[INFO] Download and save init part...');
            const initSeg = segments[0].map;
            if(segments[0].key){
                initSeg.key = segments[0].key;
            }
            try{
                const initDl = await this.downloadPart(initSeg, 'init', proxy, 0);
                fs.writeFileSync(fn, initDl.dec, { flag: 'a' });
                fs.writeFileSync(`${fn}.resume`, JSON.stringify({
                    completed: 0,
                    total: this.data.m3u8json.segments.length
                }));
                console.log('[INFO] Init part downloaded.');
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
            let krq = new Map(), prq = new Map();
            let res = [], errcnt = 0;
            for (let px = offset; px < dlOffset && px < segments.length; px++){
                let curp = segments[px];
                if(curp.key && !krq.has(curp.key.uri) && !this.data.keys[curp.key.uri]){
                    krq.set(curp.key.uri, this.downloadKey(curp.key, px, proxy, this.data.offset));
                }
            }
            try {
                await Promise.all(krq.values());
            } catch (er) {
                console.log(`[ERROR] Key ${er.p + 1} download error:\n\t${er.message}`);
                return { ok: false, parts: this.data.parts };
            }
            for (let px = offset; px < dlOffset && px < segments.length; px++){
                let curp = segments[px];
                prq.set(px, this.downloadPart(curp, px, proxy, this.data.offset));
            }
            for (let i = prq.size; i--;) {
                try {
                    let r = await Promise.race(prq.values());
                    prq.delete(r.p);
                    res[r.p - offset] = r.dec;
                }
                catch (error) {
                    console.log('[ERROR] Part %s download error:\n\t%s',
                        error.p + 1 + this.data.offset, error.message);
                    prq.delete(error.p);
                    errcnt++;
                }
            }
            // catch error
            if (errcnt > 0) {
                console.log(`[ERROR] ${errcnt} parts not downloaded`);
                return { ok: false, parts: this.data.parts };
            }
            // write downloaded
            for (let r of res) {
                let error = 0;
                while (error < 3) {
                    try {
                        fs.writeFileSync(fn, r, { flag: 'a' });
                        break;
                    } catch (err) {
                        console.error(err);
                        console.log(`[ERROR] Unable to write to file '${fn}' (Attempt ${error+1}/3)`);
                        console.log(`[INFO] Waiting ${Math.round(this.waitTime / 1000)}s before retrying`);
                        await new Promise((resolve) => setTimeout(() => resolve(), this.waitTime));
                    }
                    error++;
                }
                if (error === 3) {
                    console.log(`[ERROR] Unable to write content to '${fn}'.`);
                    return { ok: false, parts: this.data.parts };
                }
            }
            // log downloaded
            let totalSeg = segments.length;
            let downloadedSeg = dlOffset < totalSeg ? dlOffset : totalSeg;
            this.data.parts.completed = downloadedSeg + this.data.offset;
            let data = extFn.getDownloadInfo(
                this.data.dateStart, downloadedSeg, totalSeg,
                this.bytesDownloaded
            );
            fs.writeFileSync(`${fn}.resume`, JSON.stringify({
                completed: this.data.parts.completed,
                total: totalSeg
            }));
            console.log(`[INFO] ${downloadedSeg} of ${totalSeg} parts downloaded [${data.percent}%] (${shlp.formatTime((data.time / 1000).toFixed())} | ${(data.downloadSpeed / 1000000).toPrecision(2)}Mb/s)`);
            if (this.callback)
                this.callback({ total: this.data.parts.total, cur: this.data.parts.completed, bytes: this.bytesDownloaded, percent: data.percent, time: data.time, downloadSpeed: data.downloadSpeed });
        }
        // return result
        fs.unlinkSync(`${fn}.resume`);
        return { ok: true, parts: this.data.parts };
    }
    async downloadPart(seg, segIndex, proxy, segOffset){
        const sURI = extFn.getURI(this.data.baseurl, seg.uri);
        let decipher, part, dec, p = segIndex;
        try {
            if (seg.key != undefined) {
                decipher = await this.getKey(seg.key, p, proxy, segOffset);
            }
            part = await extFn.getData(p, sURI, {
                ...this.data.headers,
                ...(seg.byterange ? {
                    Range: `bytes=${seg.byterange.offset}-${seg.byterange.offset+seg.byterange.length-1}`
                } : {})
            }, segOffset, proxy, false, this.data.timeout, this.data.retries, [
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
                console.log(`[WARN] Part ${segIndex+segOffset+1}: can't check parts size!`);
            }
            if (decipher == undefined) {
                this.bytesDownloaded += part.body.byteLength;
                return { dec: part.body, p };
            }
            dec = decipher.update(part.body);
            dec = Buffer.concat([dec, decipher.final()]);
            this.bytesDownloaded += dec.byteLength;
        }
        catch (error) {
            error.p = p;
            throw error;
        }
        return { dec, p };
    }
    async downloadKey(key, segIndex, proxy, segOffset){
        const kURI = extFn.getURI(this.data.baseurl, key.uri);
        const p = segIndex == 'init' ? 0 : segIndex;
        if (!this.data.keys[kURI]) {
            try {
                const rkey = await extFn.getData(p, kURI, this.data.headers, segOffset, proxy, true, this.data.timeout, this.data.retries, [
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
                return rkey;
            }
            catch (error) {
                error.p = p;
                throw error;
            }
        }
    }
    async getKey(key, segIndex, proxy, segOffset){
        const kURI = extFn.getURI(this.data.baseurl, key.uri);
        const p = segIndex == 'init' ? 0 : segIndex;
        if (!this.data.keys[kURI]) {
            try{
                const rkey = await this.downloadKey(key, segIndex, proxy, segOffset);
                this.data.keys[kURI] = rkey.body;
            }
            catch (error) {
                error.p = p;
                throw error;
            }
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
    getDownloadInfo: (dateStart, partsDL, partsTotal, downloadedBytes) => {
        const dateElapsed = Date.now() - dateStart;
        const percentFxd = (partsDL / partsTotal * 100).toFixed();
        const percent = percentFxd < 100 ? percentFxd : (partsTotal == partsDL ? 100 : 99);
        const revParts = parseInt(dateElapsed * (partsTotal / partsDL - 1));
        const downloadSpeed = downloadedBytes / (dateElapsed / 1000); //Bytes per second
        return { percent, time: revParts, downloadSpeed };
    },
    initProxy: (proxy) => {
        const host = proxy.host && proxy.host.match(':') 
            ? proxy.host.split(':')[0] : ( proxy.host ? proxy.host : proxy.ip );
        const port = proxy.host && proxy.host.match(':') 
            ? proxy.host.split(':')[1] : ( proxy.port ? proxy.port : null );
        const user = proxy.user || proxy['socks-login'];
        const pass = proxy.pass || proxy['socks-pass'];
        const auth = user && pass ? [user, pass].join(':') : null;
        let ProxyAgent;
        if(host && port || proxy.url){
            ProxyAgent = require('proxy-agent');
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
    },
    getData: (partIndex, uri, headers, segOffset, proxy, isKey, timeout, retry, afterResponse) => {
        // get file if uri is local
        if (uri.startsWith('file://')) {
            return {
                body: fs.readFileSync(url.fileURLToPath(uri)),
            };
        }
        // base options
        headers = headers && typeof headers == 'object' ? headers : {};
        let options = { headers, retry, responseType: 'buffer', hooks: {
            beforeRequest: [
                (options) => {
                    if(!options.headers['user-agent']){
                        options.headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:70.0) Gecko/20100101 Firefox/70.0';
                    }
                    // console.log(' - Req:', options.url.pathname);
                }
            ],
            afterResponse: [fixMiddleWare].concat(afterResponse || []),
            beforeRetry: [
                (options, error, retryCount) => {
                    if(error){
                        const partType = isKey ? 'Key': 'Part';
                        const partIndx = partIndex + 1 + segOffset;
                        console.log('[WARN] %s %s: %d attempt to retrieve data', partType, partIndx, retryCount + 1);
                        console.log(`\tERROR: ${error.message}`);
                    }
                }
            ]
        }};
        // proxy
        if (proxy) {
            options.agent = {
                http: proxy,
                https: proxy,
            };
        }
        options.timeout = timeout;
        // do request
        return got(uri, options);
    }
};

module.exports = hlsDownload;
