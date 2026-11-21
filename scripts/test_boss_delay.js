const fs=require('fs'),path=require('path'),vm=require('vm');
const sandbox={window:{},Math,console,Date,setTimeout,clearTimeout};
sandbox.globalThis=sandbox;vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('web/js/engine.js','utf8'),sandbox,{filename:'engine.js'});
const P=sandbox.window.PWLB;
const levels=JSON.parse(fs.readFileSync('web/data/levels.json','utf8'));
const lv=levels[7];
const g={level:lv,paths:lv.paths.map(p=>new P.Path(p)),enemies:[],projectiles:[],effects:[],towerList:[],
  towerAt:{},obstacleAt:{},coins:99999,carrotHp:999,time:0,state:'playing',enemySeq:1,kills:0,currentWave:0,
  onEnemyLeaked(){},onEnemyKilled(){},onWaveStart(){},onAllWavesCleared(){this.state='won';},
  spawnEnemy(t,pi){ this.spawnTimes = this.spawnTimes || {};
    (this.spawnTimes[t] = this.spawnTimes[t] || []).push(Number(this.time.toFixed(1))); },
  update(dt){this.time+=dt;this.waves.update(dt);}};
g.waves=new P.WaveManager(lv,g);
g.waves.index=lv.waves.length-2; g.waves.active=false; g.waves.timer=0.01;
for(let i=0;i<60*150;i++){g.update(1/60); if(g.state==='won')break;}
const st=g.spawnTimes||{};
const ft=st.finalBoss;
const others=Object.keys(st).filter(k=>k!=='finalBoss');
const lastOther=others.length?Math.max.apply(null, others.map(k=>Math.max.apply(null, st[k]))):0;
console.log('finalBoss 出场', ft);
console.log('最后小怪出场', lastOther);
console.log(ft && ft[0] > lastOther ? '[OK] Boss 压轴登场' : '[FAIL] Boss 未延后');
