const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9401','--user-data-dir=' + path.join(OUT,'lock'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9401/json/list')).json(); if(t&&t.length) break; } catch(e){} }
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
  const clickCell=(col,row)=>ev('(function(){var cv=document.getElementById("game-canvas");var b=cv.getBoundingClientRect();var x=b.left+('+col+'+0.5)*64*(b.width/1280);var y=b.top+('+row+'+0.5)*64*(b.height/768);cv.dispatchEvent(new MouseEvent("click",{clientX:x,clientY:y,bubbles:true}));return true;})()');

  await send('Page.navigate',{url:await gameUrl()}); await sleep(3000);
  await ev("App.startLevel('lv1')"); await sleep(1000);
  await ev('App.game.coins=9999');

  // 1) 点敌人锁定
  const e = await ev('(function(){var g=App.game;var en=g.spawnEnemy("rabbit",0);en.dist=200;en.syncPos();return {x:Math.round(en.x/64*100)/100, y:Math.round(en.y/64*100)/100, col:Math.floor(en.x/64), row:Math.floor(en.y/64)};})()');
  console.log('敌人位置', JSON.stringify(e));
  await ev('(function(){var g=App.game;var cv=document.getElementById("game-canvas");var b=cv.getBoundingClientRect();var en=g.enemies[0];var x=b.left+en.x*(b.width/1280);var y=b.top+en.y*(b.height/768);cv.dispatchEvent(new MouseEvent("click",{clientX:x,clientY:y,bubbles:true}));return true;})()');
  await sleep(300);
  console.log('锁定敌人', JSON.stringify(await ev('({locked:!!App.game.lockedTarget, type:App.game.lockedTarget&&App.game.lockedTarget.type})')));
  await shot('60-lock-enemy');

  // 2) 再点一次取消
  await ev('(function(){var g=App.game;var cv=document.getElementById("game-canvas");var b=cv.getBoundingClientRect();var en=g.enemies[0];var x=b.left+en.x*(b.width/1280);var y=b.top+en.y*(b.height/768);cv.dispatchEvent(new MouseEvent("click",{clientX:x,clientY:y,bubbles:true}));return true;})()');
  await sleep(300);
  console.log('取消锁定', JSON.stringify(await ev('({locked:!!App.game.lockedTarget})')));

  // 3) 点建筑锁定
  const ob = await ev('(function(){var o=App.game.obstacles[0];return {col:o.col,row:o.row,w:o.w,h:o.h,hp:o.hp};})()');
  console.log('建筑', JSON.stringify(ob));
  await clickCell(ob.col, ob.row); await sleep(400);
  console.log('锁定建筑', JSON.stringify(await ev('({locked:!!App.game.lockedTarget, type:App.game.lockedTarget&&App.game.lockedTarget.type, panel:!document.getElementById("tower-inspect").classList.contains("hidden")})')));
  await shot('61-lock-building');

  // 4) 建炮塔验证能打掉建筑
  await ev('(function(){var g=App.game;var o=g.obstacles[0];g.buildType="cannon";var placed=0;for(var r=0;r<12&&!placed;r++)for(var c=0;c<20&&!placed;c++){if(g.canPlace(c,r)==="ok"){if(Math.abs(c-o.col)<=3&&Math.abs(r-o.row)<=3){if(g.placeTower(c,r,"cannon"))placed=1;}}}g.mode="idle";return placed;})()');
  const hp0 = await ev('App.game.obstacles[0].hp');
  await ev('(function(){var g=App.game;for(var i=0;i<60*8;i++)g.update(1/60);return true;})()');
  const hp1 = await ev('(function(){var o=App.game.obstacles[0];return o?o.hp:0;})()');
  console.log('锁定后建筑血量', hp0, '→', hp1);

  console.log('errors', JSON.stringify(errs.slice(0,6)));
  ws.close(); proc.kill(); await sleep(300); process.exit(0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
