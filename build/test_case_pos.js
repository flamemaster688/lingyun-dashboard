// 针对性验证：是否正向价值 筛选维度（仅案例清单渲染）+ normalizeRow 映射
const fs = require("fs"), path = require("path"), vm = require("vm");
const BASE = "static";
function stub(){const f=function(){return p;};const p=new Proxy(f,{get(t,k){if(k===Symbol.toPrimitive)return()=>"";if(k==="toString")return()=>"";if(k==="length")return 0;if(k==="nodeType")return 1;if(k==="style")return {};if(k==="classList")return{add(){},remove(){},toggle(){},contains(){return false;}};return p;},set(){return true;},apply(){return p;},construct(){return p;}});return p;}
const elements={};
function el(id){if(!elements[id])elements[id]={_h:"",set innerHTML(v){this._h=String(v);},get innerHTML(){return this._h;},set textContent(v){this._t=String(v);},get textContent(){return this._t;},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return null;},addEventListener(){},appendChild(){},removeChild(){},insertBefore(){},replaceChild(){},insertAdjacentHTML(){},querySelector(){return null;},querySelectorAll(){return [];},onclick:null};return elements[id];}
const document={readyState:"complete",getElementById:(id)=>el(id),querySelector:(s)=>el("q:"+s),querySelectorAll:()=>[],createElement:(t)=>el("n:"+t),addEventListener(){},removeEventListener(){},body:el("body"),documentElement:el("html")};
const chart={setOption(){},resize(){},dispose(){},on(){},off(){}};
const echarts={init:()=>chart,registerMap(){},getMap:()=>null,version:"5.5.1"};
const sandbox={window:null,document,echarts,console,setTimeout:()=>0,clearTimeout:()=>{},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Symbol,parseInt,parseFloat,isNaN,isFinite,addEventListener(){},removeEventListener(){},registerPage(){},FILTER:{}};
sandbox.window=sandbox;vm.createContext(sandbox);
["data.js","core/data.js","core/core.js"].forEach(f=>{vm.runInContext(fs.readFileSync(path.join(BASE,f),"utf8"),sandbox,{filename:f});});
// 暴露内部函数：去掉末尾 })(); 并导出
let code=fs.readFileSync(path.join(BASE,"pages","agents.js"),"utf8");
const last=code.lastIndexOf("})();");
code=code.slice(0,last)+"\n;window.__T={applyFilters:applyFilters,renderFilterBar:renderFilterBar,defaultFilters:defaultFilters,normalizeRow:normalizeRow,state:state};})();";
vm.runInContext(code,sandbox,{filename:"agents.js"});
const T=sandbox.__T;

let pass=0,fail=0;
function ok(c,m){ if(c){pass++;console.log("  ✓ "+m);} else {fail++;console.log("  ✗ "+m);} }

// 1) applyFilters 仅按 positive 过滤（不影响其它表，因为默认 null）
const rows=[{name:"a",positiveValue:1,province:"x",calls:5},{name:"b",positiveValue:0,province:"y",calls:3},{name:"c",positiveValue:1,province:"z",calls:0}];
ok(T.applyFilters(rows,{positive:"YES"}).length===2,"positive=YES 仅保留正向(2)");
ok(T.applyFilters(rows,{positive:"NO"}).length===1,"positive=NO 仅保留非正向(1)");
ok(T.applyFilters(rows,{positive:null}).length===3,"positive=null 不过滤(3)");
ok(T.applyFilters(rows,{}).length===3,"无 positive 字段 不过滤(3)");

// 2) renderFilterBar：仅当 opts.positive=true 时渲染“是否正向价值”
const node={filters:T.defaultFilters(),data:[],month:"8月"};
const withPos=T.renderFilterBar("agxCS_",node,{positive:true});
ok(withPos.indexOf("是否正向价值")>=0 && withPos.indexOf('value="YES"')>=0 && withPos.indexOf('value="NO"')>=0,"renderFilterBar(positive:true) 含 是否正向价值/是/否");
const noPos=T.renderFilterBar("agxCS_",node,{});
ok(noPos.indexOf("是否正向价值")<0,"renderFilterBar({}) 不含 是否正向价值（不影响其它表）");

// 3) normalizeRow 映射 positiveValue
const d=sandbox.window.LINGYUN_DATA;
const raw=d.agentMonthly.find(r=>r.positiveValue===1);
const norm=T.normalizeRow(raw);
ok(norm.positiveValue===1,"normalizeRow 正向原始(1) -> 1");
const raw0=d.agentMonthly.find(r=>r.positiveValue===0);
ok(T.normalizeRow(raw0).positiveValue===0,"normalizeRow 非正向(0) -> 0");

// 4) 跟随月份：8月 positive=YES 时，过滤结果应全部是 8月正向行
const aug=d.agentMonthly.filter(r=>r.month==="8月");
const augPos=T.applyFilters(aug,{positive:"YES"});
ok(augPos.length>0 && augPos.every(r=>r.positiveValue===1),"8月 positive=YES -> 全为 8月正向行 ("+augPos.length+")");

console.log("\n结果：通过 "+pass+" / 失败 "+fail);
process.exit(fail?1:0);
