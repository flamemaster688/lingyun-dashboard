const fs = require("fs");
const s = fs.readFileSync("static/data.js","utf8");
const m = s.match(/window\.LINGYUN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
if(!m){ console.log("NO MATCH"); process.exit(1); }
const data = JSON.parse(m[1]);
console.log("顶层 keys:", Object.keys(data).join(", "));
const dm = data.agentMonthly;
console.log("agentMonthly 类型:", Array.isArray(dm)?"array("+dm.length+")":typeof dm);
if(Array.isArray(dm)){
  console.log("样本第一行 keys:", Object.keys(dm[0]).join(", "));
  console.log("样本:", JSON.stringify(dm[0], null, 1).slice(0,1500));
}
