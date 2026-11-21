const fs=require('fs'),vm=require('vm');
const sb={window:{},Math,console,Date,setTimeout,clearTimeout};
sb.globalThis=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync('web/js/engine.js','utf8'),sb,{filename:'engine.js'});
const P=sb.window.PWLB;
const towers=JSON.parse(fs.readFileSync('web/data/towers.json','utf8'));
const enemies=JSON.parse(fs.readFileSync('web/data/enemies.json','utf8'));
const levels=JSON.parse(fs.readFileSync('web/data/levels.json','utf8'));
const lv=levels[0];

function mk(){
  const g={level:lv,paths:lv.paths.map(p=>new P.Path(p)),enemies:[],projectiles:[],effects:[],towerList:[],
    towerAt:{},obstacleAt:{},obstacles:[],coins:9999,carrotHp:99,time:0,state:'playing',enemySeq:1,kills:0,currentWave:0,
    onEnemyLeaked(){},onEnemyKilled(e){this.kills++;},
    onWaveStart(){},onAllWavesCleared(){},
    damageBuildings(x,y,amount,splash){
      const r=Math.max(26,splash||26), r2=r*r;
      this.obstacles.slice().forEach(o=>{
        if(o.hp<=0)return;
        const left=o.col*64,top=o.row*64,right=left+o.w*64,bottom=top+o.h*64;
        const nx=Math.max(left,Math.min(x,right)), ny=Math.max(top,Math.min(y,bottom));
        if((x-nx)*(x-nx)+(y-ny)*(y-ny)<=r2){o.hp-=amount;o.flash=1;}
      });},
    spawnEnemy(t,pi){const e=new P.Enemy(enemies[t],{id:this.enemySeq++,path:this.paths[pi]||this.paths[0]});this.enemies.push(e);return e;},
    update(dt){this.time+=dt;this.enemies.forEach(e=>e.update(dt,this));this.towerList.forEach(t=>t.update(dt,this));
      this.projectiles.forEach(p=>p.update(dt,this));
      this.enemies=this.enemies.filter(e=>e.alive);this.projectiles=this.projectiles.filter(p=>p.alive);}};
  return g;
}

let bad=0;
const ids=Object.keys(towers).filter(k=>k!=='drum');
for(const id of ids){
  const g=mk();
  // 找一个人工确定的塔位：路径第一个拐点附近
  const tw=new P.Tower(towers[id],1,5,4);
  g.towerList.push(tw);
  const e=g.spawnEnemy('rabbit',0);
  e.dist=250; e.syncPos();
  const hp0=e.hp;
  let maxProj=0;
  for(let i=0;i<60*4;i++){ g.update(1/60); if(g.projectiles.length>maxProj)maxProj=g.projectiles.length; }
  const dealt=e.hp<hp0 || !e.alive;
  if(!dealt){ console.log('  [FAIL] '+id+' 没打出伤害 (range='+towers[id].levels[0].range+', dist='+Math.round(Math.hypot(e.x-tw.cx,e.y-tw.cy))+')'); bad++; }
  else console.log('  ok  '+id+' 造成伤害 '+(hp0-Math.max(0,e.hp)).toFixed(0));
}

// 激光塔单独测（持续伤害，无弹丸）
const gs=mk(); const sun=new P.Tower(towers.sun,1,5,4); gs.towerList.push(sun);
const se=gs.spawnEnemy('rabbitTank',0); se.dist=250; se.syncPos(); const shp=se.hp;
for(let i=0;i<60*3;i++) gs.update(1/60);
if(se.hp>=shp){ console.log('  [FAIL] sun 激光没伤害'); bad++; } else console.log('  ok  sun 激光伤害 '+(shp-se.hp).toFixed(0));

// 建筑受击
const gb=mk();
gb.obstacles.push({kind:'rock',col:6,row:3,w:2,h:2,hp:400,maxHp:400,reward:50,flash:0});
const cb=new P.Tower(towers.cannon,1,5,4); gb.towerList.push(cb);
const be=gb.spawnEnemy('rabbit',0); be.dist=250; be.syncPos();
// 建筑现在只有"锁定后"才会被炮塔攻击（需求要求）
gb.lockedTarget={type:'building',ref:gb.obstacles[0]};
const bhp0=gb.obstacles[0].hp;
for(let i=0;i<60*8;i++) gb.update(1/60);
if(gb.obstacles[0].hp>=bhp0){ console.log('  [FAIL] 建筑没被打掉血'); bad++; }
else console.log('  ok  建筑被炮塔打掉 '+(bhp0-gb.obstacles[0].hp).toFixed(0)+' 血');

console.log(bad===0?'\n[OK] 全部炮塔都能打出伤害':('\n[FAIL] '+bad+' 项'));
process.exit(bad?1:0);
