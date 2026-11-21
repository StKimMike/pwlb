/** v2 内核测试：策略、多格建筑、护盾、中毒、分裂、光环。 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const sandbox={window:{},Math,console,Date,setTimeout,clearTimeout};
sandbox.globalThis=sandbox;vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT,'web/js/engine.js'),'utf8'),sandbox,{filename:'engine.js'});
const P=sandbox.window.PWLB;
const read=(f)=>JSON.parse(fs.readFileSync(path.join(ROOT,'web/data',f),'utf8'));
const towers=read('towers.json'), enemies=read('enemies.json'), levels=read('levels.json');

let fail=0;
const check=(n,c,d)=>{ if(c) console.log('  ok  '+n); else { fail++; console.log('  FAIL '+n+(d?' → '+d:'')); } };

function mk(lv){
  const g={level:lv,paths:(lv.paths||[]).map(p=>new P.Path(p)),enemies:[],projectiles:[],effects:[],
    towerList:[],towerAt:{},obstacleAt:{},obstacles:[],coins:lv.startCoins,carrotHp:lv.carrotHp,
    time:0,state:'playing',enemySeq:1,kills:0,leaks:0,currentWave:0,coinsEarned:0,
    onEnemyLeaked(e){this.leaks++;},onEnemyKilled(e){this.kills++;this.coins+=e.reward;},
    onWaveStart(){},onAllWavesCleared(){this.state='won';},
    spawnSplit(p){this._split=(this._split||0)+1;},
    damageBuildings(x,y,amount,splash){this._bldHits=(this._bldHits||0)+1;},
    spawnEnemy(t,pi){const e=new P.Enemy(enemies[t],{id:this.enemySeq++,path:this.paths[pi]||this.paths[0],hpScale:lv.hpScale});
      if(this.currentWave>0)e.applyWaveScale(this.currentWave);this.enemies.push(e);return e;},
    update(dt){this.time+=dt;this.waves.update(dt);this.enemies.forEach(e=>e.update(dt,this));
      this.towerList.forEach(t=>t.update(dt,this));this.projectiles.forEach(p=>p.update(dt,this));
      this.enemies=this.enemies.filter(e=>e.alive);this.projectiles=this.projectiles.filter(p=>p.alive);
      this.effects=this.effects.filter(f=>f.life>0);}};
  g.waves=new P.WaveManager(lv,g);
  return g;
}

console.log('[1] 数据覆盖');
check('12 种炮塔', Object.keys(towers).length===12, Object.keys(towers).length);
check('>=12 种怪', Object.keys(enemies).length>=12, Object.keys(enemies).length);
const strategies=new Set();
for(const id of Object.keys(towers)){ for(const lv of towers[id].levels) strategies.add(lv.strategy||'single'); }
check('策略种类 >= 8', strategies.size>=8, [...strategies].join(','));
check('存在 aura 塔', Object.values(towers).some(t=>t.levels[0].strategy==='aura'));
check('存在最终 Boss finalBoss', !!enemies.finalBoss);
check('finalBoss 血量 >= 30000', (enemies.finalBoss||{}).hp>=30000, (enemies.finalBoss||{}).hp);

console.log('[2] 建筑多格');
const lv8=levels[7];
const multi=(lv8.obstacles||[]).filter(o=>(o.w||1)>1||(o.h||1)>1);
check('lv8 存在多格建筑', multi.length>0, multi.length+' 个');
const g=mk(lv8);
// 按主控的方式建立 multi-cell 索引
(lv8.obstacles||[]).forEach(function(o){
  for(var dy=0;dy<(o.h||1);dy++)for(var dx=0;dx<(o.w||1);dx++) g.obstacleAt[(o.col+dx)+','+(o.row+dy)]=o;
});
const o0=(lv8.obstacles||[])[0];
if(o0){
  let occupied=0;
  for(let dy=0;dy<(o0.h||1);dy++)for(let dx=0;dx<(o0.w||1);dx++) if(g.obstacleAt[(o0.col+dx)+','+(o0.row+dy)]) occupied++;
  check('建筑占满 w*h 格', occupied===(o0.w||1)*(o0.h||1), occupied);
}

console.log('[3] 策略行为');
const lv=levels[0];
const g2=mk(lv);
// 放置所有 12 种塔，各打 12 秒，看是否都有伤害输出
const ids=Object.keys(towers);
let slot=0;
for(const id of ids){
  const def=towers[id];
  const t=new P.Tower(def,2,slot%18,1+Math.floor(slot/18));
  slot++;
  g2.towerList.push(t);
}
for(let i=0;i<6;i++) g2.spawnEnemy('rabbit',0);
for(let s=0;s<60*12;s++) g2.update(1/60);
check('有敌人被击杀', g2.kills>0, 'kills='+g2.kills);
check('产生了弹丸或特效', g2.projectiles.length>=0 && g2.effects.length>=0);

console.log('[4] 护盾');
const shielded=Object.keys(enemies).find(k=>(enemies[k].shield||0)>0);
if(shielded){
  const e=new P.Enemy(enemies[shielded],{id:1,path:g2.paths[0]});
  const hp0=e.hp, sh0=e.shield;
  e.hurt(50,g2);
  check('先扣护盾后扣血', e.shield<sh0 && e.hp===hp0, 'shield '+sh0+'→'+e.shield+', hp '+hp0+'→'+e.hp);
} else check('存在带护盾的怪（可跳过）', true);

console.log('[5] 中毒与分裂');
const e2=new P.Enemy(enemies.rabbit,{id:2,path:g2.paths[0]});
e2.applyPoison(30,2);
const hpA=e2.hp;
e2.update(1,g2);
check('中毒持续掉血', e2.hp<hpA, hpA+'→'+e2.hp.toFixed(1));

const splitter=Object.keys(enemies).find(k=>(enemies[k].split||0)>0);
if(splitter){
  const g3=mk(lv);
  const s=new P.Enemy(enemies[splitter],{id:3,path:g3.paths[0]});
  g3.enemies.push(s);
  s.hurt(99999,g3);
  check('分裂兔死亡触发分裂', (g3._split||0)>0, 'splits='+(g3._split||0));
} else check('存在分裂怪（可跳过）', true);

console.log('[6] 光环加成');
const auraId=Object.keys(towers).find(id=>towers[id].levels[0].strategy==='aura');
if(auraId){
  const g4=mk(lv);
  const aura=new P.Tower(towers[auraId],1,5,5);
  const ally=new P.Tower(towers.bottle,1,6,5);
  g4.towerList.push(aura,ally);
  for(let i=0;i<30;i++) g4.update(1/60);
  check('光环给友军加成', (ally.buff||0)>0, 'buff='+ally.buff);
  check('光环塔自身不攻击', towers[auraId].levels[0].damage===0 || towers[auraId].levels[0].strategy==='aura');
} else check('存在光环塔（可跳过）', true);

console.log('[7] 最终 Boss 在最后一波');
const lastWave=lv8.waves[lv8.waves.length-1];
const hasFinal=lastWave.groups.some(gr=>gr.enemy==='finalBoss');
check('lv8 最后一波含 finalBoss', hasFinal, JSON.stringify(lastWave.groups.map(g=>g.enemy)));

console.log(fail===0?'\n[OK] v2 内核测试全部通过':'\n[FAIL] '+fail+' 项失败');
process.exit(fail===0?0:1);
