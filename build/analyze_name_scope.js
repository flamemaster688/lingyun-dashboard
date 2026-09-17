const fs = require("fs");
const s = fs.readFileSync("static/data.js","utf8");
const data = JSON.parse(s.match(/window\.LINGYUN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);
const rows = data.agentMonthly;
const num = x => (x===null||x===undefined||x===""||(typeof x==="number"&&x!==x)) ? null : Number(x);

// 名字维度：同名智能体(可能跨省多份)的省份分布
const byName={};
for(const r of rows){
  const n=r.name; if(!n) continue;
  let o=byName[n]; if(!o) o=byName[n]={name:n,prov:{},pos:0,save:0,type:r.type,phase:r.servicePhase,scene:r.appScene};
  o.prov[r.province]=1;
  if(r.positiveValue===1) o.pos=1;
  const sa=num(r.saveAmount); if(sa) o.save+=sa;
}
const names=Object.values(byName);
const multiProv=names.filter(o=>Object.keys(o.prov).length>=2);
console.log("同名智能体数:",names.length," 跨>=2省的同名智能体:",multiProv.length);
console.log("\n跨省份最多的同名智能体 Top12(按省数):");
multiProv.sort((a,b)=>Object.keys(b.prov).length-Object.keys(a.prov).length).slice(0,12).forEach(o=>{
  console.log("  "+o.name.slice(0,30).padEnd(30)+" 覆盖省:"+Object.keys(o.prov).length+" 正向:"+o.pos+" 节约:"+o.save.toFixed(0)+" 场景:"+(o.scene||"-"));
});

// 桂启营 核查
console.log("\n=== 桂启营 核查 ===");
const gqy=byName["桂启营"];
if(gqy) console.log("  桂启营 覆盖省:",Object.keys(gqy.prov).length, "省:",Object.keys(gqy.prov).join(","), " 正向:",gqy.pos," 节约:",gqy.save.toFixed(0));
else {
  // 模糊找
  const hit=Object.keys(byName).filter(n=>n.indexOf("桂启营")>=0);
  console.log("  精确未命中, 模糊:",hit.join(" | "));
  hit.forEach(n=>{const o=byName[n]; console.log("   "+n+" 省:"+Object.keys(o.prov).join(",")+" 正向:"+o.pos+" 节约:"+o.save.toFixed(0));});
}

// 正向价值在全部智能体(名字级)中的占比
const posNames=names.filter(o=>o.pos);
console.log("\n名字级: 总智能体名",names.length," 正向",posNames.length,"占比",(posNames.length/names.length*100).toFixed(1)+"%");
const totSave=names.reduce((s,o)=>s+o.save,0), posSave=posNames.reduce((s,o)=>s+o.save,0);
console.log("节约金额 正向贡献占比:",(posSave/(totSave||1)*100).toFixed(1)+"%");
