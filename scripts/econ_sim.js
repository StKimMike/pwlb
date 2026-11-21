/** 真人策略模拟：铺塔 + 升级 + 选塔搭配，用来标定难度曲线。 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const sandbox={window:{},Math,console,Date,setTimeout,clearTimeout};
sandbox.globalThis=sandbox;vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT,'web/js/engine.js'),'utf8'),sandbox,{filename:'engine.js'});
const P=sandbox.window.PWLB;
const towers=JSON.parse(fs.readFileSync(path.join(ROOT,'web/data/towers.json'),'utf8'));
const enemies=JSON.parse(fs.readFileSync(path.join(ROOT,'web/data/enemies.json'),'utf8'));
const levels=JSON.parse(fs.readFileSync(path.join(ROOT,'web/data/levels.json'),'utf8'));

function makeGame(lv){
  const g={level:lv,paths:lv.paths.map(p=>new P.Path(p)),enemies:[],projectiles:[],effects:[],
    towerList:[],towerAt:{},obstacleAt:{},obstacles:[],coins:lv.startCoins,carrotHp:lv.carrotHp,
    time:0,state:'playing',enemySeq:1,kills:0,leaks:0,currentWave:0,earned:0,
    onEnemyLeaked(e){this.leaks++;const d=e.boss?3:1;this.carrotHp=Math.max(0,this.carrotHp-d);if(this.carrotHp<=0)this.state='lost';},
    onEnemyKilled(e){this.kills++;this.coins+=e.reward;this.earned+=e.reward;},
    onWaveStart(){},onAllWavesCleared(){this.state='won';},
    spawnEnemy(t,pi){const e=new P.Enemy(enemies[t],{id:this.enemySeq++,path:this.paths[pi]||this.paths[0],hpScale:lv.hpScale});
      if(this.currentWave>0)e.applyWaveScale(this.currentWave);this.enemies.push(e);return e;},
    update(dt){this.time+=dt;this.waves.update(dt);this.enemies.forEach(e=>e.update(dt,this));
      this.towerList.forEach(t=>t.update(dt,this));this.projectiles.forEach(p=>p.update(dt,this));
      this.enemies=this.enemies.filter(e=>e.alive);this.projectiles=this.projectiles.filter(p=>p.alive);
      this.effects=this.effects.filter(f=>f.life>0);},
    blockedByPath(c,r){for(const p of this.paths){if(p.cellSet[c+','+r])return true;}return false;},
    canPlace(c,r){if(r<0||r>11||c<0||c>19)return 'outside';const k=c+','+r;if(this.towerAt[k])return 'occupied';
      if(this.obstacleAt[k])return 'blocked';if(this.blockedByPath(c,r))return 'path';return 'ok';},
    placeTower(c,r,id){const def=towers[id];if(!def||this.coins<def.cost)return null;
      if(this.canPlace(c,r)!=='ok')return null;this.coins-=def.cost;const t=new P.Tower(def,1,c,r);
      this.towerList.push(t);this.towerAt[c+','+r]=t;return t;},
    upgrade(t){const cost=t.upgradeCost();if(cost===null||this.coins<cost)return false;this.coins-=cost;t.level++;return true;}};
  g.waves=new P.WaveManager(lv,g);
  lv.obstacles.forEach((o,i)=>g.obstacleAt[o.col+','+o.row]={...o,hp:o.hp,maxHp:o.hp,flash:0,id:i});
  return g;
}

// 给每个空格算「射程内覆盖多少路径长度」，越能覆盖越多路的格子越值钱
function scoreSpots(g){
  const out=[];
  for(let r=0;r<12;r++)for(let c=0;c<20;c++){
    if(g.canPlace(c,r)!=='ok')continue;
    const x=(c+0.5)*64, y=(r+0.5)*64;
    let cover=0;
    for(const p of g.paths){
      for(let d=0;d<p.length;d+=24){
        const q=p.posAt(d);
        if(Math.hypot(q.x-x,q.y-y)<=170)cover++;
      }
    }
    if(cover>0)out.push({c,r,cover});
  }
  out.sort((a,b)=>b.cover-a.cover);
  return out;
}

// 塔的搭配：冰塔控、火炮群伤、瓶子打头、太阳花收割
const MIX=['bottle','ice','cannon','arrow','bottle','fan','tesla','sun','magic'];

function play(lv, verbose){
  const g=makeGame(lv);
  const dt=1/60; let steps=0;
  while(g.state==='playing'&&steps<1200*60){
    if(steps%12===0){
      let acted=true, guard=0;
      while(acted&&guard++<6){
        acted=false;
        const spots=scoreSpots(g);
        // 1) 建新塔：钱够就立刻建（优先覆盖面积最大的位置）
        if(spots.length){
          const id=MIX[g.towerList.length%MIX.length];
          const cost=towers[id].cost;
          if(g.coins>=cost){ if(g.placeTower(spots[0].c,spots[0].r,id)) acted=true; }
        }
        // 2) 没地方建了，或钱多到溢出，就升级最早的低级塔
        if(!acted){
          let target=null;
          for(const t of g.towerList){
            if(t.level>=3)continue;
            const c=t.upgradeCost();
            if(c!==null&&g.coins>=c){ if(!target||t.level<target.level) target=t; }
          }
          if(target&&g.coins>=target.upgradeCost()+80){ if(g.upgrade(target))acted=true; }
        }
      }
    }
    g.update(dt);steps++;
  }
  const ups=g.towerList.reduce((n,t)=>n+t.level-1,0);
  return {state:g.state,hp:g.carrotHp,max:lv.carrotHp,time:Math.round(g.time),towers:g.towerList.length,ups,kills:g.kills,leaks:g.leaks};
}

console.log('关卡        结果  萝卜      塔数  升级  击杀  漏  ');
let wins=0;
for(const lv of levels){
  const r=play(lv);
  if(r.state==='won')wins++;
  console.log(`${lv.id} ${lv.name.padEnd(5)} ${r.state==='won'?'WIN ':'LOSE'} ${String(r.hp).padStart(3)}/${r.max}  ${String(r.towers).padStart(3)}   ${String(r.ups).padStart(2)}   ${String(r.kills).padStart(3)}  ${String(r.leaks).padStart(2)}`);
}
console.log('胜率', wins + '/' + levels.length);
