const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9359','--user-data-dir=' + path.join(OUT,'v2j'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9359/json/list')).json(); if(t&&t.length) break; } catch(e){} }
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
    if(r.exceptionDetails) return {error:r.exceptionDetails.text}; return r.result&&r.result.value;};
  const shot=async(n)=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));};
  const BASE = await gameUrl(process.argv[2]);
  await send('Page.navigate',{url:BASE}); await sleep(3200);
  await ev("App.startLevel('lv8')"); await sleep(1000);
  await ev("(function(){var g=App.game;var b=g.spawnEnemy('finalBoss',0);b.dist=200;b.syncPos();return true;})()");
  await sleep(800);
  console.log('Boss 血条', JSON.stringify(await ev("({visible:!document.getElementById('boss-bar').classList.contains('hidden'), hp:document.getElementById('boss-bar-hp')&&document.getElementById('boss-bar-hp').textContent, name:document.getElementById('boss-bar-name').textContent})")));
  await shot('44-boss-bar');
  // 打到半血触发狂暴
  await ev("(function(){var g=App.game;var b=g.bossEnemy;b.hp=b.maxHp*0.45;g.update(1/60);return {phase2:document.getElementById('boss-bar').classList.contains('phase2'), speed:+b.baseSpeed.toFixed(1)};})()");
  await sleep(400);
  console.log('狂暴', JSON.stringify(await ev("({phase2:document.getElementById('boss-bar').classList.contains('phase2'), hp:document.getElementById('boss-bar-hp').textContent})")));
  await shot('45-boss-phase2');
  console.log('errors', JSON.stringify(errs.slice(0,5)));
  ws.close(); proc.kill(); await sleep(300); process.exit(0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
