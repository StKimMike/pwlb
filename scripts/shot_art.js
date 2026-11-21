const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9370','--user-data-dir=' + path.join(OUT,'fin'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9370/json/list')).json(); if(t&&t.length) break; } catch(e){} }
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
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  const BASE = await gameUrl(process.argv[2]);
  await send('Page.navigate',{url:BASE}); await sleep(3000);
  await shot('50-menu');
  await ev("App.startLevel('lv6')"); await sleep(1200);
  await ev('(function(){var g=App.game;g.coins=9000;var ids=Object.keys(App.towers);var n=0;for(var r=2;r<11;r+=2){for(var c=2;c<18;c+=3){if(g.canPlace(c,r)==="ok"&&n<ids.length){if(g.placeTower(c,r,ids[n]))n++;}}}g.mode="idle";return n;})()');
  await ev('App.game.waves.timer=0.05');
  await sleep(5000);
  await shot('51-battle-new');
  console.log('状态', JSON.stringify(await ev('({towers:App.game.towerList.length, enemies:App.game.enemies.length, kills:App.game.kills, wave:App.game.waves.index})')));
  await sleep(4000);
  await shot('52-battle-later');
  console.log('errors', JSON.stringify(errs.slice(0,5)));
  ws.close(); proc.kill(); await sleep(300); process.exit(0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
