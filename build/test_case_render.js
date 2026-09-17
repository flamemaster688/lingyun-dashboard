const fs = require("fs"), path = require("path"), vm = require("vm");
const BASE = "static";
const files = {
  data: path.join(BASE, "data.js"),
  adapter: path.join(BASE, "core", "data.js"),
  core: path.join(BASE, "core", "core.js"),
  agents: path.join(BASE, "pages", "agents.js")
};
const elements = {};
function el(id){
  if(!elements[id]){
    const e={_h:"",set innerHTML(v){this._h=String(v);},get innerHTML(){return this._h;},set textContent(v){this._t=String(v);},get textContent(){return this._t;},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},getAttribute(){return null;},addEventListener(){},appendChild(){},removeChild(){},insertBefore(){},replaceChild(){},insertAdjacentHTML(){},querySelector(){return null;},querySelectorAll(){return [];},onclick:null};
    e.parentNode=e; // 让 .parentNode.insertBefore 这类调用可用
    elements[id]=e;
  }
  return elements[id];
}
const document={readyState:"complete",getElementById:(id)=>el(id),querySelector:(s)=>el("q:"+s),querySelectorAll:()=>[],createElement:(t)=>el("n:"+t),addEventListener(){},removeEventListener(){},body:el("body"),documentElement:el("html")};
const chart={setOption(){},resize(){},dispose(){},on(){},off(){}};
const echarts={init:()=>chart,registerMap(){},getMap:()=>null,version:"5.5.1"};
const sandbox={window:null,document,echarts,console,setTimeout:()=>0,clearTimeout:()=>{},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Symbol,parseInt,parseFloat,isNaN,isFinite,addEventListener(){},removeEventListener(){}};
sandbox.window=sandbox; vm.createContext(sandbox);

let code = fs.readFileSync(files.agents, "utf-8");
const last = code.lastIndexOf("})();");
code = code.slice(0, last) + "\n;window.__T={renderCaseDetail:renderCaseDetail,renderCurrent:renderCurrent};})();";
[files.data, files.adapter, files.core, files.agents].forEach(f=>{
  if (f === files.agents) vm.runInContext(code, sandbox, {filename:f});
  else vm.runInContext(fs.readFileSync(f,"utf-8"), sandbox, {filename:f});
});

try {
  sandbox.window.__T.renderCaseDetail();
  const html = el("agCaseTable").innerHTML || "";
  const labels = ["总token数","模型计费（元）","提效比率","单笔节约时长","节约人年","节约金额","产生真实价值","是否正向价值"];
  const missing = labels.filter(k=>html.indexOf(k)<0);
  console.log("✓ renderCaseDetail 渲染成功，无异常");
  console.log("案例清单表格 HTML 长度：" + html.length);
  console.log("缺失列标签：" + (missing.length ? missing.join(",") : "无（8列全部渲染）"));
  // 正向价值徽标是否出现（若当月有正向数据）
  const hasBadge = html.indexOf("agx-badge")>=0;
  console.log("表格含徽标渲染：" + (hasBadge?"是":"否（当月可能无正向数据，正常）"));
  process.exit(missing.length?1:0);
} catch(e){
  console.error("✗ 渲染异常：", e && e.stack || e);
  process.exit(1);
}
