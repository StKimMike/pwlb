const fs=require('fs');
// 用假 canvas 上下文检查 drawTower / drawEnemy 的 save-restore 平衡与变换泄漏
function makeCtx(){
  let depth=0, maxDepth=0; const tx=[];
  const noop=()=>{};
  const ctx={
    save(){depth++; if(depth>maxDepth)maxDepth=depth;},
    restore(){depth--; if(depth<0) throw new Error('restore 多于 save');},
    translate(){}, scale(){}, rotate(){}, setTransform(){}, clearRect:noop,
    beginPath:noop, moveTo:noop, lineTo:noop, quadraticCurveTo:noop, bezierCurveTo:noop,
    arc:noop, arcTo:noop, ellipse:noop, rect:noop, roundRect:noop, closePath:noop, fill:noop, stroke:noop, clip:noop,
    fillRect:noop, strokeRect:noop, fillText:noop, strokeText:noop, measureText:()=>({width:10}),
    createLinearGradient:()=>({addColorStop:noop}), createRadialGradient:()=>({addColorStop:noop}),
    createPattern:()=>({}), drawImage:noop, setLineDash:noop, getLineDash:()=>[],
    fillStyle:'',strokeStyle:'',lineWidth:1,lineCap:'',lineJoin:'',globalAlpha:1,
    globalCompositeOperation:'source-over',font:'',textAlign:'',textBaseline:'',
    shadowBlur:0,shadowColor:'',shadowOffsetX:0,shadowOffsetY:0,lineDashOffset:0,
    getDepth(){return depth;}, getMax(){return maxDepth;}
  };
  return ctx;
}
const sandbox={window:{},Math,console,Date,document:{createElement:()=>({getContext:()=>makeCtx(),width:0,height:0})}};
sandbox.globalThis=sandbox;
require('vm').createContext(sandbox);
require('vm').runInContext(fs.readFileSync('web/js/sprites.js','utf8'),sandbox,{filename:'sprites.js'});
const S=sandbox.window.Sprites;
const towers=['bottle','arrow','fan','ice','cannon','magic','tesla','sun','poison','sniper','missile','drum'];
const enemies=['rabbit','rabbitFast','rabbitTank','rabbitJump','rabbitHeal','rabbitShield','rabbitFly','rabbitSplit','rabbitGhost','rabbitBerserk','rabbitArmored','rabbitBoss','rabbitKing','finalBoss'];
const kinds=['rock','mushroom','crate','crystal','tree','house','fence','tower_rubble'];
let bad=0;
for(const id of towers) for(let lv=1;lv<=3;lv++){
  const c=makeCtx();
  try{ S.drawTower(c,id,lv,100,100,1.2,{angle:0.5,firing:true}); }catch(e){ console.log('drawTower 抛错',id,lv,e.message); bad++; continue; }
  if(c.getDepth()!==0){ console.log('drawTower save/restore 不平衡',id,lv,'depth',c.getDepth()); bad++; }
}
for(const id of enemies){
  const c=makeCtx();
  try{ S.drawEnemy(c,id,100,100,1.2,{hp:0.6,facing:1,size:18,frozen:true,hitFlash:0.5}); }catch(e){ console.log('drawEnemy 抛错',id,e.message); bad++; continue; }
  if(c.getDepth()!==0){ console.log('drawEnemy save/restore 不平衡',id,'depth',c.getDepth()); bad++; }
}
for(const k of kinds){
  const c=makeCtx();
  try{ S.drawObstacle(c,k,100,100,1,{hp:0.5,w:2,h:2,size:60}); }catch(e){ console.log('drawObstacle 抛错',k,e.message); bad++; continue; }
  if(c.getDepth()!==0){ console.log('drawObstacle save/restore 不平衡',k,'depth',c.getDepth()); bad++; }
}
console.log(bad===0?'[OK] 绘制函数状态平衡':'[FAIL] '+bad+' 处问题');
process.exit(bad?1:0);
