const fs = require("fs"), path = require("path"), vm = require("vm");
const BASE = "static";
const files = { data: path.join(BASE,"data.js"), adapter: path.join(BASE,"core","data.js"), core: path.join(BASE,"core","core.js"), agents: path.join(BASE,"pages","agents.js") };
const elements = {};
function el(id){
  if(!elements[id]){
    const e={_h:"",set innerHTML(v){this._h=String(v);},get innerHTML(){return this._h;},set textContent(v){this._t=String(v);},get textContent(){return this._t;},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return null;},addEventListener(){},appendChild(){},removeChild(){},insertBefore(){},replaceChild(){},insertAdjacentHTML(){},querySelector(){return null;},querySelectorAll(){return [];},onclick:null};
    e.parentNode=e; elements[id]=e;
  }
  return elements[id];
}
const document={readyState:"complete",getElementById:(id)=>el(id),querySelector:(s)=>el("q:"+s),querySelectorAll:()=>[],createElement:(t)=>el("n:"+t),addEventListener(){},removeEventListener(){},body:el("body"),documentElement:el("html")};
const chart={setOption(){},resize(){},dispose(){},on(){},off(){}};
const echarts={init:()=>chart,registerMap(){},getMap:()=>null,version:"5.5.1"};
const sandbox={window:null,document,echarts,console,setTimeout:()=>0,clearTimeout:()=>{},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Symbol,parseInt,parseFloat,isNaN,isFinite,addEventListener(){},removeEventListener(){}};
sandbox.window=sandbox; vm.createContext(sandbox);
let code = fs.readFileSync(files.agents,"utf-8");
const last = code.lastIndexOf("})();");
code = code.slice(0,last) + "\n;window.__T={renderAgentTable:renderAgentTable,columnsByKeys:columnsByKeys,CASE_SUMMARY_COLUMN_KEYS:CASE_SUMMARY_COLUMN_KEYS,caseRowsOf:caseRowsOf,state:state};})();";
[files.data,files.adapter,files.core,files.agents].forEach(f=>{ if(f===files.agents) vm.runInContext(code,sandbox,{filename:f}); else vm.runInContext(fs.readFileSync(f,"utf-8"),sandbox,{filename:f}); });
const T=sandbox.window.__T;
T.state.month="8月";
const rows=T.caseRowsOf("promo");
const node={tableState:{page:1,pageSize:10,sortKey:"calls",sortDir:"desc"}, month:"8月"};
const cols=T.columnsByKeys(T.CASE_SUMMARY_COLUMN_KEYS,"8月");
const out=T.renderAgentTable("agxCS_",rows.slice(0,5),node,{columns:cols});
const html=out.html||"";
const labels=["总token数","模型计费（元）","提效比率","单笔节约时长","节约人年","节约金额","产生真实价值","是否正向价值"];
const missing=labels.filter(k=>html.indexOf(k)<0);
console.log("rows(promo,8月):",rows.length,"| 渲染HTML长度:",html.length);
console.log("表头/单元缺失列标签:",missing.length?missing.join(","):"无（8列全部出现）");
const hasYes=html.indexOf(">是<")>=0, hasNo=html.indexOf(">否<")>=0, hasSlash=html.indexOf("/")>=0;
console.log("正向价值展示：含是="+hasYes+", 含否="+hasNo+", 含缺省/="+hasSlash);
process.exit(missing.length?1:0);
