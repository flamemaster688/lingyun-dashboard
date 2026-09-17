const fs = require("fs"), path = require("path"), vm = require("vm");
const BASE = "static";
const files = {
  data: path.join(BASE, "data.js"),
  adapter: path.join(BASE, "core", "data.js"),
  core: path.join(BASE, "core", "core.js"),
  agents: path.join(BASE, "pages", "agents.js")
};
const elements = {};
function el(id){ if(!elements[id]) elements[id]={_h:"",set innerHTML(v){this._h=String(v);},get innerHTML(){return this._h;},set textContent(v){this._t=String(v);},get textContent(){return this._t;},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return null;},addEventListener(){},appendChild(){},removeChild(){},insertBefore(){},replaceChild(){},insertAdjacentHTML(){},querySelector(){return null;},querySelectorAll(){return [];},onclick:null};return elements[id]; }
const document={readyState:"complete",getElementById:(id)=>el(id),querySelector:(s)=>el("q:"+s),querySelectorAll:()=>[],createElement:(t)=>el("n:"+t),addEventListener(){},removeEventListener(){},body:el("body"),documentElement:el("html")};
const chart={setOption(){},resize(){},dispose(){},on(){},off(){}};
const echarts={init:()=>chart,registerMap(){},getMap:()=>null,version:"5.5.1"};
const sandbox={window:null,document,echarts,console,setTimeout:()=>0,clearTimeout:()=>{},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Symbol,parseInt,parseFloat,isNaN,isFinite,addEventListener(){},removeEventListener(){}};
sandbox.window=sandbox; vm.createContext(sandbox);

let code = fs.readFileSync(files.agents, "utf-8");
const last = code.lastIndexOf("})();");
code = code.slice(0, last) + "\n;window.__T={columnsByKeys:columnsByKeys,CASE_SUMMARY_COLUMN_KEYS:CASE_SUMMARY_COLUMN_KEYS,activeColumns:activeColumns,FULL_COL_MAP:FULL_COL_MAP};})();";
[files.data, files.adapter, files.core, files.agents].forEach(f=>{
  if (f === files.agents) vm.runInContext(code, sandbox, {filename:f});
  else vm.runInContext(fs.readFileSync(f,"utf-8"), sandbox, {filename:f});
});

let pass=0, fail=0;
function assert(c,m){ if(c){pass++;console.log("✓ "+m);} else {fail++;console.log("✗ "+m);} }

const T = sandbox.window.__T;
// 1) case list columns include all 8 target labels exactly once
const labels = T.columnsByKeys(T.CASE_SUMMARY_COLUMN_KEYS, "2026-08");
const labelNames = labels.map(c=>c.label);
const want = ["总token数","模型计费（元）","提效比率","单笔节约时长","节约人年","节约金额","产生真实价值","是否正向价值"];
want.forEach(w=>{
  const n = labelNames.filter(x=>x===w).length;
  assert(n===1, "案例清单明细含列「"+w+"」且唯一 ("+n+")");
});

// 2) positiveValue registered + formatter returns 是/否 badge
const pv = T.FULL_COL_MAP["positiveValue"];
assert(!!pv, "positiveValue 已注册");
const yesHtml = pv.fmt({positiveValue:1});
const noHtml = pv.fmt({positiveValue:0});
assert(yesHtml.indexOf("是")>=0 && yesHtml.indexOf("f0fdf4")>=0, "正向=是(绿徽标)");
assert(noHtml.indexOf("否")>=0 && noHtml.indexOf("f1f5f9")>=0, "非正向=否(灰徽标)");

// 3) personYear/saveAmount/realValue formatters: null -> /, number -> formatted
const py=T.FULL_COL_MAP["personYear"], sa=T.FULL_COL_MAP["saveAmount"], rv=T.FULL_COL_MAP["realValue"];
assert(py.fmt({personYear:null}).indexOf("/")>=0 && py.fmt({personYear:1.5}).indexOf("1.50")>=0, "节约人年 formatter ok");
assert(sa.fmt({saveAmount:null}).indexOf("/")>=0 && sa.fmt({saveAmount:1234.5}).indexOf("1234.50")>=0, "节约金额 formatter ok");
assert(rv.fmt({realValue:null}).indexOf("/")>=0 && rv.fmt({realValue:99}).indexOf("99.00")>=0, "产生真实价值 formatter ok");

// 4) expanded drill uses activeColumns -> also includes the 4 new keys
const act = T.activeColumns("2026-08").map(c=>c.key);
["personYear","saveAmount","realValue","positiveValue","tokens","modelCost","effRatio","saveSec"].forEach(k=>{
  assert(act.indexOf(k)>=0, "展开 drill(activeColumns) 含键「"+k+"」");
});

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail? 1:0);
