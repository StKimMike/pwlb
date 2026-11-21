/** 锁定系统测试：锁定优先、射程限制、建筑只能靠锁定拆除。 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const sandbox={window:{},Math,console,Date,setTimeout,clearTimeout};
sandbox.globalThis=sandbox;vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('web/js/engine.js','utf8'),sandbox,{filename:'engine.js'});
const P=sandbox.window.PWLB;
const towers=JSON.parse(fs.readFileSync('web/data/towers.json','utf8'));
const enemies=JSON.parse(fs.readFileSync('web/data/enemies.json','utf8'));
const levels=JSON.parse(fs.readFileSync('web/data/levels.json','utf8'));
let fail=0;
const check=(n,c,d)=>{ if(c) console.log('  ok  '+n); else { fail++; console.log('  FAIL '+n+(d?' → '+d:'')); } };

function mk(){
  const lv=levels[0];
  const g={level:lv,paths:lv.paths.map(p=>new P.Path(p)),enemies:[],projectiles:[],effects:[],towerList:[],
    towerAt:{},obstacleAt:{},obstacles:[],coins:9999,carrotHp:99,time:0,state:'playing',enemySeq:1,kills:0,currentWave:0,
    lockedTarget:null,
    onEnemyLeaked(){},onEnemyKilled(e){this.kills++;},onWaveStart(){},onAllWavesCleared(){},
    damageBuildings(x,y,amount,splash){
      const r=Math.max(26,splash||26), r2=r*r;
      this.obstacles.slice().forEach(o=>{
        if(o.hp<=0)return;
        const left=o.col*64,top=o.row*64,right=left+o.w*64,bottom=top+o.h*64;
        const nx=Math.max(left,Math.min(x,right)), ny=Math.max(top,Math.min(y,bottom));
        if((x-nx)*(x-nx)+(y-ny)*(y-ny)<=r2){o.hp-=amount;o.flash=1;}});},
    spawnEnemy(t,pi){const e=new P.Enemy(enemies[t],{id:this.enemySeq++,path:this.paths[pi]||this.paths[0]});this.enemies.push(e);return e;},
    update(dt){this.time+=dt;this.enemies.forEach(e=>e.update(dt,this));this.towerList.forEach(t=>t.update(dt,this));
      this.projectiles.forEach(p=>p.update(dt,this));
      this.enemies=this.enemies.filter(e=>e.alive);this.projectiles=this.projectiles.filter(p=>p.alive);}};
  return g;
}

console.log('[1] 未锁定时不主动打建筑');
const g1=mk();
g1.obstacles.push({kind:'rock',col:6,row:5,w:1,h:1,hp:9999,maxHp:9999,reward:50,flash:0});
const t1=new P.Tower(towers.cannon,1,5,5); g1.towerList.push(t1);
const e1=g1.spawnEnemy('rabbit',0); e1.dist=300; e1.syncPos();
const bhp0=g1.obstacles[0].hp;
for(let i=0;i<60*10;i++) g1.update(1/60);
check('未锁定时建筑不掉血', g1.obstacles[0].hp===bhp0, bhp0+'→'+g1.obstacles[0].hp);
check('未锁定时敌人被击杀', g1.kills>0, 'kills='+g1.kills);

console.log('[2] 锁定建筑后炮塔集中打建筑');
const g2=mk();
g2.obstacles.push({kind:'rock',col:6,row:5,w:1,h:1,hp:9999,maxHp:9999,reward:50,flash:0});
const t2=new P.Tower(towers.cannon,1,5,5); g2.towerList.push(t2);
g2.lockedTarget={type:'building',ref:g2.obstacles[0]};
const b0=g2.obstacles[0].hp;
for(let i=0;i<60*3;i++) g2.update(1/60);
check('锁定后建筑掉血', g2.obstacles[0].hp<b0, b0+'→'+Math.round(g2.obstacles[0].hp));

console.log('[3] 锁定目标超出射程 → 炮塔不理会');
const g3=mk();
const far=new P.Tower(towers.cannon,1,1,1); g3.towerList.push(far);
const farEnemy=g3.spawnEnemy('rabbit',0); farEnemy.dist=1500; farEnemy.syncPos();
g3.lockedTarget={type:'enemy',ref:farEnemy};
const hp0=farEnemy.hp;
const picked=far.pickTarget(g3);
check('射程外的锁定目标不被选中', picked===null, picked?('选中了 '+Math.round(picked.x)+','+Math.round(picked.y)):'null');

console.log('[4] 锁定敌人在射程内 → 优先它');
const g4=mk();
const near=new P.Tower(towers.arrow,1,5,5); g4.towerList.push(near);
const a=g4.spawnEnemy('rabbit',0); a.dist=100; a.syncPos();
const bb=g4.spawnEnemy('rabbit',0); bb.dist=260; bb.syncPos();
g4.lockedTarget={type:'enemy',ref:bb};
const chosen=near.pickTarget(g4);
check('锁定目标优先于更靠前的敌人', chosen===bb, chosen===bb?'正确':'选错目标');

console.log('[5] 锁定目标死亡后自动失效');
const g5=mk();
const dead=g5.spawnEnemy('rabbit',0);
g5.lockedTarget={type:'enemy',ref:dead};
dead.alive=false;
const alive=(function(){var l=g5.lockedTarget;return l && l.type==='enemy' && l.ref && l.ref.alive;})();
check('锁定对象死亡后判定为失效', !alive);

console.log(fail===0?'\n[OK] 锁定系统全部通过':'\n[FAIL] '+fail+' 项');
process.exit(fail?1:0);
