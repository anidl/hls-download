# hls-download
[![npm](https://img.shields.io/npm/v/hls-download.svg?style=flat-square)](https://npmjs.com/hls-download)
[![npm downloads](https://img.shields.io/npm/dm/hls-download.svg?style=flat-square)](https://npmjs.com/hls-download)
[![dependencies status](https://david-dm.org/seiya-npm/hls-download/status.svg?style=flat-square)](https://david-dm.org/seiya-npm/hls-download)

## Install
```
npm i hls-download
```

## Usage
```
const got = require('got');
const m3u8 = require('m3u8-parsed');
const hlsdl = require('hls-download');

getStream();

async function getStream(){
    
    let getM3u8Sheet;
    try{
        getM3u8Sheet = await got('http://example.com/path/to/your/stream.m3u8');
    }
    catch(e){
        console.log(`Can't get playlist!`);
        process.exit();
    }
    let headers = { "myCustomHeader": "ping" };
    let m3u8cfg = m3u8(getM3u8Sheet.res.body);
    
    let proxyObj = false;
    
    /*
    // proxy http
    proxy = { "host": "192.168.0.101", "port": 1234, "type": "http" };
    // proxy https
    proxy = { "host": "192.168.0.101", "port": 443, "type": "https" };
    // proxy socks
    proxy = { "host": "192.168.0.101", "port": 1235, "type": "socks" };
    // proxy socks auth
    proxy['socks-login'] = 'socks server login';
    proxy['socks-pass'] = 'socks server password';
    */
    
    let mystream = await hlsdl({ fn: "myfile", m3u8json: m3u8cfg, proxy: proxyObj, headers: headers });
    
    if(!mystream.ok){
        console.log(`[ERROR] ${mystream.err}\n`);
    }
    else{
        console.log(`[INFO] Video downloaded!\n`);
    }
    
}
```