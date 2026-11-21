const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9352','--user-data-dir=' + path.join(OUT,'v2c'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9352/json/list')).json(); if(t&&t.length) break; } catch(e){} }
  const page=t.find((x)=>x.type==='page')||t[0];
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map(); const errs=[];
  const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  ws.addEventListener('message',(e)=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);return;}
    if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;errs.push((d.exception&&(d.exception.description||d.exception.value))||d.text);}
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){errs.push((m.params.args||[]).map(a=>a.description||a.value).join(' '));}});
  await new Promise((r)=>ws.addEventListener('open',r));
  await send('Page.enable'); await send('Runtime.enable');
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) return {error:r.exceptionDetails.text}; return r.result&&r.result.value;};
  const shot=async(n)=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));};
  const log=(k,v)=>console.log(k, JSON.stringify(v));
  const BASE = await gameUrl(process.argv[2]);
  await send('Page.navigate',{url:BASE}); await sleep(3500);
  log('启动', await ev('({ready:!!window.__pwlbReady, towers:Object.keys(App.towers).length, enemies:Object.keys(App.enemies).length})'));

  await ev("App.startLevel('lv8')"); await sleep(1000);
  log('建筑', await ev('({total:App.game.obstacles.length, multi:App.game.obstacles.filter(o=>o.w>1||o.h>1).length, withHp:App.game.obstacles.every(o=>o.hp>0&&o.maxHp>0)})'));

  // 购买道具（金币购买，不再掉落）
  await ev('App.game.coins=1000');
  await ev("document.querySelectorAll('#item-bar .item-btn')[0].click()");
  await sleep(300);
  log('购买道具', await ev('({coins:App.game.coins, inv:App.game.inventory, mode:App.game.mode, pickups:App.game.pickups.length})'));

  // 用炮塔打建筑：放一座炮塔在建筑旁并推进
  await ev('(function(){var g=App.game;var o=g.obstacles[0];var c=o.col-1,r=o.row;if(g.canPlace(c,r)!=="ok"){c=o.col+o.w;}" + "var t=g.placeTower(c,r,"cannon");return {placed:!!t, at:c+","+r, bldHp:o.hp};})()');
  log('布防', await ev('({towers:App.game.towerList.length})'));
  await ev('(function(){var g=App.game;for(var i=0;i<600;i++){g.update(1/60);}return true;})()');
  log('打建筑', await ev('({obstacles:App.game.obstacles.length, coins:App.game.coins})'));

  // 跳到最后一波验证 Boss
  await ev('(function(){var g=App.game;g.waves.index=g.waves.waves.length-2;g.waves.active=false;g.waves.timer=0.01;return true;})()');
  await sleep(1200);
  await ev('(function(){var g=App.game;for(var i=0;i<60*20;i++){g.update(1/60);}return true;})()');
  log('Boss 登场', await ev('(function(){var b=App.game.bossEnemy;return {has:!!b, name:b&&b.def.name, hp:b&&Math.round(b.hp), bar:!document.getElementById("boss-bar").classList.contains("hidden"), warning:!document.getElementById("boss-warning").classList.contains("hidden")};})()'));
  await shot('42-v2-boss');

  // 萝卜死亡
  await ev('App.game.carrotHp=1; App.game.onEnemyLeaked({boss:false});');
  await sleep(1500);
  log('死亡结算', await ev('({state:App.game.state, modal:!document.getElementById("modal-result").classList.contains("hidden"), kills:document.getElementById("result-kills")&&document.getElementById("result-kills").textContent})'));
  await shot('43-v2-result');

  console.log('errors', JSON.stringify(errs.slice(0,8)));
  console.log('pageErrors', JSON.stringify(await ev('(window.__pwlbErrors||[]).slice(0,5)')));
  ws.close(); proc.kill(); await sleep(300); process.exit(errs.length?2:0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
