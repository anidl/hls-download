const agent = require('socks5-https-client/lib/Agent');
const crypto = require('crypto');
const request = require('request');
const shlp = require('sei-helper');
const fs = require('fs');

// async
function getData(url, authCookie, proxy) {
	// base options
	let options = {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:57.0) Gecko/20100101 Firefox/57.0'
		}
	};
	if (authCookie) {
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
		request.get(options, (err, res) => {
			if (err) return reject(err);
			if (res.statusCode != 200) {
				let resBody = res.body ? ` Body:\n\t${res.body}` : ``;
				return reject(new Error(`Response code: ${res.statusCode}.${resBody}`));
			}
			resolve(res);
		});
	});
}

function getURI(baseurl, uri) {
	const httpURI = /^https{0,1}:/.test(uri);
	if (!baseurl && !httpURI) {
		throw new Error('No base and not http(s) uri');
	} else if (httpURI) {
		return uri;
	}
	return baseurl + uri;
}

async function dlparts(m3u8json, fn, baseurl, cookie, proxy, pcount, rcount) {
	let keys = {}
	// delete file if exists
	if (fs.existsSync(`${fn}.ts`)) {
		console.log(`[INFO] «${fn}.ts» already exists! Deleting...`);
		fs.unlinkSync(`${fn}.ts`);
	}
	// show target filename
	console.log(`[INFO] Saving stream to «${fn}.ts»`);
	let dateStart = Date.now();
	// dl parts
	for (let p = 0; p < m3u8json.segments.length / pcount; p++) {
		let offset = p * pcount;
		let prq = new Map();
		for (let px = offset; px < offset + pcount && px < m3u8json.segments.length; px++) {
			prq.set(px, dlpart(m3u8json, fn, px, baseurl, keys, cookie, proxy));
		}
		let res = [];
		for (let x = rcount; x--;) {
			for (let i = prq.size; i--;) {
				try {
					let r = await Promise.race(prq.values());
					prq.delete(r.p);
					res[r.p - offset] = r.dec;
				} catch (error) {
					console.log(`[ERROR] Part ${error.p} download error:\n\t${error.message}\n\t${x > 0 ? '[INFO] Retry...' : '[ERROR] FAIL'}`);
					prq.set(error.p, dlpart(m3u8json, fn, error.p, baseurl, keys, cookie, proxy));
				}
			}
		}
		if (prq.size > 0) {
			throw new Error(`${prq.size} parts not downloaded`);
		}

		let dled = offset + pcount;
		getDLedInfo(dateStart, (dled < m3u8json.segments.length ? dled : m3u8json.segments.length), m3u8json.segments.length);

		for (let r of res) {
			fs.writeFileSync(`${fn}.ts`, r, { flag: 'a' });
		}
	}
}

function getDLedInfo(dateStart, dled, total) {
	const dateElapsed = Date.now() - dateStart;
	const percentFxd = (dled / total * 100).toFixed();
	const percent = percentFxd < 100 ? percentFxd : (total == dled ? 100 : 99);
	const time = shlp.htime(((parseInt(dateElapsed * (total / dled - 1))) / 1000).toFixed());
	console.log(`[INFO] ${dled} parts of ${total} downloaded [${percent}%] (${time})`);
}

async function getDecipher(pd, keys, baseurl, cookie, proxy) {
	const kURI = getURI(baseurl, pd.key.uri);
	if (!keys[kURI]) {
		const rkey = await getData(kURI, cookie, proxy);
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

async function dlpart(m3u8json, fn, p, baseurl, keys, cookie, proxy) {
	// console.log(`download segment ${p+1}`);
	let pd = m3u8json.segments[p];
	let decipher, part;
	try {
		if (pd.key != undefined) {
			decipher = await getDecipher(pd, keys, baseurl, cookie, proxy);
		}
		part = await getData(getURI(baseurl, pd.uri), cookie, proxy);
	} catch (error) {
		error.p = p;
		throw error;
	}
	if (decipher == undefined) {
		return { dec: part.body, p }
	}
	let dec = decipher.update(part.body);
	dec = Buffer.concat([dec, decipher.final()]);
	return { dec, p }
}

module.exports = async (options) => {
	// set options
	options.pcount = options.pcount || 5;
	options.rcount = options.rcount || 5;
	const { fn, m3u8json, baseurl, cookie, proxy, pcount, rcount } = options;
	// start
	console.log('[INFO] Starting downloading ts...');
	let res = { "ok": true };
	try {
		await dlparts(m3u8json, fn, baseurl, cookie, proxy, pcount, rcount);
	} catch (error) {
		res = { "ok": false, "err": error };
	}
	return res;
};
