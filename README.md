# hls-download
[![npm](https://img.shields.io/npm/v/hls-download.svg?style=flat-square)](https://npmjs.com/hls-download)
[![npm downloads](https://img.shields.io/npm/dm/hls-download.svg?style=flat-square)](https://npmjs.com/hls-download)

## Install
```
npm i hls-download
```

## Usage
```
const request = require('request');
const m3u8 = require('m3u8-parser');
const hlsdl = require('hls-download');

getStream();

async function getStream(){
	
	let getM3u8Sheet = await getData('http://example.com/path/to/your/stream.m3u8');
	
	let m3u8parse = new m3u8.Parser();
	m3u8parse.push(audioM3u8Req.res.body);
	m3u8parse.end();
	let m3u8cfg = m3u8parse.manifest;
	
	let proxy = false;
	// proxy = { "ip": "192.168.0.101:1234", "type": "http" }; // http(s)
	// proxy = { "ip": "192.168.0.101:1234", "type": "socks" };
	
	// (fn, m3u8json, baseurl, cookie, proxy)
	let mystream = await streamdl('myfile', m3u8cfg, false, false, proxy);
	
	if(!mystream.ok){
		console.log(`[ERROR] ${mystream.err}\n`);
	}
	else{
		console.log(`[INFO] Video downloaded!\n`);
	}
}


function getData(options){
	return new Promise((resolve) => {
		request(options, (err, res) => {
			if (err){
				res = err;
				resolve({ "err": "0", res });
			}
			if (res.statusCode != 200 && res.statusCode != 403) {
				resolve({ "err": res.statusCode, res });
			}
			resolve({res});
		});
	});
}
```