// merge_agents_v2.js —— Node 版：把 v2 智能体生成器产物合并进正式 static/data.js
// 用 Function 求值读取（data.js 是合法 JS，但不是严格 JSON），避免 JSON 解析尾差问题。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, "static");
const DATA_JS = path.join(STATIC, "data.js");

const CANDIDATES = [
  path.join(STATIC, "agents_preview_data.js"),
  "/tmp/zipexplore/智能体看板_赵莹交付_20260916/static/agents_preview_data.js",
];
const PREVIEW = CANDIDATES.find((p) => fs.existsSync(p));

function loadJS(p) {
  const code = fs.readFileSync(p, "utf-8");
  // 文件形如： // 注释\n window.LINGYUN_DATA = {...};
  const fn = new Function(
    "var window = {}; var self = window;\n" +
    code +
    "\n; return window.LINGYUN_DATA;"
  );
  return fn();
}

function main() {
  if (!PREVIEW) {
    console.error("✗ 找不到生成器产物 agents_preview_data.js");
    process.exit(1);
  }
  console.log("读取正式 data.js:", DATA_JS);
  const base = loadJS(DATA_JS);
  console.log("读取 v2 生成产物:", PREVIEW);
  const pv = loadJS(PREVIEW);

  base.agentMonthly = pv.agents;                 // 重命名：agents -> agentMonthly
  base.agentCaseCatalog = pv.caseCatalog;
  base.agentLifecycle = pv.agentLifecycle;
  console.log("  ✓ agentMonthly      = " + base.agentMonthly.length + " 条");
  console.log("  ✓ agentCaseCatalog  = " + base.agentCaseCatalog.length + " 条");
  console.log("  ✓ agentLifecycle    = " + Object.keys(base.agentLifecycle).length + " 个实体");

  const pm = pv.meta || {};
  const bm = base.meta || (base.meta = {});
  ["reportMonths", "latestCompleteMonth", "tokenStartMonth", "thresholds", "dataAvailability", "dataQuality"]
    .forEach((k) => { if (k in pm) bm[k] = pm[k]; });
  const gaps = bm.gaps || (bm.gaps = []);
  const note = "智能体 v2（agentMonthly 1—8 月）已并入，由 pages/agents.js v2 读取。";
  if (gaps.indexOf(note) < 0) gaps.push(note);

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const header =
    "// 自动生成（真实数据·智能体 v2 合并 " + stamp + "）。\n" +
    "// 基座数据由 build_real.py / build/fetch-data.py 生成；智能体 v2 域由\n" +
    "// gen_preview_data_v2.py 生成后经 merge_agents_v2.js 并入。请勿手改。\n" +
    "window.LINGYUN_DATA = ";
  fs.writeFileSync(DATA_JS, header + JSON.stringify(base) + ";\n", "utf-8");

  const size = fs.statSync(DATA_JS).size / 1048576;
  console.log("  ✓ 写回 static/data.js（" + size.toFixed(1) + " MB）");

  const TH = bm.thresholds || {};
  const act = TH.activeCalls || 1000;
  const hot = TH.hotCalls || 100000;
  const by = {};
  for (const r of base.agentMonthly) {
    const m = r.month;
    const d = by[m] || (by[m] = { n: 0, calls: 0, act: 0, hot: 0 });
    d.n += 1; d.calls += (r.calls || 0);
    if ((r.calls || 0) > act) d.act += 1;
    if ((r.calls || 0) > hot) d.hot += 1;
  }
  console.log("\n月份  应用数       调用量        活跃  高热度");
  Object.keys(by).sort((a, b) => parseInt(a) - parseInt(b)).forEach((m) => {
    const d = by[m];
    console.log(m.padEnd(5) + String(d.n).padStart(6) + "  " +
      String(d.calls).padStart(12) + "  " + String(d.act).padStart(5) + "  " + String(d.hot).padStart(5));
  });
}
main();
