const fs = require("fs");
const s = fs.readFileSync("static/data.js","utf8");
const data = JSON.parse(s.match(/window\.LINGYUN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
const rows = data.agentMonthly;
const num = x => (x===null||x===undefined||x===""||(typeof x==="number"&&x!==x)) ? null : Number(x);
function bump(o,v){ v=(v==null?"":String(v)).trim(); if(!v) return; o[v]=(o[v]||0)+1; }

const provPos={}, monthPos={}, provSave={};
let posRowsTotal=0;
for(const r of rows){
  if(r.positiveValue===1){
    posRowsTotal++;
    bump(provPos, r.province);
    bump(monthPos, r.month);
    const sa=num(r.saveAmount); if(sa!==null) bump(provSave, r.province);
  }
}
console.log("=== 行级正向月份覆盖 ===");
Object.entries(monthPos).sort((a,b)=>{const mo=x=>parseInt(x[0]);return mo(a)-mo(b);}).forEach(([k,v])=>console.log("  "+k+": 正向行 "+v));

const llmAll={all:0,allLLM:0,pos:0};
for(const r of rows){ llmAll.all++; if(r.isLLM===1) llmAll.allLLM++; if(r.positiveValue===1 && r.isLLM===1) llmAll.pos++; }
console.log("\n=== isLLM 与正向(行级) ===");
console.log("  全部行:", llmAll.all, " 其中isLLM行:", llmAll.allLLM);
console.log("  正向行总数:", posRowsTotal, " 其中isLLM正向行:", llmAll.pos, "占比:", (llmAll.pos/posRowsTotal*100).toFixed(1)+"%");

console.log("\n=== 正向行 按省份 Top12(正向行数) ===");
Object.entries(provPos).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>console.log("  "+k.padEnd(10)+" 正向行 "+v+"  累计节约(行级)"+(provSave[k]||0).toFixed(0)));

const agents={};
for(const r of rows){
  const id=r.appId; if(!id) continue;
  let a=agents[id]; if(!a){a=agents[id]={pos:0,isLLM:r.isLLM,prov:{},save:0,real:0};}
  a.prov[r.province]=1;
  if(r.positiveValue===1) a.pos=1;
  const sa=num(r.saveAmount); if(sa) a.save+=sa;
  const rv=num(r.realValue); if(rv) a.real+=rv;
}
const posAgents=Object.values(agents).filter(a=>a.pos);
const llmPos=posAgents.filter(a=>a.isLLM===1).length;
console.log("\n=== 智能体级 isLLM ===");
console.log("  正向智能体:",posAgents.length," 其中isLLM:",llmPos,"占比:",(llmPos/posAgents.length*100).toFixed(1)+"%");
console.log("  全部智能体 isLLM 数:",Object.values(agents).filter(a=>a.isLLM===1).length," / 总",Object.keys(agents).length);

const sorted=posAgents.slice().sort((a,b)=>b.save-a.save);
const tot=sorted.reduce((s,a)=>s+a.save,0);
const top1=sorted[0].save, top5=sorted.slice(0,5).reduce((s,a)=>s+a.save,0), top10=sorted.slice(0,10).reduce((s,a)=>s+a.save,0);
console.log("\n=== 价值集中度(智能体级节约金额) ===");
console.log("  总正向节约:",tot.toFixed(0));
console.log("  Top1 占:",(top1/tot*100).toFixed(1)+"%   Top5 占:",(top5/tot*100).toFixed(1)+"%   Top10 占:",(top10/tot*100).toFixed(1)+"%");

const provCount={};
posAgents.forEach(a=>{ const n=Object.keys(a.prov).length; provCount[n]=(provCount[n]||0)+1; });
console.log("\n=== 正向智能体 覆盖省份数分布(部署广度) ===");
Object.keys(provCount).sort((a,b)=>a-b).forEach(k=>console.log("  覆盖"+k+"省: "+provCount[k]+"个智能体"));
console.log("\n  多省部署(>=5省)的正向智能体:", posAgents.filter(a=>Object.keys(a.prov).length>=5).length, "个");
