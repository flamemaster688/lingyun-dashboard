// 把 extract_province_list.py 抽出的 3 个新字段（节约金额 / 产生真实价值 / 是否正向价值）
// 按「月份+应用ID+省份+应用名称+创建人」归一化键，合併进现有 agentMonthly 域。
// 其余字段（调用量、Token、promoScene 等）全部保留，已验收的 KPI 与案例联动不受影响。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_JS = path.join(ROOT, "static", "data.js");
const NEWF = path.join(__dirname, "province_list_newfields.json");

const raw = fs.readFileSync(DATA_JS, "utf8");
const sep = "window.LINGYUN_DATA = ";
const idx = raw.indexOf(sep);
const header = idx >= 0 ? raw.slice(0, idx + sep.length) : "// 智能体数据\n" + sep;

const base = new Function("var window={};" + raw + ";return window.LINGYUN_DATA;")();
const nf = JSON.parse(fs.readFileSync(NEWF, "utf8"));

function normKey(s) { return String(s == null ? "" : s).replace(/\s+/g, ""); }
function monthNo(m) { const x = parseInt(String(m || "").replace(/[^0-9]/g, ""), 10); return isFinite(x) ? x : 99; }

const map = {};
for (const r of nf.rows) map[r.key] = r;

const total = base.agentMonthly.length;
let matched = 0;
for (const rec of base.agentMonthly) {
  const key = [rec.month, normKey(rec.appId), normKey(rec.province), normKey(rec.name), normKey(rec.creator)].join("|");
  const m = map[key];
  if (m) {
    rec.saveAmount = m.saveAmount;
    rec.realValue = m.realValue;
    rec.positiveValue = m.positiveValue;
    matched++;
  } else {
    if (rec.saveAmount === undefined) rec.saveAmount = null;
    if (rec.realValue === undefined) rec.realValue = null;
    if (rec.positiveValue === undefined) rec.positiveValue = 0;
  }
}

// 元数据：确保 1—8 月 agentDetail 可用、latestCompleteMonth 修正
if (base.meta) {
  base.meta.latestCompleteMonth = nf.reportMonths[nf.reportMonths.length - 1];
  if (!base.meta.dataAvailability) base.meta.dataAvailability = {};
  for (const m of nf.reportMonths) {
    if (!base.meta.dataAvailability[m]) {
      base.meta.dataAvailability[m] = { agentDetail: true, token: monthNo(m) >= 6 };
    }
  }
}

fs.writeFileSync(DATA_JS, header + JSON.stringify(base) + ";\n", "utf-8");
console.log("agentMonthly 总量：", total, "｜ 命中匹配：", matched, "｜ 未命中：", total - matched);
console.log("写入：", DATA_JS, "（", (fs.statSync(DATA_JS).size / 1048576).toFixed(1), "MB )");
