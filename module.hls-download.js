const agent = require('socks5-https-client/lib/Agent');
const crypto = require('crypto');
const request = require('request');
const shlp = require('sei-helper');
const fs = require('fs');
let date_start, authCookie;

// async
function getData(method, url, proxy) {
	// base options
	let options = {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:55.0) Gecko/20100101 Firefox/55.0'
		}
	};
	if(authCookie){
		options.headers.Cookie = authCookie;
	}
	if (proxy && proxy.type === 'socks') {
		options.agentClass = agent;
		let agentOptions = {
			socksHost: proxy.ip.split(':')[0],
			socksPort: proxy.ip.split(':')[1]
		};
		options.agentOptions = agentOptions;
		options.timeout = 10000;
	}
	else if (proxy && proxy.type === 'http') {
		options.proxy = 'http://' + proxy.ip;
		options.timeout = 10000;
	}
	// request parameters
	options.url = url;
	options.encoding = null;
	// do request
	return new Promise((resolve, reject) => {
		request[method](options, (err, res) => {
			if (err) return reject(err);
			if (res.statusCode != 200) {
				return reject(new Error(`Response code: ${res.statusCode}. Body: ${res.body}`));
			}
			resolve(res);
		});
	});
}

function getURI(baseurl, uri) {
	const httpURI = /^https{0,1}:/.test(uri);
	if (!baseurl && !httpURI) {
		throw new Error('no base and not http uri');
	} else if (httpURI) {
		return uri;
	}

	return baseurl + uri;
}

async function dlparts(m3u8json, fn, baseurl, proxy) {
	let keys = {}
	// delete file if exists
	if(fs.existsSync(`${fn}.ts`)){
		fs.unlinkSync(`${fn}.ts`);
	}
	// dl parts
	const pcount = 10;
	for (let p = 0; p < m3u8json.segments.length / pcount; p++) {
		let offset = p * pcount;
		let prq = new Map();
		for (let px = offset; px < offset + pcount && px < m3u8json.segments.length; px++) {
			prq.set(px, dlpart(m3u8json, fn, px, baseurl, keys, proxy));
		}
		let res = [];
		for (let x = 5; x--;) {
			for (let i = prq.size; i--;) {
				try {
					let r = await Promise.race(prq.values());
					prq.delete(r.p);
					res[r.p - offset] = r.dec;
				} catch (error) {
					console.log(`[ERROR] Part ${error.p} download error: ${error.message}${x > 0 ? ', retry' : ', FAIL'}`);
					prq.set(error.p, dlpart(m3u8json, fn, error.p, baseurl, keys, proxy));
				}
			}
		}
		if (prq.size > 0) {
			throw new Error(`[ERROR] ${prq.size} parts not downloaded`);
		}
		let dled = offset + 10;
		
		getDLedInfo((dled<m3u8json.segments.length?dled:m3u8json.segments.length),m3u8json.segments.length);
		
		for (let r of res) {
			fs.writeFileSync(`${fn}.ts`, r, { flag: 'a' });
		}
	}
}

function getDLedInfo(dled,total){
	const date_elapsed = Date.now() - date_start;
	const percentFxd = (dled / total * 100).toFixed();
	const percent = percentFxd < 100 ? percentFxd : 99;
	const time = shlp.htime(((parseInt(date_elapsed * (total / dled - 1))) / 1000).toFixed());
	console.log(`[INFO] ${dled} parts of ${total} downloaded [${percent}%] (${time})`);
}

async function getDecipher(pd, keys, baseurl, proxy) {
	const kURI = getURI(baseurl, pd.key.uri);
	if (!keys[kURI]) {
		const rkey = await getData('get', kURI, proxy);
		if (!rkey || !rkey.body) {
			throw new Error('key get error');
		}
		keys[kURI] = rkey.body;
	}
	// get ivs
	let iv = Buffer.alloc(16);
	let ivs = pd.key.iv;
	for (i in ivs) {
		iv.writeUInt32BE(ivs[i], i * 4);
	}
	return crypto.createDecipheriv('aes-128-cbc', keys[kURI], iv);
}

async function dlpart(m3u8json, fn, p, baseurl, keys, proxy) {
	// console.log(`download segment ${p+1}`);
	let pd = m3u8json.segments[p];
	let decipher, part;
	try {
		decipher = await getDecipher(pd, keys, baseurl, proxy);
		part = await getData('get', getURI(baseurl, pd.uri), proxy);
	} catch (error) {
		error.p = p;
		throw error;
	}
	let dec = decipher.update(part.body);
	dec = Buffer.concat([dec, decipher.final()]);
	let part_num = p + 1;
	let part_num_lng = part_num.toString().length;
	return { dec, p }
}

module.exports = async (fn, m3u8json, baseurl, cookie, proxy) => {
	// console.log({m3u8json, fn, baseurl});
	console.log('[INFO] Starting downloading ts...')
	if(cookie){
		authCookie = cookie;
	}
	let res = { "ok": true };
	try {
		date_start = Date.now();
		await dlparts(m3u8json, fn, baseurl, proxy);
	} catch (error) {
		res = { "ok": false, "err": error };
	}
	return res;
};
