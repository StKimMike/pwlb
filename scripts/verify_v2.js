const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const OUT = path.resolve(__dirname, '..', '.out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { gameUrl } = require('./lib');
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1280,900',
     '--remote-debugging-port=9337','--user-data-dir=' + path.join(OUT,'p5'),'about:blank'],{stdio:'ignore'});
  let t=null;
  for (let i=0;i<60;i++){ await sleep(300); try { t=await (await fetch('http://127.0.0.1:9337/json/list')).json(); if(t&&t.length) break; } catch(e){} }
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
    if(r.exceptionDetails) return {error:r.exceptionDetails.text+' '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description)};
    return r.result&&r.result.value;};
  const shot=async(n)=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));};
  const clickCell=(col,row)=>ev('(function(){var cv=document.getElementById("game-canvas");var r=cv.getBoundingClientRect();'
    +'var x=r.left+('+col+'+0.5)*64*(r.width/1280);var y=r.top+('+row+'+0.5)*64*(r.height/768);'
    +'cv.dispatchEvent(new MouseEvent("mousemove",{clientX:x,clientY:y,bubbles:true}));'
    +'cv.dispatchEvent(new MouseEvent("click",{clientX:x,clientY:y,bubbles:true}));return true;})()');

  const BASE = await gameUrl(process.argv[2]);
  await send('Page.navigate',{url:BASE}); await sleep(3000);
  await ev("App.startLevel('lv1')"); await sleep(1200);
  console.log('A.血量与空位数', JSON.stringify(await ev('({hp:document.getElementById("hud-carrot").textContent, barW:document.getElementById("hud-carrot-bar").style.width, spots:document.getElementById("hud-open-spots").textContent})')));

  // 1) 建塔模式：开局就是（点同一张卡会切走，这里只保证处于建造态）
  await ev("App.game.mode='build'; App.game.buildType='bottle'; document.querySelectorAll('#tower-shop .shop-card')[0].click(); document.querySelectorAll('#tower-shop .shop-card')[0].click();");
  await sleep(300);
  console.log('B.任意格可建', JSON.stringify(await ev('({mode:App.game.mode, corners:[App.game.canPlace(0,0),App.game.canPlace(19,11),App.game.canPlace(0,6)], slotOnly:App.game.canPlace(5,5)})')));
  // 在一个从没被设计为塔位的角落建塔
  await clickCell(0, 0); await sleep(200);
  await clickCell(1, 0); await sleep(200);
  await clickCell(2, 0); await sleep(300);
  console.log('C.连建三塔', JSON.stringify(await ev('({towers:App.game.towerList.length, cells:App.game.towerList.map(t=>t.col+","+t.row), stillBuild:App.game.mode})')));
  await shot('22-build-anywhere');

  // 2) 点塔弹出贴塔面板
  await ev("App.game.mode='idle'");
  await clickCell(0, 0); await sleep(400);
  console.log('D.贴塔面板', JSON.stringify(await ev('(function(){var b=document.getElementById("tower-inspect");var t=App.game.towerList[0];var cv=document.getElementById("game-canvas").getBoundingClientRect();'
    +'var tx=cv.left+(t.col+0.5)*64*(cv.width/1280), ty=cv.top+(t.row+0.5)*64*(cv.height/768);var br=b.getBoundingClientRect();'
    +'return {visible:!b.classList.contains("hidden"), dist:Math.round(Math.hypot(br.left+br.width/2-tx, br.top+br.height/2-ty)), hasUp:!!b.querySelector("[data-act=up]"), hasSell:!!b.querySelector("[data-act=sell]")};})()')));
  await shot('23-tower-popup');

  // 3) 障碍拆除
  console.log('E.障碍格', JSON.stringify(await ev('(function(){var o=App.game.obstacles[0];return {kind:o.kind,col:o.col,row:o.row,cost:App.game.obstacleCost(o)};})()')));
  const ob = await ev('(function(){var o=App.game.obstacles[0];return o.col+","+o.row;})()');
  const [oc, or_] = String(ob).split(',').map(Number);
  await clickCell(oc, or_); await sleep(400);
  await shot('24-obstacle-popup');
  console.log('F.拆除前', JSON.stringify(await ev('({popup:App.popup, coins:App.game.coins, obstacles:App.game.obstacles.length})')));
  await ev("document.querySelector('#tower-inspect [data-act=clear]').click()"); await sleep(400);
  console.log('G.拆除后', JSON.stringify(await ev('({coins:App.game.coins, obstacles:App.game.obstacles.length, cellFree:App.game.canPlace(' + oc + ',' + or_ + ')})')));

  // 4) 击杀掉金币可见
  await ev("App.game.spawnEnemy('rabbit',0); var e=App.game.enemies[App.game.enemies.length-1]; e.hp=1;");
  await sleep(400);
  console.log('H.击杀金币飘字', JSON.stringify(await ev('(function(){var e=App.game.enemies[0];var before=App.game.coins;App.game.towerList.forEach(function(t){t.hurt});'
    +'if(e){e.hurt(999,App.game);}return {coinsBefore:before, coinsAfter:App.game.coins, coinFx:App.game.effects.filter(f=>f.type==="coin").length};})()')));
  await shot('25-coin-popup');

  // 5) 萝卜真的会死
  await ev("App.game.carrotHp=2; App.game.onEnemyLeaked({boss:false}); App.game.onEnemyLeaked({boss:false});");
  await sleep(1500);
  console.log('I.萝卜死亡', JSON.stringify(await ev('({state:App.game&&App.game.state, hp:App.game&&App.game.carrotHp, modal:!document.getElementById("modal-result").classList.contains("hidden"), title:document.getElementById("result-title").textContent})')));
  await shot('26-death');

  console.log('errors', JSON.stringify(errs.slice(0,8)));
  ws.close(); proc.kill(); await sleep(300); process.exit(0);
}
main().catch((e)=>{console.error('FAIL',e);process.exit(1);});
