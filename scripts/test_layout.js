const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9362','--user-data-dir=' + path.join(OUT,'v2l'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9362/json/list')).json(); if(t&&t.length) break; } catch(e){} }
  const page=t.find((x)=>x.type==='page')||t[0];
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  ws.addEventListener('message',(e)=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}});
  await new Promise((r)=>ws.addEventListener('open',r));
  await send('Page.enable'); await send('Runtime.enable');
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) return {error:r.exceptionDetails.text}; return r.result&&r.result.value;};
  const sizes=[[1280,900],[1280,720],[1024,700],[1440,900]];
  for(const [w,h] of sizes){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    const BASE = await gameUrl(process.argv[2]);
    await send('Page.navigate',{url:BASE}); await sleep(2200);
    await ev("App.startLevel('lv1')"); await sleep(900);
    const m=await ev("(function(){var d=document.documentElement;var ib=document.getElementById('item-bar');var st=document.getElementById('game-stage');var sh=document.getElementById('tower-shop');var r=e=>{var b=e.getBoundingClientRect();return {t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height),w:Math.round(b.width)};};return {vw:innerWidth,vh:innerHeight,scrollW:d.scrollWidth,scrollH:d.scrollHeight,stage:r(st),shop:r(sh),item:r(ib),overflowX: d.scrollWidth>innerWidth+1, overflowY: d.scrollHeight>innerHeight+1};})()");
    console.log(w+'x'+h, JSON.stringify(m));
  }
  ws.close(); proc.kill(); await sleep(300); process.exit(0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
