const fs = require("fs");
const s = fs.readFileSync("static/data.js","utf8");
const data = JSON.parse(s.match(/window\.LINGYUN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
const rows = data.agentMonthly;
const num = x => (x===null||x===undefined||x===""||(typeof x==="number"&&x!==x)) ? null : Number(x);

function bump(obj,v){ v=(v==null?"":String(v)).trim(); if(!v) return; obj[v]=(obj[v]||0)+1; }
function mode(obj){ let mk="",mv=0; for(const k in obj){ if(obj[k]>mv){mv=obj[k];mk=k;} } return mk; }

const agents = {};
for(const r of rows){
  const id = r.appId;
  if(!id) continue;
  let a = agents[id];
  if(!a){
    a = agents[id] = {appId:id, name:r.name, type:r.type, creator:r.creator,
      servicePhase:{}, appScene:{}, promoScene:{}, tags:{},
      calls:0, saveAmount:0, realValue:0, personYear:0,
      rows:0, months:{}, provinces:{}, posRows:0, posMonths:{}, hasSaveAmount:0};
  }
  a.rows++;
  a.months[r.month]=1; a.provinces[r.province]=1;
  if(r.positiveValue===1){ a.posRows++; a.posMonths[r.month]=1; }
  const c=num(r.calls); if(c) a.calls+=c;
  const sa=num(r.saveAmount); if(sa!==null){ a.saveAmount+=sa; a.hasSaveAmount++; }
  const rv=num(r.realValue); if(rv!==null) a.realValue+=rv;
  const py=num(r.personYear); if(py!==null) a.personYear+=py;
  bump(a.servicePhase, r.servicePhase);
  bump(a.appScene, r.appScene);
  bump(a.promoScene, r.promoScene||"");
  if(r.tags) r.tags.split(/[,，、]/).forEach(t=>{t=t.trim(); if(t) bump(a.tags,t);});
}

const list = Object.values(agents).map(a=>{
  a.pos = a.posRows>0 ? 1:0;
  a.servicePhaseM = mode(a.servicePhase);
  a.appSceneM = mode(a.appScene);
  a.promoSceneM = mode(a.promoScene);
  a.nMonths = Object.keys(a.months).length;
  a.nProv = Object.keys(a.provinces).length;
  return a;
});

const total = list.length;
const pos = list.filter(a=>a.pos);
console.log("=== 总体 ===");
console.log("智能体总数(去重appId):", total);
console.log("正向价值智能体(存在正向月份):", pos.length, "占比:", (pos.length/total*100).toFixed(1)+"%");

console.log("\n=== 按 类型(type) 分布 + 正向率 ===");
const byType = {};
list.forEach(a=>{ const k=a.type||"(空)"; (byType[k]=byType[k]||{all:0,pos:0,save:0,real:0}); byType[k].all++; if(a.pos){byType[k].pos++; byType[k].save+=a.saveAmount; byType[k].real+=a.realValue;} });
Object.entries(byType).sort((a,b)=>b[1].pos-a[1].pos).forEach(([k,v])=>{
  console.log("  "+k.padEnd(10)+" 智能体"+v.all+"\t正向"+v.pos+"\t正向率"+(v.pos/v.all*100).toFixed(1)+"%\t节约金额累计"+v.save.toFixed(0)+"\t真实价值累计"+v.real.toFixed(0));
});

console.log("\n=== 按 服务环节(servicePhase) 正向率 ===");
const byPhase = {};
list.forEach(a=>{ const k=a.servicePhaseM||"(空)"; (byPhase[k]=byPhase[k]||{all:0,pos:0,save:0,real:0}); byPhase[k].all++; if(a.pos){byPhase[k].pos++; byPhase[k].save+=a.saveAmount; byPhase[k].real+=a.realValue;} });
Object.entries(byPhase).sort((a,b)=>b[1].pos-a[1].pos).forEach(([k,v])=>{
  console.log("  "+k.padEnd(10)+" 智能体"+v.all+"\t正向"+v.pos+"\t正向率"+(v.pos/v.all*100).toFixed(1)+"%\t节约金额累计"+v.save.toFixed(0)+"\t真实价值累计"+v.real.toFixed(0));
});

console.log("\n=== 按 应用场景(appScene) 正向率 (智能体数>=5) ===");
const byScene = {};
list.forEach(a=>{ const k=a.appSceneM||"(空)"; (byScene[k]=byScene[k]||{all:0,pos:0,save:0,real:0}); byScene[k].all++; if(a.pos){byScene[k].pos++; byScene[k].save+=a.saveAmount; byScene[k].real+=a.realValue;} });
Object.entries(byScene).filter(([k,v])=>v.all>=5).sort((a,b)=>b[1].pos-a[1].pos).forEach(([k,v])=>{
  console.log("  "+k.padEnd(16)+" 智能体"+v.all+"\t正向"+v.pos+"\t正向率"+(v.pos/v.all*100).toFixed(1)+"%");
});

console.log("\n=== 按 推广场景(promoScene) 正向率 ===");
const byPromo = {};
list.forEach(a=>{ const k=a.promoSceneM||"(空)"; (byPromo[k]=byPromo[k]||{all:0,pos:0}); byPromo[k].all++; if(a.pos)byPromo[k].pos++; });
Object.entries(byPromo).sort((a,b)=>b[1].pos-a[1].pos).forEach(([k,v])=>{
  console.log("  "+k.padEnd(16)+" 智能体"+v.all+"\t正向"+v.pos+"\t正向率"+(v.pos/v.all*100).toFixed(1)+"%");
});

console.log("\n=== 正向智能体 案例标签(tags) 词频 Top20 ===");
const tagCnt={};
pos.forEach(a=>{ Object.keys(a.tags).forEach(t=>{ tagCnt[t]=(tagCnt[t]||0)+1; }); });
Object.entries(tagCnt).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([k,v])=>console.log("  "+k.padEnd(14)+" "+v));

const totSave = list.reduce((s,a)=>s+a.saveAmount,0);
const totReal = list.reduce((s,a)=>s+a.realValue,0);
const posSave = pos.reduce((s,a)=>s+a.saveAmount,0);
const posReal = pos.reduce((s,a)=>s+a.realValue,0);
console.log("\n=== 价值贡献 ===");
console.log("节约金额: 全部", totSave.toFixed(0), " 正向智能体贡献", posSave.toFixed(0), "占比", (posSave/(totSave||1)*100).toFixed(1)+"%");
console.log("真实价值: 全部", totReal.toFixed(0), " 正向智能体贡献", posReal.toFixed(0), "占比", (posReal/(totReal||1)*100).toFixed(1)+"%");

console.log("\n=== Top 15 正向智能体(按节约金额) ===");
pos.slice().sort((a,b)=>b.saveAmount-a.saveAmount).slice(0,15).forEach((a,i)=>{
  console.log("  "+String(i+1).padStart(2)+". "+a.name.slice(0,28).padEnd(28)+" 类型:"+(a.type||"-")+" 环节:"+(a.servicePhaseM||"-")+" 场景:"+(a.appSceneM||"-")+" 节约:"+a.saveAmount.toFixed(0)+" 真实价值:"+a.realValue.toFixed(0)+" 调用:"+a.calls.toFixed(0));
});

console.log("\n=== 正向智能体 节约金额按服务环节累计 ===");
const saveByPhase={};
pos.forEach(a=>{ const k=a.servicePhaseM||"(空)"; saveByPhase[k]=(saveByPhase[k]||0)+a.saveAmount; });
Object.entries(saveByPhase).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log("  "+k.padEnd(10)+" "+v.toFixed(0)));

console.log("\n=== 正向智能体 节约金额按应用场景累计 Top12 ===");
const saveByScene={};
pos.forEach(a=>{ const k=a.appSceneM||"(空)"; saveByScene[k]=(saveByScene[k]||0)+a.saveAmount; });
Object.entries(saveByScene).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>console.log("  "+k.padEnd(16)+" "+v.toFixed(0)));
