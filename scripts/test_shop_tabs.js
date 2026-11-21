const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9358','--user-data-dir=' + path.join(OUT,'v2i'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9358/json/list')).json(); if(t&&t.length) break; } catch(e){} }
  const page=t.find((x)=>x.type==='page')||t[0];
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map(); const errs=[];
  const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  ws.addEventListener('message',(e)=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);return;}
    if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;errs.push((d.exception&&(d.exception.description||d.exception.value))||d.text);}});
  await new Promise((r)=>ws.addEventListener('open',r));
  await send('Page.enable'); await send('Runtime.enable');
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) return {error:r.exceptionDetails.text+' '+((r.exceptionDetails.exception||{}).description||'')}; return r.result&&r.result.value;};
  const BASE = await gameUrl(process.argv[2]);
  await send('Page.navigate',{url:BASE}); await sleep(3000);
  await ev("App.startLevel('lv1')"); await sleep(900);
  console.log('炮塔页', JSON.stringify(await ev("({cards:document.querySelectorAll('#tower-shop .shop-card').length, tab:document.querySelector('#shop-tabs .active')&&document.querySelector('#shop-tabs .active').textContent})")));
  console.log('切道具页', JSON.stringify(await ev("document.querySelector('#shop-tabs button[data-tab=item]').click(); ({cards:document.querySelectorAll('#tower-shop .shop-card').length})")));
  await sleep(300);
  console.log('道具卡片', JSON.stringify(await ev("({n:document.querySelectorAll('#tower-shop .item-card').length, names:Array.from(document.querySelectorAll('#tower-shop .item-card .sc-name')).map(e=>e.textContent)})")));
  await ev('App.game.coins=1000');
  console.log('买道具', JSON.stringify(await ev("document.querySelector('#tower-shop .item-card').click(); ({coins:App.game.coins, inv:App.game.inventory, mode:App.game.mode})")));
  console.log('errors', JSON.stringify(errs.slice(0,5)));
  ws.close(); proc.kill(); await sleep(300); process.exit(0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
