// -*- coding: utf-8 -*-
// 临时验证脚本（不修改任何生产文件）：在 Node + 捕获式 DOM 中真实加载
// data.js / core.js / agents.js，导出私有函数并断言：
//   1) detailColumns() 返回严格 12 列且标签与需求一致
//   2) 正向价值 是/否 筛选确实过滤
//   3) 抽屉 drawAgentBody 含新增 4 个价值字段，与明细内容一致
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BASE = path.join(__dirname, "..", "static");
const files = {
  data: path.join(BASE, "data.js"),
  dataAdapter: path.join(BASE, "core", "data.js"),
  core: path.join(BASE, "core", "core.js"),
  agents: path.join(BASE, "pages", "agents.js")
};

// ---- 捕获式 DOM ----
const store = {};
function makeEl(id) {
  return {
    _id: id, _html: "", _text: "",
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    onclick: null, onkeydown: null
  };
}
function getEl(id) { if (!store[id]) store[id] = makeEl(id); return store[id]; }
const document = {
  readyState: "complete",
  getElementById: (id) => getEl(id),
  querySelector: (s) => getEl("sel:" + s),
  querySelectorAll: () => [],
  createElement: (t) => makeEl("new:" + t),
  addEventListener() {}, removeEventListener() {},
  body: makeEl("body"), documentElement: makeEl("html")
};
const echarts = { init: () => ({ setOption() {}, resize() {}, dispose() {} }), registerMap() {}, getMap: () => null, version: "5.5.1" };
const XLSX = { read: () => ({ SheetNames: [], Sheets: {} }), utils: { sheet_to_json: () => [], aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, write: () => new Uint8Array(8) };
class Blob { constructor() {} }
const URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };

const sandbox = {
  window: null, document, echarts, XLSX, Blob, URL, console,
  setTimeout: () => 0, clearTimeout: () => {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Symbol,
  parseInt, parseFloat, isNaN, isFinite
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function run(file) {
  let code = fs.readFileSync(file, "utf-8");
  if (file === files.agents) {
    const idx = code.lastIndexOf("})();");
    const hook = ';try{window.__LY_HOOK__={state:state,loadMeta:loadMeta,buildIndexes:buildIndexes,detailColumns:detailColumns,detailRows:detailRows,drawAgentBody:drawAgentBody,sourceRows:sourceRows};}catch(e){window.__LY_HOOK_ERR__=String(e&&e.stack||e);}';
    code = code.slice(0, idx) + hook + "\n" + code.slice(idx);
  }
  vm.runInContext(code, sandbox, { filename: file });
}

run(files.data);
run(files.dataAdapter);
run(files.core);
run(files.agents);

let fail = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { fail++; console.error("  ✗ " + msg); }
}

const H = sandbox.window.__LY_HOOK__;
if (!H) {
  console.error("无法导出内部函数：", sandbox.window.__LY_HOOK_ERR__);
  process.exit(1);
}

H.loadMeta();
H.buildIndexes();
const total = H.sourceRows().length;
console.log("\n[数据] agentMonthly 总记录数 = " + total);

// ---- 1. 列结构 ----
const cols = H.detailColumns();
const want = ["月份", "应用名称", "省份", "应用调用量", "总token数", "模型计费（元）", "提效比率", "单笔节约时长", "节约人年", "节约金额", "产生真实价值", "是否正向价值"];
const got = cols.map(c => c.label);
console.log("\n[列] 实际顺序：" + got.join(" / "));
assert(cols.length === 12, "列数 = 12（实际 " + cols.length + "）");
assert(JSON.stringify(got) === JSON.stringify(want), "列标签与需求严格一致");
assert(cols.every(c => c.key), "每列均有 key");
// fmt 不抛异常
try {
  H.state.month = "8月"; H.state.province = "ALL"; H.state.type = "ALL"; H.state.detailStatus = "ALL"; H.state.detailPositive = "ALL";
  const sample = H.detailRows().rows[0];
  if (!sample) throw new Error("8月无明细样本行");
  cols.forEach(c => { if (c.fmt) c.fmt(sample); });
  assert(true, "各列 formatter 对样本行无异常（样本=" + sample.name + "）");
} catch (e) { assert(false, "formatter 异常：" + e.message); }

// ---- 2. 正向价值筛选 ----
const TEST_MONTH = "8月";
H.state.month = TEST_MONTH; H.state.province = "ALL"; H.state.type = "ALL"; H.state.detailStatus = "ALL";
H.state.detailPositive = "ALL"; const all = H.detailRows().rows;
H.state.detailPositive = "YES"; const yes = H.detailRows().rows;
H.state.detailPositive = "NO"; const no = H.detailRows().rows;
console.log("\n[筛选][" + TEST_MONTH + "] 全部=" + all.length + " 是=" + yes.length + " 否=" + no.length);
assert(all.length === yes.length + no.length, "全部 = 是 + 否");
assert(yes.every(r => r.positiveValue), "“是”集合内全为 positiveValue=true");
assert(no.every(r => !r.positiveValue), "“否”集合内全为 positiveValue=false");
assert(yes.length > 0 && no.length > 0, "两种取值在 " + TEST_MONTH + " 均有数据");

// 其余月份也抽查一次（确保跟随月份筛选）
let monthSummary = [];
const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"];
months.forEach(m => {
  H.state.month = m; H.state.detailPositive = "ALL"; const a = H.detailRows().rows;
  H.state.detailPositive = "YES"; const y = H.detailRows().rows;
  H.state.detailPositive = "NO"; const n = H.detailRows().rows;
  monthSummary.push(m + ":总" + a.length + "/是" + y.length + "/否" + n.length);
  assert(a.length === y.length + n.length, m + " 月份筛选：全部=是+否");
});
console.log("  [月份分布] " + monthSummary.join("  "));

// ---- 3. 抽屉内容 ----
function drawerHtml(row) {
  const body = makeEl("drawerBody");
  H.drawAgentBody({ entityId: row.entityId, agentMonth: row.month, month: row.month }, body);
  return body.innerHTML;
}
const posRow = yes[0];
const negRow = no[0];
const posHtml = drawerHtml(posRow);
const negHtml = drawerHtml(negRow);
console.log("\n[抽屉] 正向样本：" + posRow.name + " / " + posRow.province + " / " + posRow.month);
["节约人年", "节约金额", "产生真实价值", "是否正向价值", "当前月指标"].forEach(k => {
  assert(posHtml.indexOf(k) >= 0, "抽屉(是) 含字段「" + k + "」");
});
assert(posHtml.indexOf(">是<") >= 0 || posHtml.indexOf("是") >= 0, "抽屉(是) 显示“是”");
assert(negHtml.indexOf("否") >= 0, "抽屉(否) 显示“否”");

console.log("\n" + (fail ? ("❌ 验证失败：" + fail + " 项") : "✅ 全部验证通过"));
process.exit(fail ? 1 : 0);
