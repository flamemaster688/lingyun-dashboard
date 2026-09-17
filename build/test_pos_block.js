const fs = require("fs"), path = require("path"), vm = require("vm");
const BASE = "static";
const elements = {};
function el(id){ if(!elements[id]) elements[id]={_h:"",set innerHTML(v){this._h=String(v);},get innerHTML(){return this._h;},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return null;},addEventListener(){},appendChild(){},removeChild(){},insertBefore(){},replaceChild(){},insertAdjacentHTML(){},querySelector(){return null;},querySelectorAll(){return [];},onclick:null};return elements[id]; }
const document={readyState:"complete",getElementById:(id)=>el(id),querySelector:(s)=>el("q:"+s),querySelectorAll:()=>[],createElement:(t)=>el("n:"+t),addEventListener(){},removeEventListener(){},body:el("body"),documentElement:el("html")};
const chart={setOption(){},resize(){},dispose(){},on(){},off(){}};
const echarts={init:()=>chart,registerMap(){},getMap:()=>null,version:"5.5.1"};
const sandbox={window:null,document,echarts,console,setTimeout:()=>0,clearTimeout:()=>{},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Symbol,parseInt,parseFloat,isNaN,isFinite,addEventListener(){},removeEventListener(){}};
sandbox.window=sandbox; vm.createContext(sandbox);
["data.js","core/data.js","core/core.js"].forEach(f=>{ vm.runInContext(fs.readFileSync(path.join(BASE,f),"utf8"),sandbox,{filename:f}); });

let code=fs.readFileSync(path.join(BASE,"pages","agents.js"),"utf8");
const last=code.lastIndexOf("})();");
code=code.slice(0,last)+"\n;window.__T={renderPositiveConclusion:renderPositiveConclusion, buildShell: buildShell};})();";
vm.runInContext(code,sandbox,{filename:"agents.js"});
const T=sandbox.__T;

// 构造最小 shell 容器（byId 自动建 stub，这里直接调渲染）
T.renderPositiveConclusion();

const kpis = el("agPosKpis").innerHTML;
const concl = el("agPosConclusion").innerHTML;
console.log("=== KPI 卡片渲染长度:", kpis.length);
console.log(kpis.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,600));
console.log("\n=== 结论 HTML 长度:", concl.length);
const text = concl.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
console.log(text.slice(0, 1500));

// 断言关键数字出现
const has = (s)=>concl.indexOf(s)>=0;
let ok=true;
function chk(c,m){ if(c){console.log("  ✓ "+m);} else {ok=false;console.log("  ✗ "+m);} }
console.log("\n=== 断言 ===");
chk(/智能体总数/.test(kpis), "KPI 含 智能体总数");
chk(/正向价值智能体/.test(kpis), "KPI 含 正向价值智能体");
chk(/正向价值贡献占比/.test(kpis), "KPI 含 正向价值贡献占比");
chk(/头部集中度/.test(kpis), "KPI 含 头部集中度");
chk(/价值极度头部化/.test(concl), "结论含 价值极度头部化");
chk(/工作流/.test(concl), "结论含 工作流");
chk(/稽核 \/ 查证 \/ 预判 \/ 分析/.test(concl), "结论含 场景族");
chk(/平台引导方向/.test(concl), "结论含 平台引导方向");
chk(/（4\.9%）/.test(concl) || /（5\.0%）/.test(concl) || /（4\.\d%）/.test(concl), "结论含 正向率百分比");

console.log("\n结果：" + (ok?"通过":"失败"));
process.exit(ok?0:1);
