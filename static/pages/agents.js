/* pages/agents.js — 智能体分析页（负责人：羽琪）
 *
 * 交付红线：只改本文件 / agents.data-source.json / build 下脚本与预览页；
 *   不改 core/、index.html、style.v6.css、data.js、其他页面 JS、ECharts vendor。
 * 取数红线：只通过 LY.data / V 读取；不 fetch、不直连 Excel、不联网；不使用 tracking 代理调用量。
 * 数据来源：【合】灵运BI重要数据_智能体分类_20260902.xlsx → 智能体清单（各省）A1:AH（34列，按表头名映射）
 *
 * ---------- 0901 改版要点 ----------
 * 1. 首屏固定 5 张 KPI；不含 ROI、不含节约人年、不含成功率/响应时长。
 * 2. 「高性价比」统一改为「低Token高提效」观察模块，只比单次调用Token与同类中位数，不计算 ROI。
 * 3. Token 自 6 月起统计（meta.tokenStartMonth），1—5 月显示结构化空状态，不降级、不补 0、不自动跳月。
 * 4. 统一三级下钻：页面交叉筛选 → 右侧抽屉 → 单应用档案；全局只有一个抽屉根节点，用状态栈管理。
 * 5. 所有下钻表统一使用 FULL_AGENT_COLUMNS 全量列 + 统一筛选条（调用量与案例标签为硬性要求）。
 * 6. 全网趋势改为四轨同步趋势图，不再使用双 Y 轴柱线组合。
 * 7. 省份全景矩阵固定关键列，单元格与省份名均可下钻，不在主页面内嵌清单。
 * 8. 支持 1—8 月框架，缺失月份显示「待接入」，图表用 null 断线。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "agents", title: "智能体", icon: "◎", order: 2, owner: "羽琪",
    render: function () { renderAgents(); }
  });

  /* ==================================================================
   * 一、常量与状态
   * ================================================================== */
  var DEFAULT_TOKEN_START = "6月";
  var REPORT_FALLBACK = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"];
  var PAGE_SIZE = 50;

  var state = {
    month: "", province: "ALL", type: "ALL",
    focus: "hot", caseType: "promo",
    panoramaRankBy: "calls", panoramaDim: "operation",
    detailKeyword: "", detailStatus: "ALL", detailSort: "calls",
    selectedTypeFromChart: null,
    drillStack: [], drawerOpen: false
  };

  var META = {}, THRESH = { activeCalls: 1000, hotCalls: 100000, highEffRatio: 0.30 };
  var TOKEN_START = DEFAULT_TOKEN_START;
  var REPORT_MONTHS = REPORT_FALLBACK.slice();

  var _rows = null, _cases = null, _life = null;
  var _months = null, _provinces = null;
  var _idxEntity = null, _idxProv = null, _idxMonth = null, _idxProvMonth = null;
  var charts = {};
  var built = false, unified = false;
  var _lastFocusEl = null, _scrollLockY = 0;

  /* ==================================================================
   * 二、基础工具
   * ================================================================== */
  function byId(id) { return document.getElementById(id); }
  function val(v) { return v == null ? "" : String(v).trim(); }
  function num(v) {
    if (v == null || v === "" || v === "/" || v === "暂无数据") return null;
    var n = Number(String(v).replace(/,/g, "").replace(/%/g, ""));
    return isFinite(n) ? n : null;
  }
  function flag(v) { return v === true || v === 1 || v === "1" || v === "是" || v === "Y" || v === "true"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>\"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtInt(n) { return n == null || isNaN(n) ? "/" : Math.round(n).toLocaleString("zh-CN"); }
  function fmtWan(n) {
    if (n == null || isNaN(n)) return "/";
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + "亿";
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + "万";
    return fmtInt(n);
  }
  function fmtPct(n) { return n == null || !isFinite(n) ? "/" : (n * 100).toFixed(1) + "%"; }
  function fmtNum(n, d) { return n == null || !isFinite(n) ? "/" : Number(n).toFixed(d == null ? 0 : d); }
  function fmtTok(n) {
    if (n == null || isNaN(n)) return "/";
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + "亿";
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + "万";
    return fmtInt(n);
  }
  function dash(n) { return n == null || isNaN(n) ? "/" : String(n); }
  function monthNo(m) {
    var x = parseInt(String(m || "").replace(/[^0-9]/g, ""), 10);
    return isFinite(x) ? x : 99;
  }
  function median(arr) {
    var a = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] != null && isFinite(arr[i])) a.push(arr[i]);
    if (!a.length) return null;
    a.sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  /* 上升红、下降绿、持平灰 */
  function deltaSpan(delta, text) {
    var c = delta > 0 ? "#ef4444" : delta < 0 ? "#22c55e" : "#6b7280";
    return '<span style="color:' + c + ';font-weight:750">' + text + '</span>';
  }
  function fmtMom(pct) {
    if (pct == null || !isFinite(pct)) return '<span style="color:#6b7280">无上月可比</span>';
    return "环比 " + deltaSpan(pct, (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%");
  }
  function normKey(s) { return String(s == null ? "" : s).replace(/\s+/g, ""); }
  function optionalValue(s) {
    var x = val(s);
    return /^(--|—|\/|-)$/.test(x) ? "" : x;
  }

  /* ==================================================================
   * 三、数据层
   * ================================================================== */
  function pickDomain(names) {
    for (var i = 0; i < names.length; i++) {
      if (window.LY && LY.data && typeof LY.data.domain === "function") {
        var d = LY.data.domain(names[i]);
        if (Array.isArray(d) && d.length) return d;
        if (d && !Array.isArray(d) && typeof d === "object") return d;
      }
      if (window.V && Array.isArray(V[names[i]]) && V[names[i]].length) return V[names[i]];
      if (window.V && V[names[i]] && typeof V[names[i]] === "object" && !Array.isArray(V[names[i]])) return V[names[i]];
      var g = window[names[i]];
      if (Array.isArray(g) && g.length) return g;
      if (g && typeof g === "object" && !Array.isArray(g)) return g;
    }
    return null;
  }
  function toRatio(v) {
    var n = num(v);
    if (n == null) return null;
    return n > 1 ? n / 100 : n;
  }
  function normalizeRow(r) {
    var calls = num(r.calls != null ? r.calls : r["应用调用量"]) || 0;
    var eff = toRatio(r.effRatio != null ? r.effRatio : r["提效比率"]);
    var prov = val(r.province != null ? r.province : r["省份"]) || "未标注";
    var name = val(r.name != null ? r.name : r["应用名称"]);
    var status = val(r.status != null ? r.status : r["应用状态"]) || "未标注";
    var row = {
      entityId: val(r.entityId) || ("K:" + normKey(prov) + "|" + normKey(name) + "|" + normKey(val(r.creator))),
      appId: optionalValue(r.appId != null ? r.appId : r["应用ID"]) || null,
      month: val(r.month != null ? r.month : r["月份"]),
      province: prov,
      creator: val(r.creator != null ? r.creator : r["创建人"]),
      createdAt: val(r.createdAt != null ? r.createdAt : r["创建时间"]),
      name: name,
      description: val(r.description != null ? r.description : r["应用说明"]),
      type: val(r.type != null ? r.type : r["应用类型"]) || "其他",
      tags: optionalValue(r.tags != null ? r.tags : r["应用标签"]),
      servicePhase: optionalValue(r.servicePhase != null ? r.servicePhase : r["服务环节大分类"]) || null,
      appScene: optionalValue(r.appScene != null ? r.appScene : r["应用场景小分类"]) || null,
      status: status,
      calls: calls,
      tokens: num(r.tokens != null ? r.tokens : r["总Token数"]),
      busyTokens: num(r.busyTokens != null ? r.busyTokens : r["忙时总Token数"]),
      idleTokens: num(r.idleTokens != null ? r.idleTokens : r["闲时总Token数"]),
      modelCost: num(r.modelCost != null ? r.modelCost : r["模型计费（元）"]),
      busyCost: num(r.busyCost != null ? r.busyCost : r["忙时模型计费（元）"]),
      idleCost: num(r.idleCost != null ? r.idleCost : r["闲时模型计费（元）"]),
      hasCalls: r.hasCalls != null ? (flag(r.hasCalls) ? 1 : 0) : (calls > 0 ? 1 : 0),
      isActive: flag(r.isActive) ? 1 : 0,
      isHighEff: flag(r.isHighEff) ? 1 : 0,
      isHot: flag(r.isHot) ? 1 : 0,
      isPromo: flag(r.isPromo) ? 1 : 0,
      isExcellent: flag(r.isExcellent) ? 1 : 0,
      isBiweek: flag(r.isBiweek) ? 1 : 0,
      effRatio: eff,
      saveSec: num(r.saveSec != null ? r.saveSec : r["单笔节约时长"]),
      personYear: num(r.personYear != null ? r.personYear : r["节约人年"]),
      saveAmount: num(r.saveAmount != null ? r.saveAmount : r["节约金额"]),
      realValue: num(r.realValue != null ? r.realValue : r["产生真实价值"]),
      isMarketplace: r.isMarketplace == null ? null : (flag(r.isMarketplace) ? 1 : 0),
      copyCount: num(r.copyCount != null ? r.copyCount : r["复制量"]) || 0,
      isLLM: flag(r.isLLM) ? 1 : 0,
      promoScene: val(r.promoScene),
      positiveValue: flag(r.positiveValue != null ? r.positiveValue : r["是否正向价值"]) ? 1 : 0
    };
    /* Token 双重校验：早于采集起点一律视为不可用，防止源表残值外泄 */
    if (monthNo(row.month) < monthNo(TOKEN_START)) {
      row.tokens = row.busyTokens = row.idleTokens = null;
      row.modelCost = row.busyCost = row.idleCost = null;
    }
    /* 月度明细中的每一行都代表当月已上线应用；源表“应用状态”仅作原始信息展示，禁止参与指标口径。 */
    row.isOnline = true;
    row.tokensPerCall = (row.tokens != null && row.calls > 0) ? row.tokens / row.calls : null;
    return row;
  }
  function sourceRows() {
    if (_rows) return _rows;
    var src = pickDomain(["agentMonthly", "agents"]) || [];
    var seen = {};
    TOKEN_START = val(META.tokenStartMonth) || DEFAULT_TOKEN_START;
    if (!monthNo(TOKEN_START) || monthNo(TOKEN_START) > 90) TOKEN_START = DEFAULT_TOKEN_START;
    _rows = [];
    for (var i = 0; i < src.length; i++) {
      var r = normalizeRow(src[i]);
      if (!r.month || !r.name) continue;
      _rows.push(r);
    }
    return _rows;
  }
  function caseCatalog() {
    if (_cases) return _cases;
    var src = pickDomain(["agentCaseCatalog", "caseCatalog", "agentCases"]) || [];
    _cases = [];
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      var kinds = Array.isArray(c.kinds) ? c.kinds
        : String(c.kinds || c["案例类型"] || "").split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!val(c.name || c["应用名称"])) continue;
      _cases.push({
        kinds: kinds,
        promoScene: val(c.promoScene != null ? c.promoScene : c["推广场景"]),
        province: val(c.province != null ? c.province : c["省份"]),
        name: val(c.name != null ? c.name : c["应用名称"]),
        creator: val(c.creator != null ? c.creator : c["创建人"]),
        createdAt: val(c.createdAt != null ? c.createdAt : c["创建时间"]),
        monthlyPersonYear: c.monthlyPersonYear || {}
      });
    }
    return _cases;
  }
  function lifecycle() {
    if (_life) return _life;
    _life = pickDomain(["agentLifecycle"]) || {};
    return _life;
  }
  function loadMeta() {
    var m = null;
    if (window.LY && LY.data && LY.data.meta) m = LY.data.meta;
    if (!m && window.LINGYUN_DATA && window.LINGYUN_DATA.meta) m = window.LINGYUN_DATA.meta;
    if (!m && window.V && V.meta) m = window.V.meta;
    META = m || {};
    THRESH.activeCalls = num(META.thresholds && META.thresholds.activeCalls) || 1000;
    THRESH.hotCalls = num(META.thresholds && META.thresholds.hotCalls) || 100000;
    THRESH.highEffRatio = num(META.thresholds && META.thresholds.highEffRatio) || 0.30;
    REPORT_MONTHS = (Array.isArray(META.reportMonths) && META.reportMonths.length)
      ? META.reportMonths.slice() : REPORT_FALLBACK.slice();
  }
  /* 只有源表应用ID齐全时，才允许跨月推断「新增/退出」。
     当前源表应用ID 100% 缺失，按「省份+名称+创建人」回退关联，
     据此得出的新增/退出属于伪结论，一律不展示（规范 24 用例F）。 */
  function identityReliable() {
    var q = META.dataQuality || {};
    return q.missingAppIdRows === 0;
  }
  function buildIndexes() {
    if (_idxEntity) return;
    _idxEntity = {}; _idxProv = {}; _idxMonth = {}; _idxProvMonth = {};
    var rs = sourceRows();
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      (_idxEntity[r.entityId] || (_idxEntity[r.entityId] = {}))[r.month] = r;
      (_idxProv[r.province] || (_idxProv[r.province] = [])).push(r);
      (_idxMonth[r.month] || (_idxMonth[r.month] = [])).push(r);
      var pm = r.province + "|" + r.month;
      (_idxProvMonth[pm] || (_idxProvMonth[pm] = [])).push(r);
    }
  }
  function months() {
    if (_months) return _months;
    var seen = {}, out = [];
    var rs = sourceRows();
    for (var i = 0; i < rs.length; i++) if (!seen[rs[i].month]) { seen[rs[i].month] = 1; out.push(rs[i].month); }
    _months = out.sort(function (a, b) { return monthNo(a) - monthNo(b); });
    return _months;
  }
  function provinces() {
    if (_provinces) return _provinces;
    var seen = {}, out = [];
    var rs = sourceRows();
    for (var i = 0; i < rs.length; i++) if (!seen[rs[i].province]) { seen[rs[i].province] = 1; out.push(rs[i].province); }
    _provinces = out.sort(function (a, b) { return a.localeCompare(b, "zh-CN"); });
    return _provinces;
  }
  function rowsOfMonth(m) { buildIndexes(); return _idxMonth[m] || []; }
  function rowsOfProvinceMonth(p, m) { buildIndexes(); return _idxProvMonth[p + "|" + m] || []; }
  function historyOf(row) { buildIndexes(); return _idxEntity[row.entityId] || {}; }
  function prevMonthOf(m) {
    var mm = months(), i = mm.indexOf(m);
    return i > 0 ? mm[i - 1] : null;
  }
  /* 数据可用性：某月应用级明细是否接入 */
  function monthAvailable(m) {
    if (META.dataAvailability && META.dataAvailability[m]) return !!META.dataAvailability[m].agentDetail;
    return months().indexOf(m) >= 0;
  }
  function tokenAvailable(m) {
    if (monthNo(m) < monthNo(TOKEN_START)) return false;
    if (META.dataAvailability && META.dataAvailability[m]) return !!META.dataAvailability[m].token;
    return months().indexOf(m) >= 0;
  }
  function scoped(opts) {
    opts = opts || {};
    var m = opts.month || state.month;
    var p = opts.province === undefined ? state.province : opts.province;
    var t = opts.type === undefined ? state.type : opts.type;
    var rs = rowsOfMonth(m) || [];
    var out = [];
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (p && p !== "ALL" && r.province !== p) continue;
      if (t && t !== "ALL" && r.type !== t) continue;
      out.push(r);
    }
    return out;
  }
  function stats(list) {
    var calls = 0, online = 0, active = 0, hot = 0, high = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      calls += r.calls || 0;
      online++;
      if (r.isActive) active++;
      if (r.isHot) hot++;
      if (r.isHighEff) high++;
    }
    return { rows: list, calls: calls, online: online, active: active, hot: hot, high: high };
  }
  function momPct(cur, prev) {
    if (prev == null || !isFinite(prev) || prev === 0) return null;
    return (cur - prev) / Math.abs(prev) * 100;
  }
  function diffText(cur, prev) {
    if (prev == null) return '<span style="color:#6b7280">无上月可比</span>';
    return "较上月 " + deltaSpan(cur - prev, (cur - prev >= 0 ? "+" : "") + fmtInt(cur - prev));
  }
  function caseLabels(r) {
    var a = [];
    if (r.isPromo) a.push("推广");
    if (r.isExcellent) a.push("优秀");
    if (r.isBiweek) a.push("双周");
    return a.length ? a.join(" / ") : "无";
  }
  /* 活跃状态：合并「是否有调用」语义，不单独占列 */
  function activityText(r) {
    if (!r.hasCalls) return "无调用";
    if (r.isHighEff) return "活跃且高提效";
    if (r.isHot) return "高热度";
    if (r.isActive) return "活跃";
    return "未活跃";
  }
  function activityValue(r) {
    if (!r.hasCalls) return 0;
    if (r.isHighEff) return 4;
    if (r.isHot) return 3;
    if (r.isActive) return 2;
    return 1;
  }
  function entryMonthOf(r, kind) {
    var lc = lifecycle()[r.entityId];
    if (!lc) return null;
    if (kind === "promo") return lc.promoEntryMonth || null;
    if (kind === "excellent") return lc.excellentEntryMonth || null;
    if (kind === "biweek") return lc.biweekEntryMonth || null;
    return lc.promoEntryMonth || lc.excellentEntryMonth || lc.biweekEntryMonth || null;
  }
  function callsMomOf(r) {
    var pm = prevMonthOf(r.month);
    if (!pm) return null;
    var h = historyOf(r);
    var p = h[pm];
    if (!p || !p.calls) return null;
    return (r.calls - p.calls) / Math.abs(p.calls) * 100;
  }

  /* ==================================================================
   * 四、本页局部样式（禁止污染公共类名；只作用于 .agx-*）
   * ================================================================== */
  var STYLE_ID = "agxStyle0901";
  function scopedStyle() {
    if (byId(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      ".agx-num{text-align:right;font-variant-numeric:tabular-nums}",
      ".agx-drawer-mask{position:fixed;inset:0;background:rgba(15,26,43,.45);z-index:900;display:none}",
      ".agx-drawer-mask.on{display:block}",
      ".agx-drawer{position:fixed;top:0;right:0;height:100vh;width:min(920px,92vw);background:#fff;",
      " box-shadow:-12px 0 40px rgba(15,26,43,.22);display:flex;flex-direction:column;",
      " transform:translateX(100%);transition:transform .26s cubic-bezier(.22,.61,.36,1);z-index:901}",
      ".agx-drawer.wide{width:min(1360px,98vw)}",
      ".agx-drawer-mask.on .agx-drawer{transform:translateX(0)}",
      ".agx-dh{padding:13px 18px;border-bottom:1px solid #e2e8f0;background:#f8fbff;flex:0 0 auto}",
      ".agx-dcrumbs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:#6b7280;margin-bottom:6px}",
      ".agx-dcrumbs button{border:none;background:none;color:#3b82f6;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px}",
      ".agx-dcrumbs button:hover{background:#eff6ff;text-decoration:underline}",
      ".agx-dcrumbs span.sep{color:#c3ccd6}",
      ".agx-dtitle{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".agx-dtitle b{font-size:16px;color:#1f2937}",
      ".agx-dtitle .scope{font-size:11px;color:#6b7280}",
      ".agx-dbody{flex:1 1 auto;overflow:auto;padding:14px 18px 26px}",
      ".agx-x{margin-left:auto;border:1px solid #cbd7e4;background:#fff;color:#476078;border-radius:8px;",
      " min-width:30px;height:30px;cursor:pointer;font-size:16px;line-height:1}",
      ".agx-x:hover{background:#eef4fb;color:#2563eb}",
      ".agx-back{border:1px solid #cbd7e4;background:#fff;color:#476078;border-radius:7px;padding:4px 11px;",
      " font-size:12px;font-weight:650;cursor:pointer}",
      ".agx-back:hover{background:#eef4fb;color:#2563eb}",
      ".agx-back[disabled]{opacity:.45;cursor:not-allowed}",
      ".agx-exp{border:1px solid #c7d7ea;background:#fff;color:#2563eb;border-radius:7px;padding:4px 11px;",
      " font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}",
      ".agx-exp:hover{background:#eff6ff;border-color:#3b82f6}",
      ".agx-exp[disabled]{color:#9aa8b8;border-color:#dbe3ec;background:#f6f8fa;cursor:not-allowed}",
      ".agx-seg{display:flex;gap:7px;flex-wrap:wrap}",
      ".agx-seg button{border:1px solid #cbd7e4;background:#fff;color:#526176;border-radius:16px;padding:5px 11px;",
      " cursor:pointer;font-size:12px;font-weight:650;transition:transform .18s ease,background .18s ease}",
      ".agx-seg button:hover{transform:scale(1.04);border-color:#3b82f6;color:#2563eb}",
      ".agx-seg button:active{transform:scale(.96)}",
      ".agx-seg button.on{border-color:#3b82f6;background:#eff6ff;color:#2563eb}",
      ".agx-fbar{display:grid;grid-template-columns:minmax(190px,1.35fr) repeat(4,minmax(120px,1fr));gap:9px 10px;align-items:end;padding:12px 13px;border:1px solid #e2e8f0;",
      " border-radius:11px;background:#f8fbff;margin-bottom:11px}",
      ".agx-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".agx-field>span{font-size:11px;color:#64748b;font-weight:650}",
      ".agx-fbar .lb{font-size:11px;color:#6b7280}",
      ".agx-fbar input[type=search],.agx-fbar input[type=number],.agx-fbar select{height:29px;border:1px solid #c7d7ea;",
      " border-radius:7px;padding:0 8px;font-size:12px;background:#fff;color:#1f2937;width:100%;min-width:0}",
      ".agx-fbar input[type=search]{width:100%}",
      ".agx-fbar input[type=number]{width:74px}",
      ".agx-chip{border:1px solid #cbd7e4;background:#fff;color:#526176;border-radius:13px;padding:3px 10px;",
      " font-size:11px;font-weight:650;cursor:pointer}",
      ".agx-chip.on{border-color:#3b82f6;background:#eff6ff;color:#2563eb}",
      ".agx-chipset{display:flex;gap:5px;flex-wrap:wrap;align-items:center}",
      ".agx-rst{border:1px solid #dbe3ec;background:#fff;color:#6b7280;border-radius:7px;padding:4px 11px;",
      " font-size:11px;font-weight:650;cursor:pointer}",
      ".agx-rst:hover{background:#f6f8fa;color:#1f2937}",
      ".agx-scope-tag{display:inline-flex;align-items:center;gap:5px;background:#eff6ff;border:1px solid #c7dbfb;",
      " color:#2563eb;border-radius:13px;padding:3px 9px;font-size:11px;font-weight:700}",
      ".agx-scope-tag button{border:none;background:none;color:#2563eb;cursor:pointer;font-weight:800;padding:0 2px}",
      ".agx-tblwrap{overflow:auto;border:1px solid #dde5ee;border-radius:10px;background:#fff;max-height:62vh}",
      ".agx-tblwrap.short{max-height:420px}",
      ".tbl.agx-tbl{font-size:12px}",
      ".tbl.agx-tbl th,.tbl.agx-tbl td{padding:7px 9px;white-space:nowrap}",
      ".tbl.agx-tbl thead th{position:sticky;top:0;z-index:3;background:#f4f8fd}",
      ".tbl.agx-tbl thead tr.agx-gh th{background:#eef4fb;color:#476078;text-align:center;font-size:11px;top:0;z-index:4}",
      ".tbl.agx-tbl .agx-fix{position:sticky;left:0;background:#fff;z-index:2}",
      ".tbl.agx-tbl thead .agx-fix{background:#f4f8fd;z-index:4}",
      ".tbl.agx-tbl .agx-fix2{position:sticky;left:132px;background:#fff;z-index:2}",
      ".tbl.agx-tbl thead .agx-fix2{background:#f4f8fd;z-index:4}",
      ".tbl.agx-tbl tbody tr:hover{background:#f9fbfe;cursor:pointer}",
      ".tbl.agx-tbl tbody tr:hover .agx-fix,.tbl.agx-tbl tbody tr:hover .agx-fix2{background:#f9fbfe}",
      ".agx-th-sort{cursor:pointer;user-select:none}",
      ".agx-th-sort:hover{color:#2563eb}",
      ".agx-pager{display:flex;align-items:center;gap:8px;justify-content:flex-end;margin-top:9px;font-size:12px;color:#6b7280}",
      ".agx-pager button{border:1px solid #dbe3ec;background:#fff;color:#476078;border-radius:7px;padding:3px 10px;cursor:pointer;font-size:12px}",
      ".agx-pager button[disabled]{opacity:.45;cursor:not-allowed}",
      ".agx-empty{padding:30px 16px;text-align:center;color:#94a3b8;font-size:13px;line-height:1.9}",
      ".agx-note{font-size:12px;color:#6b7280;line-height:1.7;margin-top:7px}",
      ".agx-token-na{background:#f8fafc;border:1px dashed #d6e0ec;border-radius:9px;padding:12px 14px;",
      " color:#64748b;font-size:12px;line-height:1.8}",
      ".agx-click{cursor:pointer}",
      ".agx-click:hover{text-decoration:underline;color:#2563eb}",
      ".agx-cell{cursor:pointer;text-align:center;font-variant-numeric:tabular-nums;font-weight:650}",
      ".agx-cell:hover{outline:2px solid #3b82f6;outline-offset:-2px}",
      ".agx-cell.zero{color:#c3ccd6;font-weight:400;cursor:default}",
      ".agx-cell.zero:hover{outline:none}",
      ".agx-mx{border-collapse:collapse;font-size:12px;background:#fff;width:100%}",
      ".agx-mx th,.agx-mx td{padding:6px 8px;border-bottom:1px solid #eef2f6;border-right:1px solid #eef2f6;white-space:nowrap}",
      ".agx-mx thead th{background:#f4f8fd;color:#476078;font-weight:700;font-size:11px;position:sticky;top:0;z-index:3}",
      ".agx-mx tbody th{position:sticky;left:0;background:#f4f8fd;text-align:left;z-index:2;font-weight:700;color:#1f2937}",
      ".agx-mx tbody td.agx-fix{position:sticky;background:#fff;z-index:1}",
      ".agx-mx tfoot td,.agx-mx tfoot th{background:#f8fbff;font-weight:700;border-top:2px solid #dde5ee}",
      ".agx-kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 1px 3px rgba(15,26,43,.06);",
      " padding:14px 15px;position:relative;overflow:hidden;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}",
      ".agx-kpi:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(15,26,43,.12)}",
      ".agx-kpi::before{content:\"\";position:absolute;left:0;top:0;right:0;height:4px;background:#3b82f6}",
      ".agx-kpi .lb{font-size:12px;color:#6b7280}",
      ".agx-kpi .val{font-size:25px;font-weight:800;line-height:1.35;color:#1f2937;font-variant-numeric:tabular-nums}",
      ".agx-kpi .sub{font-size:11px;color:#6b7280;min-height:17px}",
      ".agx-kpi .go{font-size:11px;color:#3b82f6;font-weight:700;margin-top:5px}",
      ".agx-kpi.clickable{cursor:pointer}",
      ".agx-kpi.clickable::before{background:#dc2626}",
      ".agx-kpi.clickable:hover{box-shadow:0 8px 22px rgba(220,38,38,.18)}",
      ".agx-section-card{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:16px 18px;box-shadow:0 3px 12px rgba(15,35,70,.045)}",
      ".agx-section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}",
      ".agx-section-head b{font-size:15px;color:#172033}",
      ".agx-visual-grid{display:grid;grid-template-columns:minmax(0,42%) minmax(0,58%);gap:14px}",
      ".agx-visual-card{border:1px solid #e8edf4;border-radius:12px;background:linear-gradient(180deg,#fff 0%,#fbfdff 100%);padding:12px 14px;min-width:0}",
      ".agx-visual-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:750;color:#334155;margin-bottom:4px}",
      ".agx-insights{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 12px}",
      ".agx-insight{display:inline-flex;align-items:center;gap:5px;border:1px solid #dce6f2;background:#f7faff;border-radius:999px;padding:5px 10px;font-size:11px;color:#526176}",
      ".agx-insight b{color:#1f3b64;font-size:12px}",
      ".agx-primary-btn{border:1px solid #2f6fed;background:#2f6fed;color:#fff;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer}",
      ".agx-primary-btn:hover{background:#245dcc;box-shadow:0 4px 12px rgba(47,111,237,.22)}",
      ".agx-summary-note{font-size:11px;color:#718096;line-height:1.65}",
      ".agx-trendhint{font-size:11px;color:#94a3b8;margin-top:4px}",
      ".agx-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:650}",
      "@media (max-width:1100px){.agx-fbar{grid-template-columns:repeat(3,minmax(120px,1fr))}}",
      "@media (max-width:900px){.agx-drawer{width:100vw}.agx-fbar{grid-template-columns:repeat(2,minmax(120px,1fr))}.agx-fbar input[type=search]{width:100%}.agx-visual-grid{grid-template-columns:1fr}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* ==================================================================
   * 五、FULL_AGENT_COLUMNS —— 所有下钻表统一引用，入口只决定默认排序/筛选
   * ================================================================== */
  function naText() { return "—"; }
  var FULL_AGENT_COLUMNS = [
    /* 第一组：核心识别和经营表现（左侧固定） */
    { key: "name", label: "应用名称", group: "核心识别", fix: 1, sort: function (r) { return r.name; },
      fmt: function (r) { return '<b>' + esc(r.name) + '</b>'; } },
    { key: "province", label: "省份", group: "核心识别", fix: 2, sort: function (r) { return r.province; },
      fmt: function (r) { return esc(r.province); } },
    { key: "calls", label: "月调用量", group: "核心识别", align: "right", num: true, sort: function (r) { return r.calls; },
      fmt: function (r) { return fmtInt(r.calls); } },
    { key: "callsMom", label: "调用量环比", group: "核心识别", align: "right", sort: function (r) { var v = callsMomOf(r); return v == null ? -999 : v; },
      fmt: function (r) { var v = callsMomOf(r); return v == null ? '<span style="color:#94a3b8">/</span>' : deltaSpan(v, (v >= 0 ? "+" : "") + v.toFixed(1) + "%"); } },
    { key: "activity", label: "活跃状态", group: "核心识别", sort: function (r) { return activityValue(r); },
      fmt: function (r) { return activityText(r); } },
    { key: "isHot", label: "高热度", group: "核心识别", sort: function (r) { return r.isHot; },
      fmt: function (r) { return r.isHot ? "是" : "否"; } },
    { key: "effRatio", label: "提效比率", group: "核心识别", align: "right", num: true, sort: function (r) { return r.effRatio == null ? -1 : r.effRatio; },
      fmt: function (r) { return r.effRatio == null ? '<span style="color:#94a3b8">/</span>' : fmtPct(r.effRatio); } },
    { key: "saveSec", label: "单笔节约时长", group: "核心识别", align: "right", num: true, sort: function (r) { return r.saveSec == null ? -1 : r.saveSec; },
      fmt: function (r) { return r.saveSec == null ? '<span style="color:#94a3b8">/</span>' : fmtNum(r.saveSec, 1) + "秒"; } },
    { key: "isHighEff", label: "活跃且高提效", group: "核心识别", sort: function (r) { return r.isHighEff; },
      fmt: function (r) { return r.isHighEff ? "是" : "否"; } },
    { key: "caseTags", label: "案例标签", group: "核心识别", sort: function (r) { return r.isPromo * 4 + r.isExcellent * 2 + r.isBiweek; },
      fmt: function (r) { var t = caseLabels(r); return t === "无" ? '<span style="color:#94a3b8">无</span>' : t; } },

    /* 第二组：案例和业务场景 */
    { key: "isPromo", label: "是否推广", group: "案例与场景", sort: function (r) { return r.isPromo; }, fmt: function (r) { return r.isPromo ? "是" : "否"; } },
    { key: "isExcellent", label: "是否优秀", group: "案例与场景", sort: function (r) { return r.isExcellent; }, fmt: function (r) { return r.isExcellent ? "是" : "否"; } },
    { key: "isBiweek", label: "是否双周优秀", group: "案例与场景", sort: function (r) { return r.isBiweek; }, fmt: function (r) { return r.isBiweek ? "是" : "否"; } },
    { key: "promoScene", label: "推广场景", group: "案例与场景", sort: function (r) { return r.promoScene || ""; },
      fmt: function (r) { return r.promoScene ? esc(r.promoScene) : '<span style="color:#94a3b8">未分类</span>'; } },
    { key: "entryMonth", label: "案例入选月份", group: "案例与场景", sort: function (r) { return monthNo(entryMonthOf(r, null)); },
      fmt: function (r) { var m = entryMonthOf(r, null); return m ? esc(m) : '<span style="color:#94a3b8">/</span>'; } },
    { key: "servicePhase", label: "服务环节", group: "案例与场景", sort: function (r) { return r.servicePhase || ""; },
      fmt: function (r) { return r.servicePhase ? esc(r.servicePhase) : '<span style="color:#94a3b8">/</span>'; } },
    { key: "appScene", label: "应用场景", group: "案例与场景", sort: function (r) { return r.appScene || ""; },
      fmt: function (r) { return r.appScene ? esc(r.appScene) : '<span style="color:#94a3b8">/</span>'; } },
    { key: "tags", label: "应用标签", group: "案例与场景", sort: function (r) { return r.tags || ""; },
      fmt: function (r) { return r.tags ? esc(r.tags) : '<span style="color:#94a3b8">/</span>'; } },
    { key: "description", label: "应用说明", group: "案例与场景", sort: function (r) { return r.description || ""; },
      fmt: function (r) { return r.description ? '<span title="' + esc(r.description) + '">' + esc(r.description.slice(0, 24)) + (r.description.length > 24 ? "…" : "") + '</span>' : '<span style="color:#94a3b8">/</span>'; } },

    /* 第三组：产品运营信息 */
    { key: "isMarketplace", label: "是否上架广场", group: "产品运营", sort: function (r) { return r.isMarketplace == null ? -1 : r.isMarketplace; },
      fmt: function (r) { return r.isMarketplace == null ? '<span style="color:#94a3b8">/</span>' : (r.isMarketplace ? "是" : "否"); } },
    { key: "copyCount", label: "复制量", group: "产品运营", align: "right", num: true, sort: function (r) { return r.copyCount || 0; },
      fmt: function (r) { return fmtInt(r.copyCount); } },
    { key: "status", label: "应用状态", group: "产品运营", sort: function (r) { return r.status; }, fmt: function (r) { return esc(r.status); } },
    { key: "creator", label: "创建人", group: "产品运营", sort: function (r) { return r.creator || ""; },
      fmt: function (r) { return r.creator ? esc(r.creator) : '<span style="color:#94a3b8">/</span>'; } },
    { key: "createdAt", label: "创建时间", group: "产品运营", sort: function (r) { return r.createdAt || ""; },
      fmt: function (r) { return r.createdAt ? esc(r.createdAt) : '<span style="color:#94a3b8">/</span>'; } },

    /* 第四组：应用形态信息 */
    { key: "type", label: "应用类型", group: "应用形态", sort: function (r) { return r.type; }, fmt: function (r) { return esc(r.type); } },
    { key: "isLLM", label: "是否使用大模型", group: "应用形态", sort: function (r) { return r.isLLM; }, fmt: function (r) { return r.isLLM ? "是" : "否"; } },

    /* 第五组：Token 与计费（仅 6 月起且数据可用） */
    { key: "tokens", label: "总token数", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.tokens == null ? -1 : r.tokens; },
      fmt: function (r) { return r.tokens == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtTok(r.tokens); } },
    { key: "tokensPerCall", label: "单次调用Token", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.tokensPerCall == null ? -1 : r.tokensPerCall; },
      fmt: function (r) { return r.tokensPerCall == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtNum(r.tokensPerCall, 0); } },
    { key: "busyTokens", label: "忙时Token", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.busyTokens == null ? -1 : r.busyTokens; },
      fmt: function (r) { return r.busyTokens == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtTok(r.busyTokens); } },
    { key: "idleTokens", label: "闲时Token", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.idleTokens == null ? -1 : r.idleTokens; },
      fmt: function (r) { return r.idleTokens == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtTok(r.idleTokens); } },
    { key: "modelCost", label: "模型计费（元）", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.modelCost == null ? -1 : r.modelCost; },
      fmt: function (r) { return r.modelCost == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtNum(r.modelCost, 2); } },
    { key: "busyCost", label: "忙时计费(元)", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.busyCost == null ? -1 : r.busyCost; },
      fmt: function (r) { return r.busyCost == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtNum(r.busyCost, 2); } },
    { key: "idleCost", label: "闲时计费(元)", group: "Token与计费", align: "right", num: true, token: true, sort: function (r) { return r.idleCost == null ? -1 : r.idleCost; },
      fmt: function (r) { return r.idleCost == null ? '<span style="color:#94a3b8">自6月起统计</span>' : fmtNum(r.idleCost, 2); } },

    /* 新增组：价值与正向（来自「智能体清单（各省）」） */
    { key: "personYear", label: "节约人年", group: "价值与正向", align: "right", num: true, sort: function (r) { return r.personYear == null ? -1 : r.personYear; },
      fmt: function (r) { return r.personYear == null ? '<span style="color:#94a3b8">/</span>' : fmtNum(r.personYear, 2); } },
    { key: "saveAmount", label: "节约金额", group: "价值与正向", align: "right", num: true, sort: function (r) { return r.saveAmount == null ? -1 : r.saveAmount; },
      fmt: function (r) { return r.saveAmount == null ? '<span style="color:#94a3b8">—</span>' : fmtNum(r.saveAmount, 2); } },
    { key: "realValue", label: "产生真实价值", group: "价值与正向", align: "right", num: true, sort: function (r) { return r.realValue == null ? -1 : r.realValue; },
      fmt: function (r) { return r.realValue == null ? '<span style="color:#94a3b8">—</span>' : fmtNum(r.realValue, 2); } },
    { key: "positiveValue", label: "是否正向价值", group: "价值与正向", align: "center", num: false, sort: function (r) { return r.positiveValue ? 1 : 0; },
      fmt: function (r) { return r.positiveValue ? '<span class="agx-badge" style="background:#f0fdf4;color:#16a34a">是</span>' : '<span class="agx-badge" style="background:#f1f5f9;color:#64748b">否</span>'; } },

    /* 第六组：技术身份（最后） */
    { key: "appId", label: "应用ID", group: "技术身份", sort: function (r) { return r.appId || ""; },
      fmt: function (r) { return r.appId ? '<code style="font-size:11px">' + esc(r.appId) + '</code>' : '<span style="color:#94a3b8">/</span>'; } }
  ];
  var FULL_COL_MAP = {};
  (function () {
    for (var i = 0; i < FULL_AGENT_COLUMNS.length; i++) FULL_COL_MAP[FULL_AGENT_COLUMNS[i].key] = FULL_AGENT_COLUMNS[i];
  })();
  function activeColumns(month) {
    /* 下钻表始终保留全量字段；1—5月 Token 列由 formatter 明确显示“自6月起统计”。 */
    return FULL_AGENT_COLUMNS.slice();
  }
  var SUMMARY_COLUMN_KEYS = ["name", "province", "calls", "callsMom", "activity", "effRatio", "servicePhase", "appScene", "caseTags", "promoScene", "type"];
  var CASE_SUMMARY_COLUMN_KEYS = ["name", "province", "calls", "callsMom", "activity", "servicePhase", "appScene", "caseTags", "promoScene", "entryMonth", "tokens", "modelCost", "effRatio", "saveSec", "personYear", "saveAmount", "realValue", "positiveValue"];
  function columnsByKeys(keys, month) {
    var allowed = activeColumns(month), map = {}, out = [];
    for (var i = 0; i < allowed.length; i++) map[allowed[i].key] = allowed[i];
    for (var j = 0; j < keys.length; j++) if (map[keys[j]]) out.push(map[keys[j]]);
    return out;
  }

  /* ==================================================================
   * 六、统一筛选条
   * ================================================================== */
  function defaultFilters() {
    return {
      keyword: "", callsPreset: "all", callsMin: null, callsMax: null,
      caseTags: [], provinces: [], activity: [], appTypes: [],
      servicePhases: [], appScenes: [], promoScenes: [], positive: null
    };
  }
  function cloneFilters(f) {
    var src = f || defaultFilters();
    return {
      keyword: src.keyword || "",
      callsPreset: src.callsPreset || "all",
      callsMin: src.callsMin == null ? null : src.callsMin,
      callsMax: src.callsMax == null ? null : src.callsMax,
      caseTags: (src.caseTags || []).slice(),
      provinces: (src.provinces || []).slice(),
      activity: (src.activity || []).slice(),
      appTypes: (src.appTypes || []).slice(),
      servicePhases: (src.servicePhases || []).slice(),
      appScenes: (src.appScenes || []).slice(),
      promoScenes: (src.promoScenes || []).slice(),
      positive: src.positive == null ? null : src.positive
    };
  }
  var CALL_PRESETS = [
    { k: "all", t: "全部" },
    { k: "zero", t: "0" },
    { k: "low", t: "1—1000" },
    { k: "mid", t: "1001—10万" },
    { k: "high", t: ">10万" },
    { k: "custom", t: "自定义" }
  ];
  var CASE_TAG_OPTIONS = [
    { k: "promo", t: "推广" }, { k: "excellent", t: "优秀" },
    { k: "biweek", t: "双周优秀" }, { k: "none", t: "无案例标签" }
  ];
  var ACTIVITY_OPTIONS = [
    { k: "inactive", t: "未活跃" }, { k: "active", t: "活跃" },
    { k: "hot", t: "高热度" }, { k: "highEff", t: "活跃且高提效" }
  ];
  function matchCalls(r, f) {
    var v = r.calls || 0;
    if (f.callsPreset === "zero") return v === 0;
    if (f.callsPreset === "low") return v >= 1 && v <= THRESH.activeCalls;
    if (f.callsPreset === "mid") return v > THRESH.activeCalls && v <= THRESH.hotCalls;
    if (f.callsPreset === "high") return v > THRESH.hotCalls;
    if (f.callsPreset === "custom") {
      var lo = f.callsMin, hi = f.callsMax;
      if (lo != null && v < lo) return false;
      if (hi != null && v > hi) return false;
      return true;
    }
    return true;
  }
  function matchCaseTags(r, f) {
    if (!f.caseTags || !f.caseTags.length) return true;
    var hit = function (tag) {
      if (tag === "none") return !r.isPromo && !r.isExcellent && !r.isBiweek;
      if (tag === "promo") return !!r.isPromo;
      if (tag === "excellent") return !!r.isExcellent;
      if (tag === "biweek") return !!r.isBiweek;
      return false;
    };
    /* 多选标签固定为交集：点击推广+优秀，只看同时拥有两类标签的应用。 */
    for (var i = 0; i < f.caseTags.length; i++) if (!hit(f.caseTags[i])) return false;
    return true;
  }
  function matchActivity(r, f) {
    if (!f.activity || !f.activity.length) return true;
    for (var i = 0; i < f.activity.length; i++) {
      var k = f.activity[i];
      if (k === "active" && r.isActive) return true;
      if (k === "inactive" && !r.isActive) return true;
      if (k === "hot" && r.isHot) return true;
      if (k === "highEff" && r.isHighEff) return true;
    }
    return false;
  }
  function applyFilters(rows, f) {
    var kw = (f.keyword || "").toLowerCase();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (kw) {
        var hay = (r.name + " " + (r.creator || "") + " " + (r.appId || "")).toLowerCase();
        if (hay.indexOf(kw) < 0) continue;
      }
      if (!matchCalls(r, f)) continue;
      if (!matchCaseTags(r, f)) continue;
      if (f.provinces && f.provinces.length && f.provinces.indexOf(r.province) < 0) continue;
      if (!matchActivity(r, f)) continue;
      if (f.appTypes && f.appTypes.length && f.appTypes.indexOf(r.type) < 0) continue;
      if (f.servicePhases && f.servicePhases.length && f.servicePhases.indexOf(r.servicePhase || "未分类") < 0) continue;
      if (f.appScenes && f.appScenes.length && f.appScenes.indexOf(r.appScene || "未分类") < 0) continue;
      if (f.promoScenes && f.promoScenes.length && f.promoScenes.indexOf(r.promoScene || "未分类") < 0) continue;
      if (f.positive === "YES" && !r.positiveValue) continue;
      if (f.positive === "NO" && r.positiveValue) continue;
      out.push(r);
    }
    return out;
  }
  /* 渲染筛选条；prefix 用于区分不同表的控件 id；node 保存筛选状态 */
  function renderFilterBar(prefix, node, opts) {
    opts = opts || {};
    var f = node.filters;
    var ps = provinces();
    var types = [], phases = [], scenes = [], promoScenes = [];
    var rs = node.data || scoped({ month: node.month || state.month });
    var tseen = {}, phseen = {}, scseen = {}, prseen = {};
    for (var i = 0; i < rs.length; i++) {
      if (!tseen[rs[i].type]) { tseen[rs[i].type] = 1; types.push(rs[i].type); }
      if (rs[i].servicePhase && !phseen[rs[i].servicePhase]) { phseen[rs[i].servicePhase] = 1; phases.push(rs[i].servicePhase); }
      if (rs[i].appScene && !scseen[rs[i].appScene]) { scseen[rs[i].appScene] = 1; scenes.push(rs[i].appScene); }
      if (rs[i].promoScene && !prseen[rs[i].promoScene]) { prseen[rs[i].promoScene] = 1; promoScenes.push(rs[i].promoScene); }
    }
    if (!types.length) types = ["智能体", "工作流", "对话流", "其他"];
    types.sort(); phases.sort(); scenes.sort(); promoScenes.sort();
    var compact = !!opts.compact;
    function selectField(id, label, value, options, emptyText, pendingText) {
      var x = '<label class="agx-field"><span>' + label + '</span><select id="' + id + '">' + (emptyText ? '<option value="">' + emptyText + '</option>' : '');
      if (!options.length && pendingText) x += '<option value="" disabled>' + pendingText + '</option>';
      for (var z = 0; z < options.length; z++) {
        var ov = options[z].k != null ? options[z].k : options[z];
        var ot = options[z].t != null ? options[z].t : options[z];
        x += '<option value="' + esc(ov) + '"' + (value === ov ? ' selected' : '') + '>' + esc(ot) + '</option>';
      }
      return x + '</select></label>';
    }

    var h = [];
    h.push('<div class="agx-fbar"' + (compact ? ' style="padding:7px 10px;gap:8px"' : '') + '>');
    h.push('<label class="agx-field"><span>搜索应用</span><span style="display:flex;gap:5px"><input type="search" id="' + prefix + 'kw" value="' + esc(f.keyword) +
      '" placeholder="名称 / 创建人 / ID" aria-label="按应用名称、创建人或应用ID搜索"/><button type="button" class="agx-rst" id="' + prefix + 'search">查询</button></span></label>');
    h.push(selectField(prefix + 'calls', '调用量', f.callsPreset, CALL_PRESETS, ''));
    if (f.callsPreset === "custom") {
      h.push('<label class="agx-field"><span>调用量区间</span><span style="display:flex;gap:5px"><input type="number" id="' + prefix + 'cmin" placeholder="最小" value="' + (f.callsMin == null ? "" : f.callsMin) + '"/><input type="number" id="' + prefix + 'cmax" placeholder="最大" value="' + (f.callsMax == null ? "" : f.callsMax) + '"/></span></label>');
    }
    var tagKey = (f.caseTags || []).join('+');
    var tagOptions = [
      { k:'promo',t:'推广案例' },{ k:'excellent',t:'优秀案例' },{ k:'biweek',t:'双周优秀' },
      { k:'promo+excellent',t:'推广 + 优秀（同时具备）' },{ k:'promo+biweek',t:'推广 + 双周（同时具备）' },
      { k:'excellent+biweek',t:'优秀 + 双周（同时具备）' },{ k:'promo+excellent+biweek',t:'推广 + 优秀 + 双周（同时具备）' },
      { k:'none',t:'无案例标签' }
    ];
    h.push(selectField(prefix + 'tags', '案例标签', tagKey, tagOptions, '全部案例标签'));
    h.push(selectField(prefix + 'prov', '省份', (f.provinces || [])[0] || '', ps, '全部省份'));
    h.push(selectField(prefix + 'act', '活跃分层', (f.activity || [])[0] || '', ACTIVITY_OPTIONS, '全部活跃分层'));
    h.push(selectField(prefix + 'type', '应用形态', (f.appTypes || [])[0] || '', types, '全部应用形态'));
    h.push(selectField(prefix + 'phase', '服务环节', (f.servicePhases || [])[0] || '', phases, '全部服务环节', '待新数据补充'));
    h.push(selectField(prefix + 'scene', '业务场景', (f.appScenes || [])[0] || '', scenes, '全部业务场景', '待新数据补充'));
    h.push(selectField(prefix + 'promoScene', '推广场景', (f.promoScenes || [])[0] || '', promoScenes, '全部推广场景', '待新数据补充'));
    if (opts.positive) h.push(selectField(prefix + 'pos', '是否正向价值', f.positive || '', [{ k: 'YES', t: '是' }, { k: 'NO', t: '否' }], '全部'));
    h.push('<button type="button" class="agx-rst" id="' + prefix + 'rst">重置筛选</button>');
    h.push('</div>');
    return h.join("");
  }
  function bindFilterBar(prefix, node, onChange) {
    var f = node.filters;
    var kw = byId(prefix + "kw");
    function refresh(rebuild) { node.tableState.page = 1; onChange(rebuild); }
    function one(id, key) { var el = byId(prefix + id); if (el) el.onchange = function () { f[key] = el.value ? [el.value] : []; refresh(true); }; }
    var search = byId(prefix + "search");
    function doSearch() { f.keyword = kw ? kw.value.trim() : ""; refresh(false); }
    if (search) search.onclick = doSearch;
    if (kw) kw.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doSearch(); } };
    var calls = byId(prefix + "calls");
    if (calls) calls.onchange = function () { f.callsPreset = calls.value || "all"; f.callsMin = f.callsMax = null; refresh(true); };
    var tags = byId(prefix + "tags");
    if (tags) tags.onchange = function () { f.caseTags = tags.value ? tags.value.split("+") : []; refresh(true); };
    one("prov", "provinces"); one("act", "activity"); one("type", "appTypes");
    one("phase", "servicePhases"); one("scene", "appScenes"); one("promoScene", "promoScenes");
    var posEl = byId(prefix + "pos");
    if (posEl) posEl.onchange = function () { f.positive = posEl.value || null; refresh(true); };
    var rst = byId(prefix + "rst");
    if (rst) rst.onclick = function () {
      node.filters = defaultFilters();
      if (node.scopePreset && node.scopePreset.provinces) node.filters.provinces = node.scopePreset.provinces.slice();
      node.tableState.page = 1;
      onChange(true);
    };
    var cmin = byId(prefix + "cmin"), cmax = byId(prefix + "cmax");
    if (cmin) cmin.onchange = function () { f.callsMin = num(cmin.value); node.tableState.page = 1; onChange(); };
    if (cmax) cmax.onchange = function () { f.callsMax = num(cmax.value); node.tableState.page = 1; onChange(); };
  }
  function bindChipSet(id, node, cb, multi) {
    var box = byId(id);
    if (!box) return;
    var btns = box.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () { cb(b.getAttribute("data-v")); };
      })(btns[i]);
    }
  }

  /* ==================================================================
   * 七、通用全量表格（所有下钻表共用）
   * ================================================================== */
  function sortRows(rows, node, cols) {
    var t = node.tableState;
    var col = FULL_COL_MAP[t.sortKey];
    if (!col || !col.sort) return rows;
    var dir = t.sortDir === "asc" ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var av = col.sort(a), bv = col.sort(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return av.localeCompare(bv, "zh-CN") * dir;
      return (av - bv) * dir;
    });
  }
  /* 分组表头 */
  function groupHeader(cols) {
    var spans = [], last = null;
    for (var i = 0; i < cols.length; i++) {
      var g = cols[i].group || "";
      if (g === last) { spans[spans.length - 1].n++; }
      else { spans.push({ g: g, n: 1 }); last = g; }
    }
    var h = '<tr class="agx-gh">';
    for (var j = 0; j < spans.length; j++) {
      h += '<th colspan="' + spans[j].n + '">' + esc(spans[j].g) + '</th>';
    }
    return h + '</tr>';
  }
  function renderAgentTable(prefix, rows, node, opts) {
    opts = opts || {};
    var cols = opts.columns || activeColumns(node.month || state.month);
    var t = node.tableState;
    var sorted = sortRows(rows, node, cols);
    var total = sorted.length;
    var size = (opts && opts.limit) ? opts.limit : (t.pageSize || PAGE_SIZE);
    var pages = Math.max(1, Math.ceil(total / size));
    if (t.page > pages) t.page = pages;
    var start = (t.page - 1) * size;
    var pageRows = sorted.slice(start, start + size);

    var head = '<tr class="agx-gh">' + (function () {
      var spans = [], last = null;
      for (var i = 0; i < cols.length; i++) {
        var g = cols[i].group || "";
        if (g === last) spans[spans.length - 1].n++;
        else { spans.push({ g: g, n: 1 }); last = g; }
      }
      var s = "";
      for (var j = 0; j < spans.length; j++) s += '<th colspan="' + spans[j].n + '">' + esc(spans[j].g) + '</th>';
      return s;
    })() + '</tr>';

    var th = "";
    for (var k = 0; k < cols.length; k++) {
      var c = cols[k];
      var ind = t.sortKey === c.key ? (t.sortDir === "asc" ? " ↑" : " ↓") : "";
      var cls = [c.align === "right" ? "agx-num" : "", c.fix === 1 ? "agx-fix" : (c.fix === 2 ? "agx-fix2" : ""),
        "agx-th-sort"].join(" ").trim();
      th += '<th class="' + cls + '" data-k="' + c.key + '" scope="col" title="点击按此列排序">' + esc(c.label) + ind + '</th>';
    }
    var tb = "";
    for (var m = 0; m < pageRows.length; m++) {
      var r = pageRows[m];
      tb += '<tr data-eid="' + esc(r.entityId) + '" data-m="' + esc(r.month) + '" tabindex="0" role="button" title="点击查看单应用档案">';
      for (var n = 0; n < cols.length; n++) {
        var cc = cols[n];
        var cls2 = [cc.align === "right" ? "agx-num" : "", cc.fix === 1 ? "agx-fix" : (cc.fix === 2 ? "agx-fix2" : "")].join(" ").trim();
        tb += '<td class="' + cls2 + '">' + cc.fmt(r) + '</td>';
      }
      tb += '</tr>';
    }
    if (!pageRows.length) {
      tb = '<tr><td colspan="' + cols.length + '" class="agx-empty">当前筛选条件下没有匹配的应用</td></tr>';
    }
    var pager;
    if (opts && opts.hidePager) {
      pager = (opts.limit ? '<div class="agx-pager"><span>筛选后 ' + total + ' 条（显示前 ' + size + '）</span></div>' : "");
    } else {
      pager = '<div class="agx-pager"><span>筛选后 ' + total + ' 条' +
        (opts.rawTotal != null && opts.rawTotal !== total ? ' / 原始 ' + opts.rawTotal + ' 条' : '') + '</span>' +
        '<button type="button" data-pg="first"' + (t.page <= 1 ? " disabled" : "") + '>首页</button>' +
        '<button type="button" data-pg="prev"' + (t.page <= 1 ? " disabled" : "") + '>上一页</button>' +
        '<span>第 ' + t.page + ' / ' + pages + ' 页</span>' +
        '<button type="button" data-pg="next"' + (t.page >= pages ? " disabled" : "") + '>下一页</button>' +
        '<button type="button" data-pg="last"' + (t.page >= pages ? " disabled" : "") + '>末页</button></div>';
    }
    return {
      html: '<div class="agx-tblwrap' + (opts.short ? " short" : "") + '" id="' + prefix + 'wrap"><table class="tbl agx-tbl">' +
        '<thead>' + head + '<tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>' + pager,
      pageRows: pageRows, total: total
    };
  }
  function bindAgentTable(prefix, rows, node, rerender, onRowClick) {
    var wrap = byId(prefix + "wrap");
    if (!wrap) return;
    var ths = wrap.querySelectorAll("th[data-k]");
    for (var i = 0; i < ths.length; i++) {
      (function (th) {
        th.onclick = function () {
          var k = th.getAttribute("data-k");
          var t = node.tableState;
          if (t.sortKey === k) t.sortDir = t.sortDir === "asc" ? "desc" : "asc";
          else { t.sortKey = k; t.sortDir = "desc"; }
          rerender();
        };
      })(ths[i]);
    }
    var trs = wrap.querySelectorAll("tbody tr[data-eid]");
    for (var j = 0; j < trs.length; j++) {
      (function (tr) {
        var open = function () {
          var eid = tr.getAttribute("data-eid"), m = tr.getAttribute("data-m");
          var target = null;
          for (var x = 0; x < rows.length; x++) {
            if (rows[x].entityId === eid && rows[x].month === m) { target = rows[x]; break; }
          }
          if (target) onRowClick(target);
        };
        tr.onclick = open;
        tr.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      })(trs[j]);
    }
    var pgs = wrap.parentNode.querySelectorAll(".agx-pager button");
    for (var p = 0; p < pgs.length; p++) {
      (function (b) {
        b.onclick = function () {
          var t = node.tableState;
          var pages = Math.max(1, Math.ceil(rows.length / (t.pageSize || PAGE_SIZE)));
          var a = b.getAttribute("data-pg");
          if (a === "first") t.page = 1;
          else if (a === "prev") t.page = Math.max(1, t.page - 1);
          else if (a === "next") t.page = Math.min(pages, t.page + 1);
          else if (a === "last") t.page = pages;
          rerender();
        };
      })(pgs[p]);
    }
  }

  /* ==================================================================
   * 八、统一右侧抽屉（全局只允许一个根节点）
   * ================================================================== */
  function ensureDrawer() {
    if (byId("agDrawerMask")) return;
    var mask = document.createElement("div");
    mask.id = "agDrawerMask";
    mask.className = "agx-drawer-mask";
    mask.innerHTML = '<aside id="agDrawer" class="agx-drawer" role="dialog" aria-modal="true" ' +
      'aria-labelledby="agDrawerTitle">' +
      '<header class="agx-dh" id="agDrawerHeader"></header>' +
      '<main class="agx-dbody" id="agDrawerBody"></main></aside>';
    document.body.appendChild(mask);
    mask.addEventListener("mousedown", function (e) { if (e.target === mask) closeDrawer(); });
  }
  function destroyDrawerCharts() {
    Object.keys(charts).forEach(function (k) {
      if (k.indexOf("agxDC_") === 0) {
        try { charts[k].dispose(); } catch (e) {}
        delete charts[k];
      }
    });
  }
  function newDrillNode(type, opts) {
    opts = opts || {};
    return {
      type: type,
      title: opts.title || "",
      crumb: opts.crumb || "",
      month: opts.month || state.month,
      kpiKey: opts.kpiKey || "",
      render: opts.render || "",
      wide: !!opts.wide,
      scopePreset: opts.scopePreset || null,
      data: opts.data || null,
      filters: opts.filters || defaultFilters(),
      tableState: opts.tableState || { sortKey: opts.sortKey || "calls", sortDir: "desc", page: 1, pageSize: PAGE_SIZE, scrollTop: 0, scrollLeft: 0 },
      provRank: opts.provRank || null,
      kpiFilter: opts.kpiFilter || null,
      sceneRows: opts.sceneRows || null,
      intro: opts.intro || "",
      entityId: opts.entityId || "",
      agentMonth: opts.agentMonth || "",
      track: opts.track || null
    };
  }
  /* 离开当前抽屉层时同步快照滚动位置（不依赖 scroll 事件，避免重渲染后句柄丢失导致快照丢失） */
  function snapshotDrawerScroll() {
    var stack = state.drillStack;
    if (!stack || !stack.length) return;
    var node = stack[stack.length - 1];
    if (!node) return;
    if (!node.tableState) node.tableState = {};
    var body = byId("agDrawerBody");
    var tw = body && body.querySelector ? body.querySelector(".agx-tblwrap") : null;
    if (body) {
      node.tableState.scrollTop = body.scrollTop;
      node.tableState.scrollLeft = body.scrollLeft;
    }
    if (tw) {
      node.tableState.tblScrollLeft = tw.scrollLeft;
      node.tableState.tblScrollTop = tw.scrollTop;
    }
  }
  function pushDrill(node) {
    ensureDrawer();
    if (!state.drawerOpen) {
      _scrollLockY = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
      _lastFocusEl = document.activeElement;
    }
    snapshotDrawerScroll();
    state.drillStack.push(node);
    state.drawerOpen = true;
    renderDrawer(true);
  }
  function popDrill() {
    if (state.drillStack.length > 1) {
      snapshotDrawerScroll();
      state.drillStack.pop();
      renderDrawer(true);
    } else {
      closeDrawer();
    }
  }
  function gotoDrill(i) {
    if (i < 0 || i >= state.drillStack.length) return;
    snapshotDrawerScroll();
    state.drillStack.length = i + 1;
    renderDrawer(true);
  }
  function closeDrawer() {
    destroyDrawerCharts();
    state.drillStack = [];
    state.drawerOpen = false;
    var mask = byId("agDrawerMask");
    if (mask) mask.className = "agx-drawer-mask";
    if (document.body && document.body.style) document.body.style.overflow = "";
    document.removeEventListener("keydown", onDrawerKey);
    if (_lastFocusEl && _lastFocusEl.focus) { try { _lastFocusEl.focus(); } catch (e) {} }
    _lastFocusEl = null;
  }
  function onDrawerKey(e) {
    if (e.key === "Escape") {
      if (state.drillStack.length > 1) { e.preventDefault(); popDrill(); }
      else { e.preventDefault(); closeDrawer(); }
    }
  }
  function renderDrawer(structural) {
    ensureDrawer();
    var mask = byId("agDrawerMask"), drawer = byId("agDrawer");
    if (!mask || !drawer) return;
    var stack = state.drillStack;
    if (!stack.length) { closeDrawer(); return; }
    var node = stack[stack.length - 1];
    mask.className = "agx-drawer-mask on";
    drawer.className = "agx-drawer" + (node.wide ? " wide" : "");
    if (document.body && document.body.style) document.body.style.overflow = "hidden";

    /* 头部：返回 / 面包屑 / 标题 / 范围 / 关闭 */
    var crumbs = ['<button type="button" data-crumb="0">智能体分析</button>'];
    for (var i = 0; i < stack.length; i++) {
      crumbs.push('<span class="sep">/</span>');
      var n = stack[i];
      if (i === stack.length - 1) crumbs.push('<span style="color:#1f2937;font-weight:700">' + esc(n.crumb || n.title) + '</span>');
      else crumbs.push('<button type="button" data-crumb="' + i + '">' + esc(n.crumb || n.title) + '</button>');
    }
    var nodeProvince = node.scopePreset && node.scopePreset.provinces && node.scopePreset.provinces.length
      ? node.scopePreset.provinces.join("、") : (state.province === "ALL" ? "全国" : state.province);
    var scopeTxt = esc(node.month) + '｜' + esc(nodeProvince) +
      '｜' + esc(state.type === "ALL" ? "全部应用形态" : state.type);
    byId("agDrawerHeader").innerHTML =
      '<div class="agx-dcrumbs">' + crumbs.join("") + '</div>' +
      '<div class="agx-dtitle">' +
        (stack.length > 1 ? '<button type="button" class="agx-back" id="agxBack">← 返回</button>' : '') +
        '<b id="agDrawerTitle">' + esc(node.title) + '</b>' +
        '<span class="scope">' + scopeTxt + '</span>' +
        '<button type="button" class="agx-x" id="agxClose" aria-label="关闭抽屉">×</button>' +
      '</div>';

    var cb = byId("agDrawerHeader").querySelectorAll("button[data-crumb]");
    for (var c = 0; c < cb.length; c++) {
      (function (b) { b.onclick = function () { gotoDrill(Number(b.getAttribute("data-crumb"))); }; })(cb[c]);
    }
    var back = byId("agxBack");
    if (back) back.onclick = function () { popDrill(); };
    byId("agxClose").onclick = closeDrawer;
    document.removeEventListener("keydown", onDrawerKey);
    document.addEventListener("keydown", onDrawerKey);

    /* 主体 */
    var body = byId("agDrawerBody");
    var prevTop = body.scrollTop, prevLeft = body.scrollLeft;
    drawDrawerBody(node, body);

    if (!structural) {
      body.scrollTop = prevTop; body.scrollLeft = prevLeft;
    } else {
      body.scrollTop = node.tableState.scrollTop || 0;
      body.scrollLeft = node.tableState.scrollLeft || 0;
    }
    var bt = byId("agxBack") || byId("agxClose");
    if (bt && bt.focus) { try { bt.focus(); } catch (e) {} }
    /* 横纵滚动快照：body 与各表格 wrap 分别保存/恢复 */
    var tw = body.querySelector(".agx-tblwrap");
    if (tw) {
      tw.scrollLeft = node.tableState.tblScrollLeft || 0;
      tw.scrollTop = node.tableState.tblScrollTop || 0;
      tw.onscroll = function () {
        node.tableState.tblScrollLeft = tw.scrollLeft;
        node.tableState.tblScrollTop = tw.scrollTop;
      };
    }
    if (body.removeEventListener) {
      body.onscroll = function () {
        node.tableState.scrollTop = body.scrollTop;
        node.tableState.scrollLeft = body.scrollLeft;
      };
    }
  }
  /* 抽屉主体分发 */
  function drawDrawerBody(node, body) {
    destroyDrawerCharts();
    if (node.type === "metric") drawMetricBody(node, body);
    else if (node.type === "agentList") drawAgentListBody(node, body);
    else if (node.type === "trendMonth") drawTrendMonthBody(node, body);
    else if (node.type === "province") drawProvinceBody(node, body);
    else if (node.type === "agent") drawAgentBody(node, body);
    else body.innerHTML = '<div class="agx-empty">未知的下钻类型：' + esc(node.type) + '</div>';
  }
  /* 抽屉内重绘（保留滚动位置） */
  function redrawDrawerBody() {
    var body = byId("agDrawerBody");
    if (!body || !state.drillStack.length) return;
    var node = state.drillStack[state.drillStack.length - 1];
    var top = body.scrollTop, left = body.scrollLeft;
    var tw = body.querySelector(".agx-tblwrap");
    var tleft = tw ? tw.scrollLeft : 0, ttop = tw ? tw.scrollTop : 0;
    drawDrawerBody(node, body);
    body.scrollTop = top; body.scrollLeft = left;
    var tw2 = body.querySelector(".agx-tblwrap");
    if (tw2) { tw2.scrollLeft = tleft; tw2.scrollTop = ttop; }
  }

  /* ---- 抽屉内容：通用智能体清单 ---- */
  function nodeRows(node) {
    return applyFilters(node.data || [], node.filters);
  }
  function drawAgentListBody(node, body) {
    if (node.render === "provRank") return drawProvRankBody(node, body);
    var raw = node.data || [];
    var rows = applyFilters(raw, node.filters);
    var prefix = "agxAL_";
    var scopeTags = "";
    if (node.scopePreset) {
      var sp = node.scopePreset;
      if (sp.provinces && sp.provinces.length) {
        scopeTags += '<span class="agx-scope-tag">省份：' + esc(sp.provinces.join("、")) + '</span>';
      }
      if (sp.label) scopeTags += '<span class="agx-scope-tag">' + esc(sp.label) + '</span>';
    }
    if (!monthAvailable(node.month)) {
      body.innerHTML = '<div class="agx-token-na"><b>' + esc(node.month) + '应用级明细待接入</b><br/>' +
        '本页框架已就绪，缺失明细显示「待接入」，不会用其他月份数据代替。</div>';
      return;
    }
    var t = renderAgentTable(prefix, rows, node);
    body.innerHTML =
      (node.intro ? '<div class="agx-note" style="margin-bottom:10px">' + node.intro + '</div>' : '') +
      (scopeTags ? '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px">' + scopeTags + '</div>' : '') +
      renderFilterBar(prefix, node) +
      '<div class="agx-summary-note" style="margin:0 0 8px">筛选后 <b style="color:#334155">' + rows.length + '</b> 条 / 原始 ' + raw.length + ' 条</div>' +
      t.html;
    bindFilterBar(prefix, node, function () { redrawDrawerBody(); });
    bindAgentTable(prefix, rows, node, function () { redrawDrawerBody(); }, openAgentProfile);
  }

  /* ---- 抽屉内容：KPI 指标诊断 ---- */
  var KPI_DEFS = [
    { k: "online", t: "上线应用总数", c: "#476f9f", tip: "当月月度明细中的应用数量；不读取或判断‘应用状态’列",
      filter: function () { return true; } },
    { k: "calls", t: "月调用量", c: "#3b82f6", tip: "当月全部应用调用量合计；成功与失败均计入",
      filter: function () { return true; } },
    { k: "active", t: "活跃智能体", c: "#14b8a6", tip: "月调用量 > 1000 的智能体数量",
      filter: function (r) { return !!r.isActive; } },
    { k: "hot", t: "高热度智能体", c: "#8b5cf6", tip: "月调用量 > 100000 的智能体数量",
      filter: function (r) { return !!r.isHot; } },
    { k: "highEff", t: "活跃且高提效智能体", c: "#22c55e", tip: "月调用量 > 1000 且提效比率 > 30% 的智能体数量",
      filter: function (r) { return !!r.isHighEff; } }
  ];
  function openKpiDrill(kpiKey) {
    var def = null;
    for (var i = 0; i < KPI_DEFS.length; i++) if (KPI_DEFS[i].k === kpiKey) def = KPI_DEFS[i];
    if (!def) return;
    var list = [];
    var cur = scoped();
    for (var j = 0; j < cur.length; j++) if (def.filter(cur[j])) list.push(cur[j]);
    pushDrill(newDrillNode("metric", {
      title: def.t + " · 指标诊断", crumb: def.t, month: state.month, kpiKey: kpiKey,
      data: list, sortKey: "calls", scopePreset: { label: def.t }
    }));
    redrawDrawerBody();
  }
  function metricValue(key, rows) {
    if (key === "calls") return rows.reduce(function (s, r) { return s + (r.calls || 0); }, 0);
    var def = KPI_DEFS.filter(function (x) { return x.k === key; })[0];
    return def ? rows.filter(def.filter).length : 0;
  }
  function metricSecondary(key, cur, list) {
    var s = stats(cur);
    if (key === "online") return { label: "上线率", value: cur.length ? list.length / cur.length : null, sub: "当月应用共 " + fmtInt(cur.length) + " 个", pct: true };
    if (key === "calls") {
      var used = cur.filter(function (r) { return r.calls > 0; }).length;
      return { label: "有调用应用", value: used, sub: "单应用平均 " + fmtWan(cur.length ? metricValue("calls", cur) / cur.length : null) + " 次", pct: false };
    }
    if (key === "active") return { label: "活跃率", value: s.online ? s.active / s.online : null, sub: "活跃 / 上线应用", pct: true };
    if (key === "hot") return { label: "占活跃应用", value: s.active ? s.hot / s.active : null, sub: "高热度 / 活跃应用", pct: true };
    return { label: "占活跃应用", value: s.active ? s.high / s.active : null, sub: "活跃高提效 / 活跃应用", pct: true };
  }
  function drawMetricBody(node, body) {
    var def = null;
    for (var i = 0; i < KPI_DEFS.length; i++) if (KPI_DEFS[i].k === node.kpiKey) def = KPI_DEFS[i];
    var cur = scoped({ month: node.month });
    var list = [];
    for (var j = 0; j < cur.length; j++) if (def.filter(cur[j])) list.push(cur[j]);
    node.data = list;
    var mm = REPORT_MONTHS, series = [], provRank = [];
    for (var m = 0; m < mm.length; m++) {
      var mo = mm[m];
      if (!monthAvailable(mo)) { series.push(null); continue; }
      series.push(metricValue(node.kpiKey, scoped({ month: mo })));
    }
    var byProv = {};
    for (var p = 0; p < list.length; p++) (byProv[list[p].province] || (byProv[list[p].province] = [])).push(list[p]);
    var pk = Object.keys(byProv);
    for (var q = 0; q < pk.length; q++) provRank.push({ n: pk[q], v: metricValue(node.kpiKey, byProv[pk[q]]) });
    provRank.sort(function (a, b) { return b.v - a.v; });

    var curV = series[mm.indexOf(node.month)];
    var pm = prevMonthOf(node.month);
    var prevV = pm ? series[mm.indexOf(pm)] : null;

    var second = metricSecondary(node.kpiKey, cur, list);
    var h = [];
    h.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px">' +
      '<div class="agx-kpi" style="cursor:default"><div class="lb">' + esc(def.t) + '</div>' +
      '<div class="val">' + (node.kpiKey === "calls" ? fmtWan(curV) : fmtInt(curV)) + '</div><div class="sub">' + fmtMom(momPct(curV, prevV)) + '</div></div>' +
      '<div class="agx-kpi" style="cursor:default"><div class="lb">' + esc(second.label) + '</div>' +
      '<div class="val">' + (second.pct ? fmtPct(second.value) : fmtInt(second.value)) + '</div>' +
      '<div class="sub">' + second.sub + '</div></div></div>');
    h.push('<div style="font-size:12px;color:#6b7280;line-height:1.8;margin-bottom:12px"><b>指标定义：</b>' + esc(def.tip) + '</div>');
    h.push('<div class="chart" id="agxDC_metricTrend" style="height:170px"></div>');
    h.push('<div class="agx-note">1—' + REPORT_MONTHS.length + '月框架；缺失月份为「待接入」，不补 0。</div>');

    /* 省份贡献 TOP10 + 完整排名 */
    h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 8px">' +
      '<b style="font-size:13px;color:#1f2937">省份贡献 TOP10</b>' +
      '<button type="button" class="agx-exp" id="agxDC_provAll" style="margin-left:auto">查看完整排名（' + provRank.length + '）</button></div>');
    h.push('<div class="chart" id="agxDC_provChart" style="height:' + Math.max(200, Math.min(10, provRank.length) * 30) + 'px"></div>');

    if (node.kpiKey === "online") {
      h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 8px">' +
        '<b style="font-size:13px;color:#1f2937">上线应用使用分层</b>' +
        '<button type="button" class="agx-primary-btn" id="agxDC_onlineAll" style="margin-left:auto">查看全部上线应用（' + list.length + '）</button></div>');
      h.push('<div class="chart" id="agxDC_onlineMix" style="height:250px"></div>');
      h.push('<div class="agx-note">这里不展示“构成指标的智能体 TOP10”。上线总数是规模存量指标，优先看使用分层并定位零调用、低频应用。</div>');
    } else {
      h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 8px">' +
        '<b style="font-size:13px;color:#1f2937">重点智能体 TOP10</b>' +
        '<button type="button" class="agx-primary-btn" id="agxDC_agentAll" style="margin-left:auto">查看全部明细（' + list.length + '）</button></div>');
      h.push('<div class="chart" id="agxDC_agentChart" style="height:270px"></div>');
    }
    body.innerHTML = h.join("");

    drawMiniTrend("agxDC_metricTrend", mm, series, def.t);
    drawProvRankChart("agxDC_provChart", provRank.slice(0, 10), function (pname) {
      openListDrill(def.t + " · " + pname, list.filter(function (r) { return r.province === pname; }),
        { provinces: [pname], label: def.t }, true);
    });
    if (node.kpiKey === "online") drawOnlineMix(list, def);
    else drawMetricAgentBars(list);
    var pa = byId("agxDC_provAll");
    if (pa) pa.onclick = function () {
      pushDrill(newDrillNode("agentList", {
        title: def.t + " · 全部省份贡献排名", crumb: "完整排名", month: node.month,
        data: provRank.map(function (x) { return { province: x.n, count: x.v }; }),
        render: "provRank", provRank: provRank, kpiFilter: def
      }));
    };
    var aa = byId("agxDC_agentAll");
    if (aa) aa.onclick = function () {
      pushDrill(newDrillNode("agentList", {
        title: def.t + " · 全部智能体", crumb: "展开总表", month: node.month,
        data: list, sortKey: "calls", wide: true,
        intro: "口径：" + esc(def.tip)
      }));
      redrawDrawerBody();
    };
    var oa = byId("agxDC_onlineAll");
    if (oa) oa.onclick = function () {
      pushDrill(newDrillNode("agentList", {
        title: "全部上线应用", crumb: "上线应用明细", month: node.month,
        data: list, sortKey: "calls", wide: true,
        intro: "上线应用完整清单；可通过调用量筛选快速定位零调用和低频应用。"
      }));
      redrawDrawerBody();
    };
  }
  function drawMetricAgentBars(list) {
    var top = list.slice().sort(function (a, b) { return b.calls - a.calls; }).slice(0, 10).reverse();
    var c = draw("agxDC_agentChart", mergeBase({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: function (ps) { var r = top[ps[0].dataIndex]; return '<b>' + esc(r.name) + '</b><br/>' + esc(r.province) + '<br/>调用量：' + fmtInt(r.calls) + '<br/>点击查看单体档案'; } },
      grid: { left: 145, right: 42, top: 12, bottom: 26 },
      xAxis: { type: "value", axisLabel: { formatter: function (v) { return fmtWan(v); } } },
      yAxis: { type: "category", data: top.map(function (r) { return r.name.length > 11 ? r.name.slice(0, 11) + "…" : r.name; }), axisLabel: { fontSize: 10 } },
      series: [{ type: "bar", data: top.map(function (r) { return r.calls; }), barMaxWidth: 18, itemStyle: { color: "#4f7fe8", borderRadius: [0, 5, 5, 0] } }]
    }));
    if (c) c.on("click", function (p) { if (top[p.dataIndex]) openAgentProfile(top[p.dataIndex]); });
  }
  function drawOnlineMix(list, def) {
    var parts = [
      { n: "零调用", c: "#cbd5e1", rows: list.filter(function (r) { return r.calls === 0; }) },
      { n: "低频 1—1000", c: "#f59e0b", rows: list.filter(function (r) { return r.calls > 0 && r.calls <= THRESH.activeCalls; }) },
      { n: "活跃 1001—10万", c: "#14b8a6", rows: list.filter(function (r) { return r.calls > THRESH.activeCalls && r.calls <= THRESH.hotCalls; }) },
      { n: "高热度 >10万", c: "#5b7bea", rows: list.filter(function (r) { return r.calls > THRESH.hotCalls; }) }
    ];
    var c = draw("agxDC_onlineMix", mergeBase({
      tooltip: { trigger: "item", formatter: function (p) { return '<b>' + p.name + '</b><br/>应用数：' + fmtInt(p.value) + '<br/>占上线：' + p.percent.toFixed(1) + '%<br/>点击查看明细'; } },
      legend: { bottom: 2, icon: "circle" },
      series: [{ type: "pie", radius: ["46%", "72%"], center: ["50%", "44%"],
        label: { formatter: "{b}\n{c}个 · {d}%", fontSize: 11 },
        itemStyle: { borderColor: "#fff", borderWidth: 3 },
        data: parts.map(function (x) { return { name: x.n, value: x.rows.length, itemStyle: { color: x.c } }; }) }]
    }));
    if (c) c.on("click", function (p) {
      var part = parts.filter(function (x) { return x.n === p.name; })[0];
      if (part) openListDrill("上线应用 · " + part.n, part.rows, { label: part.n }, true);
    });
  }
  function drawMiniTrend(id, mm, series, name) {
    var el = byId(id);
    if (!el || !window.echarts) return;
    var c = echarts.init(el);
    charts[id] = c;
    c.setOption(mergeBase({
      tooltip: {
        trigger: "axis",
        formatter: function (ps) {
          var i = ps[0].dataIndex;
          var v = series[i];
          var p = i > 0 ? series[i - 1] : null;
          var s = '<b>' + mm[i] + '</b><br/>' + name + '：' + (v == null ? "待接入" : fmtInt(v));
          if (v != null && p != null && p !== 0) s += '<br/>环比：' + ((v - p) / Math.abs(p) * 100).toFixed(1) + '%';
          return s;
        }
      },
      grid: { left: 54, right: 18, top: 26, bottom: 28 },
      xAxis: { type: "category", data: mm },
      yAxis: { type: "value" },
      series: [{
        name: name, type: "line", data: series, connectNulls: false, symbolSize: 7,
        lineStyle: { width: 3, color: "#3b82f6" }, itemStyle: { color: "#3b82f6" },
        areaStyle: { opacity: .1, color: "#3b82f6" }
      }]
    }), true);
  }
  function drawProvRankChart(id, data, onClick) {
    var el = byId(id);
    if (!el || !window.echarts) return;
    var c = echarts.init(el);
    charts[id] = c;
    var rev = data.slice().reverse();
    c.setOption(mergeBase({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 74, right: 34, top: 12, bottom: 26 },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: rev.map(function (x) { return x.n; }) },
      series: [{
        type: "bar", data: rev.map(function (x) { return x.v; }), barMaxWidth: 22,
        itemStyle: { color: "#3b82f6", borderRadius: [0, 5, 5, 0] },
        label: { show: true, position: "right", formatter: function (p) { return fmtInt(p.value); } }
      }]
    }), true);
    c.on("click", function (p) { if (onClick && p.name) onClick(p.name); });
  }
  /* 迷你表（TOP10 预览，点击行进入档案） */
  function miniTableHtml(rows, month) {
    var cols = activeColumns(month);
    var th = cols.map(function (c) {
      return '<th class="' + (c.align === "right" ? "agx-num" : "") + '">' + esc(c.label) + '</th>';
    }).join("");
    var tb = rows.map(function (r) {
      return '<tr data-eid="' + esc(r.entityId) + '" data-m="' + esc(r.month) + '" tabindex="0" role="button" title="点击查看单应用档案">' +
        cols.map(function (c) {
          return '<td class="' + (c.align === "right" ? "agx-num" : "") + '">' + c.fmt(r) + '</td>';
        }).join("") + '</tr>';
    }).join("");
    return '<div class="agx-tblwrap short"><table class="tbl agx-tbl"><thead><tr>' + th + '</tr></thead><tbody>' +
      (tb || '<tr><td colspan="' + cols.length + '" class="agx-empty">没有匹配的应用</td></tr>') + '</tbody></table></div>';
  }
  function bindMiniTable(scopeEl, rows, onRow) {
    var trs = scopeEl.querySelectorAll("tbody tr[data-eid]");
    for (var i = 0; i < trs.length; i++) {
      (function (tr) {
        var open = function () {
          var eid = tr.getAttribute("data-eid"), m = tr.getAttribute("data-m");
          for (var x = 0; x < rows.length; x++) {
            if (rows[x].entityId === eid && rows[x].month === m) { onRow(rows[x]); return; }
          }
        };
        tr.onclick = open;
        tr.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      })(trs[i]);
    }
  }

  /* ---- 抽屉内容：单应用档案（第三级） ---- */
  function openAgentProfile(row) {
    if (!row) return;
    pushDrill(newDrillNode("agent", {
      title: row.name, crumb: row.name, month: row.month,
      entityId: row.entityId, agentMonth: row.month,
      scopePreset: { provinces: [row.province] }
    }));
    redrawDrawerBody();
  }
  function drawAgentBody(node, body) {
    buildIndexes();
    var hist = _idxEntity[node.entityId] || {};
    var r = hist[node.agentMonth] || hist[node.month];
    if (!r) {
      body.innerHTML = '<div class="agx-empty">找不到该应用的月度记录</div>';
      return;
    }
    var mm = REPORT_MONTHS;
    var callsSeries = [], effSeries = [], tokSeries = [];
    for (var i = 0; i < mm.length; i++) {
      var h = hist[mm[i]];
      callsSeries.push(h ? (h.calls || 0) : null);
      effSeries.push(h && h.effRatio != null ? h.effRatio : null);
      tokSeries.push(h && h.tokens != null ? h.tokens : null);
    }
    var pm = prevMonthOf(r.month);
    var prevR = pm ? hist[pm] : null;
    var tokOk = tokenAvailable(r.month);
    var canTok = mm.some(function (m) { return hist[m] && hist[m].tokens != null; });

    var h2 = [];
    /* 身份头部 */
    h2.push('<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:12px">');
    h2.push('<div><b style="font-size:15px;color:#1f2937">' + esc(r.name) + '</b>' +
      '<div style="font-size:12px;color:#6b7280;margin-top:4px">' + esc(r.province) + ' · ' + esc(r.type) +
      (r.servicePhase ? ' · ' + esc(r.servicePhase) : '') + (r.appScene ? ' / ' + esc(r.appScene) : '') +
      ' · 创建人 ' + esc(r.creator || "/") + ' · ' + esc(r.createdAt || "/") + '</div></div>');
    if (r.isActive) h2.push('<span class="agx-badge" style="background:#eff6ff;color:#2563eb">活跃</span>');
    if (r.isHot) h2.push('<span class="agx-badge" style="background:#f5f3ff;color:#7c3aed">高热度</span>');
    if (r.isHighEff) h2.push('<span class="agx-badge" style="background:#f0fdf4;color:#16a34a">活跃且高提效</span>');
    if (r.isPromo) h2.push('<span class="agx-badge" style="background:#eff6ff;color:#2563eb">推广</span>');
    if (r.isExcellent) h2.push('<span class="agx-badge" style="background:#f0fdfa;color:#0d9488">优秀</span>');
    if (r.isBiweek) h2.push('<span class="agx-badge" style="background:#f5f3ff;color:#7c3aed">双周优秀</span>');
    h2.push('</div>');
    h2.push('<div style="font-size:12px;color:#6b7280;margin-bottom:12px">应用场景：' +
      esc(r.appScene || "/") + '　服务环节：' + esc(r.servicePhase || "/") +
      '　应用类型：<span style="color:#94a3b8">' + esc(r.type) + '</span></div>');

    /* 当前月指标 */
    h2.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">当前月指标</div>');
    h2.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px;margin-bottom:14px">');
    h2.push(card("月调用量", fmtInt(r.calls), fmtMom(momPct(r.calls, prevR ? prevR.calls : null))));
    h2.push(card("提效比率", r.effRatio == null ? "/" : fmtPct(r.effRatio),
      r.effRatio != null && prevR && prevR.effRatio != null
        ? "较上月 " + deltaSpan(r.effRatio - prevR.effRatio, ((r.effRatio - prevR.effRatio) * 100).toFixed(1) + "个百分点")
        : "无上月可比"));
    h2.push(card("单笔节约时长", r.saveSec == null ? "/" : fmtNum(r.saveSec, 1) + "秒", "源表有值时展示"));
    h2.push(card("节约人年", r.personYear == null ? "/" : fmtNum(r.personYear, 2) + "人年", "—"));
    h2.push(card("节约金额", r.saveAmount == null ? "—" : fmtNum(r.saveAmount, 2) + "元", "—"));
    h2.push(card("产生真实价值", r.realValue == null ? "—" : fmtNum(r.realValue, 2) + "元", "—"));
    h2.push(card("是否正向价值", r.positiveValue ? '<span class="agx-badge" style="background:#f0fdf4;color:#16a34a">是</span>' : (r.positiveValue == null ? "/" : '<span class="agx-badge" style="background:#f1f5f9;color:#64748b">否</span>'), "—"));
    h2.push(card("复制量", fmtInt(r.copyCount), "—"));
    h2.push(card("上架应用广场", r.isMarketplace == null ? "/" : (r.isMarketplace ? "是" : "否"), "—"));
    h2.push(card("案例入选月份", entryMonthOf(r, null) || "/",
      (entryMonthOf(r, "promo") ? "推广 " + entryMonthOf(r, "promo") : "推广 /") +
      "　" + (entryMonthOf(r, "excellent") ? "优秀 " + entryMonthOf(r, "excellent") : "优秀 /") +
      "　" + (entryMonthOf(r, "biweek") ? "双周 " + entryMonthOf(r, "biweek") : "双周 /")));
    h2.push('</div>');

    /* Token 区 */
    h2.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">Token 与计费</div>');
    if (tokOk) {
      h2.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px;margin-bottom:14px">');
      h2.push(card("总token数", r.tokens == null ? "/" : fmtTok(r.tokens), "—"));
      h2.push(card("单次调用Token", r.tokensPerCall == null ? "/" : fmtNum(r.tokensPerCall, 0), "—"));
      h2.push(card("忙时Token", r.busyTokens == null ? "/" : fmtTok(r.busyTokens), "—"));
      h2.push(card("闲时Token", r.idleTokens == null ? "/" : fmtTok(r.idleTokens), "—"));
      h2.push(card("模型计费（元）", r.modelCost == null ? "/" : fmtNum(r.modelCost, 2), "仅辅助观察"));
      h2.push(card("忙时计费(元)", r.busyCost == null ? "/" : fmtNum(r.busyCost, 2), "—"));
      h2.push(card("闲时计费(元)", r.idleCost == null ? "/" : fmtNum(r.idleCost, 2), "—"));
      h2.push('</div>');
    } else {
      h2.push('<div class="agx-token-na">Token 数据自 ' + esc(TOKEN_START) + ' 起统计，本月不展示 Token 及模型计费。</div>');
    }

    /* 跨月趋势 */
    h2.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">跨月趋势（1—' + mm.length + '月框架）</div>');
    h2.push('<div class="chart" id="agxDC_aCalls" style="height:150px"></div>');
    h2.push('<div class="chart" id="agxDC_aEff" style="height:140px"></div>');
    if (canTok) {
      h2.push('<div style="font-size:12px;color:#6b7280;margin:8px 0 4px">Token 趋势（自 ' + esc(TOKEN_START) + ' 起）</div>');
      h2.push('<div class="chart" id="agxDC_aTok" style="height:140px"></div>');
    }
    h2.push(statusTimeline(hist, mm, "run"));
    h2.push(statusTimeline(hist, mm, "case"));

    /* 相对位置 */
    h2.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">相对位置</div>');
    h2.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">');
    h2.push(card("省内调用量排名", rankText(rankIn(rowsOfProvinceMonth(r.province, r.month), r, "calls")), "当月 " + esc(r.province)));
    h2.push(card("省内提效排名", rankText(rankIn(rowsOfProvinceMonth(r.province, r.month), r, "eff")), "当月 " + esc(r.province)));
    h2.push(card("同场景调用量排名", sceneRankText(r), r.appScene ? esc(r.appScene) : "场景未标注"));
    h2.push(card("进入运营关注", focusHitText(r), "当月运营关注名单"));
    h2.push('</div>');

    /* 基础信息 */
    h2.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">基础信息</div>');
    h2.push('<div style="font-size:12px;color:#475569;line-height:2;border:1px solid #e5e7eb;border-radius:9px;padding:11px 13px;background:#fbfdff">' +
      '应用标签：' + esc(r.tags || "/") + '<br/>' +
      '应用说明：' + esc(r.description || "/") + '<br/>' +
      '应用ID：<code style="font-size:11px">' + esc(r.appId || "/") + '</code>' +
      (r.appId ? "" : '<span style="color:#94a3b8">（源表暂缺，当前按「省份+名称+创建人」关联）</span>') +
      '</div>');
    body.innerHTML = h2.join("");

    drawMiniTrend("agxDC_aCalls", mm, callsSeries, "月调用量");
    var effEl = byId("agxDC_aEff");
    if (effEl && window.echarts) {
      var c = echarts.init(effEl); charts["agxDC_aEff"] = c;
      c.setOption(mergeBase({
        tooltip: { trigger: "axis", valueFormatter: function (v) { return v == null ? "待接入" : (v * 100).toFixed(1) + "%"; } },
        grid: { left: 54, right: 18, top: 22, bottom: 24 },
        xAxis: { type: "category", data: mm },
        yAxis: { type: "value", axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + "%"; } } },
        series: [{ name: "提效比率", type: "line", data: effSeries, connectNulls: false, symbolSize: 6,
          lineStyle: { width: 3, color: "#8b5cf6" }, itemStyle: { color: "#8b5cf6" } }]
      }), true);
    }
    if (canTok) drawMiniTrend("agxDC_aTok", mm, tokSeries, "总Token");
  }
  function card(label, value, sub) {
    return '<div class="agx-kpi" style="cursor:default"><div class="lb">' + esc(label) + '</div>' +
      '<div class="val" style="font-size:19px">' + value + '</div>' +
      '<div class="sub" style="font-size:11px">' + sub + '</div></div>';
  }
  function rankIn(list, r, by) {
    if (!list || !list.length) return null;
    var v = by === "eff" ? r.effRatio : r.calls;
    if (v == null) return null;
    var better = 0, total = 0;
    for (var i = 0; i < list.length; i++) {
      var x = by === "eff" ? list[i].effRatio : list[i].calls;
      if (x == null) continue;
      total++;
      if (x > v) better++;
    }
    return total ? { rank: better + 1, total: total } : null;
  }
  function rankText(o) {
    return o ? ("第 " + o.rank + " / " + o.total) : '<span style="color:#94a3b8">/</span>';
  }
  function sceneRankText(r) {
    if (!r.appScene) return '<span style="color:#94a3b8">样本不足</span>';
    var list = rowsOfMonth(r.month).filter(function (x) { return x.appScene === r.appScene; });
    if (list.length < 5) return '<span style="color:#94a3b8">样本不足</span>';
    return rankText(rankIn(list, r, "calls"));
  }
  function focusHitText(r) {
    var hits = [];
    if (r.isHot) hits.push("高热度TOP10");
    if (r.isHighEff) hits.push("活跃且高提效");
    if (r.isPromo && !r.isActive) hits.push("推广但未活跃");
    if (r.isExcellent || r.isBiweek) hits.push("优秀/双周标杆");
    return hits.length ? hits.join("、") : "未进入";
  }
  function statusTimeline(hist, mm, kind) {
    var cells = "";
    for (var i = 0; i < mm.length; i++) {
      var h = hist[mm[i]];
      var cls = "agx-cell zero", txt = "·", title = mm[i] + " 无数据";
      if (h) {
        if (kind === "run") {
          if (h.isHighEff) { cls = "agx-cell"; txt = "高提效"; }
          else if (h.isHot) { cls = "agx-cell"; txt = "高热度"; }
          else if (h.isActive) { cls = "agx-cell"; txt = "活跃"; }
          else { txt = "未活跃"; }
          title = mm[i] + "：" + txt + "（调用量 " + fmtInt(h.calls) + "）";
        } else {
          var tags = [];
          if (h.isPromo) tags.push("推广");
          if (h.isExcellent) tags.push("优秀");
          if (h.isBiweek) tags.push("双周");
          if (tags.length) { cls = "agx-cell"; txt = tags.join("/"); }
          title = mm[i] + "：" + (tags.length ? tags.join("/") : "无案例标签");
        }
      }
      cells += '<td class="' + cls + '" title="' + esc(title) + '" style="min-width:62px">' + txt + '</td>';
    }
    var label = kind === "run" ? "运营状态时间轴" : "案例入选时间轴";
    return '<div style="font-size:12px;color:#6b7280;margin:12px 0 5px">' + label + '</div>' +
      '<div class="agx-tblwrap" style="max-height:none"><table class="tbl agx-tbl"><thead><tr>' +
      mm.map(function (m) { return '<th style="text-align:center">' + esc(m) + '</th>'; }).join("") +
      '</tr></thead><tbody><tr>' + cells + '</tr></tbody></table></div>';
  }

  /* ==================================================================
   * 九、图表工具
   * ================================================================== */
  function merge(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }
  function chartBase() {
    return {
      textStyle: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', color: "#334155" },
      animationDuration: 420
    };
  }
  function mergeBase(opt) { return merge(chartBase(), opt || {}); }
  function draw(id, option) {
    var el = byId(id);
    if (!el || !window.echarts) return null;
    if (charts[id]) { try { charts[id].dispose(); } catch (e) {} }
    var c = echarts.init(el);
    c.setOption(option, true);
    charts[id] = c;
    return c;
  }

  /* ==================================================================
   * 十、页面骨架（严格按规范第 9 节顺序）
   * ================================================================== */
  function ensureRoot() {
    var root = byId("agRoot");
    if (root) return root;
    var panel = byId("panel-agents");
    if (!panel) return null;
    var header = panel.querySelector(".page-header");
    Array.prototype.slice.call(panel.children).forEach(function (c) {
      if (c !== header) panel.removeChild(c);
    });
    if (header) {
      var t = header.querySelector(".section-title");
      if (t) t.textContent = "智能体运营分析";
    }
    root = document.createElement("div");
    root.id = "agRoot";
    panel.appendChild(root);
    return root;
  }
  function buildShell() {
    var root = ensureRoot();
    if (!root || built) return;
    built = true;
    scopedStyle();
    ensureDrawer();
    unified = !!(document.querySelector &&
      document.querySelector('.page-toolbar[data-tab="agents"] .page-filter-bar'));
    /* 全局筛选存在时不重复渲染月份/省份；仅预览环境提供本地选择器 */
    var scopeCtl = unified
      ? '<div style="color:#6b7280;font-size:12px">月份与省份继承顶部全局筛选；本页提供形态、排名、搜索等分析维度。</div>'
      : '<div class="filter-group"><span class="filter-label">月份</span><select id="agMonth" style="height:34px;min-width:104px;border:1px solid #b9c8da;border-radius:8px;background:#fff;padding:0 10px;color:#1f355e;font-weight:650"></select></div>' +
        '<div class="filter-group"><span class="filter-label">省份</span><select id="agProvince" style="height:34px;min-width:118px;border:1px solid #b9c8da;border-radius:8px;background:#fff;padding:0 10px;color:#1f355e;font-weight:650"></select></div>' +
        '<button type="button" id="agReset" style="height:34px;border:1px solid #b9c8da;border-radius:8px;background:#f8fafc;color:#476078;padding:0 14px;cursor:pointer">重置</button>';

    root.innerHTML =
      '<div class="page-filter-bar" style="margin-bottom:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        scopeCtl + '<div id="agScope" style="margin-left:auto;color:#6b7280;font-size:12px"></div>' +
      '</div>' +

      /* 01 当月经营驾驶舱 */
      '<div class="block" style="border-top:none;padding-top:0;margin-top:0">' +
        '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">' +
          '<div class="block-title" style="margin-bottom:0">当月经营驾驶舱</div>' +
          '<span id="agScopeTip" style="font-size:12px;color:#6b7280"></span>' +
        '</div>' +
        '<div class="kpi-grid" id="agKpis" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin:14px 0 4px"></div>' +
        '<div id="agMonthNotice"></div>' +
        /* 当月运营关注（优先于形态图） */
        '<div class="agx-section-card" style="margin-top:16px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
            '<b style="color:#1f2937">当月运营关注</b>' +
            '<div class="agx-seg" id="agFocusTabs" role="group" aria-label="运营关注分类"></div>' +
            '<span id="agFocusCount" style="margin-left:auto;color:#6b7280;font-size:12px"></span>' +
            '<span id="agxFC_expand"></span>' +
          '</div>' +
          '<div id="agFocusNote"></div>' +
          '<div id="agFocusInsight" class="agx-insights"></div>' +
          '<div id="agFocusVisual" class="agx-visual-grid">' +
            '<div class="agx-visual-card"><div class="agx-visual-title"><span id="agFocusProvTitle">重点省份</span><span class="agx-summary-note">点击省份看明细</span></div><div class="chart" id="agFocusProvince" style="height:260px"></div></div>' +
            '<div class="agx-visual-card"><div class="agx-visual-title"><span id="agFocusAgentTitle">重点智能体</span><span class="agx-summary-note">点击数据点看单体档案</span></div><div class="chart" id="agFocusAgents" style="height:260px"></div></div>' +
          '</div>' +
        '</div>' +
        /* 重点案例（主 65%）＋ 应用形态构成（辅 35%） */
        '<div style="display:grid;grid-template-columns:65% 35%;gap:15px;margin-top:16px" class="agx-case-row">' +
          '<div class="chart-card">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div class="ct">重点案例运行表现</div>' +
              '<span id="agxCaseStack_expand" style="margin-left:auto"></span>' +
            '</div>' +
            '<div class="chart" id="agCaseStack" style="height:330px"></div>' +
            '<div class="agx-trendhint">点击柱体区段可下钻该类案例清单；仅区分未活跃 / 活跃两层。</div>' +
          '</div>' +
          '<div class="chart-card">' +
            '<div class="ct">调用量应用形态构成</div>' +
            '<div id="agTypeFilter" style="margin:6px 0 4px"></div>' +
            '<div class="chart" id="agTypeDonut" style="height:288px"></div>' +
            '<div class="agx-trendhint">点击形态作为全页交叉筛选；未选形态降低透明度。</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* 02 全网趋势 */
      '<div class="block"><div class="block-title" id="agTrendTitle">全网整体趋势</div>' +
        '<div class="chart-card" style="margin-bottom:15px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div class="ct">平台规模与质量协同趋势（四轨）</div>' +
            '<span class="agx-trendhint" style="margin-left:auto">共用月份轴 · 悬停查看四项绝对值与环比 · 点击数据点下钻</span>' +
          '</div>' +
          '<div class="chart" id="agTrendQuad" style="height:420px"></div>' +
        '</div>' +
        '<div class="chart-card">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<div class="ct">案例活跃率趋势</div>' +
            '<span class="agx-trendhint" style="margin-left:auto">点击数据点下钻该月该类型案例清单</span>' +
          '</div>' +
          '<div class="chart" id="agTrendCase" style="height:230px"></div>' +
        '</div>' +
      '</div>' +

      /* 03 省份智能体全景 */
      '<div class="block"><div class="block-title">省份智能体全景 <span style="font-size:12px;font-weight:500;color:#6b7280">点击省份看档案 · 点击单元格看智能体清单</span></div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:11px">' +
          '<span class="filter-label" style="font-size:12px;color:#6b7280">排名</span>' +
          '<div class="agx-seg" id="agPanRank" role="group" aria-label="省份排名指标"></div>' +
          '<span class="filter-label" style="font-size:12px;color:#6b7280;margin-left:8px">维度</span>' +
          '<div class="agx-seg" id="agPanDim" role="group" aria-label="矩阵维度"></div>' +
          '<span id="agxPan_expand" style="margin-left:auto"></span>' +
        '</div>' +
        '<div id="agPanNote" class="agx-note" style="margin-bottom:8px"></div>' +
        '<div class="agx-tblwrap" style="max-height:520px" id="agPanWrap"></div>' +
      '</div>' +

      /* 04 案例运营明细 */
      '<div class="block"><div class="block-title">案例运营明细</div>' +
        '<div class="agx-seg" id="agCaseTabs" style="margin-bottom:12px" role="group" aria-label="案例类型"></div>' +
        '<div class="kpi-grid" id="agCaseKpis" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:12px"></div>' +
        '<div id="agPromoSceneWrap" style="margin-top:14px"></div>' +
        '<div id="agCaseCharts" style="margin-top:14px"></div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 8px">' +
          '<b style="color:#1f2937;font-size:13px">案例清单</b>' +
          '<span id="agxCS_expand" style="margin-left:auto"></span>' +
        '</div>' +
        '<div id="agCaseFilter"></div>' +
        '<div id="agCaseTable"></div>' +
      '</div>' +

      /* 06 正向价值智能体分析与引导结论 */
      '<div class="block"><div class="block-title">正向价值智能体分析与引导结论 <span style="font-size:12px;font-weight:500;color:#6b7280">基于全量案例清单实时计算</span></div>' +
        '<div class="kpi-grid" id="agPosKpis" style="grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">' +
          '<div class="chart-card"><div class="ct">服务类型（服务环节）· 正向率</div><div class="chart" id="agPosType" style="height:300px"></div></div>' +
          '<div class="chart-card"><div class="ct">应用场景（小分类）· 正向率（智能体数≥5）</div><div class="chart" id="agPosPhase" style="height:300px"></div></div>' +
          '<div class="chart-card"><div class="ct">智能体名称 TOP · 正向率（按节约金额）</div><div class="chart" id="agPosScene" style="height:300px"></div></div>' +
          '<div class="chart-card"><div class="ct">推广场景 vs 自然生长 · 正向率</div><div class="chart" id="agPosPromo" style="height:300px"></div></div>' +
        '</div>' +
        '<div class="agx-section-card" style="border-color:#dbeafe">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><b style="color:#1e3a8a">分析结论与平台引导方向</b></div>' +
          '<div id="agPosConclusion"></div>' +
        '</div>' +
      '</div>' +

      /* 05 应用查询与完整明细 */
      '<div class="block"><div class="block-title">应用查询与完整明细</div>' +
        '<div id="agDetailFilter"></div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
          '<span id="agDetailCount" style="color:#6b7280;font-size:12px"></span>' +
          '<span id="agxDT_expand" style="margin-left:auto"></span>' +
        '</div>' +
        '<div id="agDetailTable"></div>' +
        '<div class="agx-note">搜索与筛选只作用于本明细，不改变上方经营指标。点击任意行查看单应用档案。</div>' +
      '</div>' +
      '<div id="agDataNote" style="margin:12px 0;color:#6b7280;font-size:12px;line-height:1.9"></div>';
  }

  /* ==================================================================
   * 十一、全局筛选与控件
   * ================================================================== */
  function renderControls() {
    var mm = months();
    if (!state.month || mm.indexOf(state.month) < 0) state.month = mm[mm.length - 1] || "";
    if (unified) {
      var gf = window.FILTER || {};
      var sel = Array.isArray(gf.months) ? gf.months.filter(function (m) { return mm.indexOf(m) >= 0; }) : [];
      if (sel.length) state.month = sel[sel.length - 1];
      state.province = gf.prov && gf.prov !== "全部省份" ? gf.prov : "ALL";
      return;
    }
    var me = byId("agMonth"), pe = byId("agProvince");
    me.innerHTML = mm.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join("");
    me.value = state.month;
    pe.innerHTML = '<option value="ALL">全国</option>' +
      provinces().map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("");
    pe.value = state.province;
    me.onchange = function () { state.month = me.value; onScopeChange(); };
    pe.onchange = function () { state.province = pe.value; onScopeChange(); };
    byId("agReset").onclick = function () {
      state.month = mm[mm.length - 1] || ""; state.province = "ALL"; state.type = "ALL";
      state.selectedTypeFromChart = null;
      state.focus = "hot"; state.caseType = "promo";
      state.panoramaRankBy = "calls"; state.panoramaDim = "operation";
      state.detailKeyword = ""; state.detailStatus = "ALL"; state.detailSort = "calls";
      resetPageNodes();
      renderControls(); renderAll();
    };
  }
  /* 切换基座月份/省份：关闭抽屉清空栈，避免旧明细与新条件混用 */
  function onScopeChange() {
    if (state.drawerOpen) closeDrawer();
    resetPageNodes();
    renderAll();
  }
  function resetPageNodes() {
    state.focusNode = null; state.caseNode = null; state.detailNode = null;
  }
  function pageNode(key, opts) {
    if (!state[key]) {
      state[key] = newDrillNode("agentList", opts);
      state[key].month = state.month;
    }
    if (opts && opts.data) state[key].data = opts.data;
    state[key].month = state.month;
    return state[key];
  }
  function segHtml(list, active) {
    return list.map(function (x) {
      return '<button type="button" data-key="' + esc(x.k) + '" class="' + (active === x.k ? "on" : "") + '">' + esc(x.t) + '</button>';
    }).join("");
  }
  function bindSeg(id, cb) {
    var box = byId(id);
    if (!box) return;
    var bs = box.querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) {
      (function (b) { b.onclick = function () { cb(b.getAttribute("data-key")); }; })(bs[i]);
    }
  }

  /* ==================================================================
   * 十二、当月经营驾驶舱：固定 5 张 KPI，全部可下钻
   * ================================================================== */
  function renderKpis() {
    var cur = scoped();
    var s = stats(cur);
    var pm = prevMonthOf(state.month);
    var prev = pm ? stats(scoped({ month: pm })) : null;
    var avail = monthAvailable(state.month);
    byId("agKpis").innerHTML =
      kpiCardHtml("online", "上线应用总数", avail ? fmtInt(s.online) : "待接入",
        avail ? diffText(s.online, prev && prev.online) : "本月明细待接入", "#476f9f", avail) +
      kpiCardHtml("calls", "月调用量", avail ? fmtWan(s.calls) : "待接入",
        avail ? fmtMom(momPct(s.calls, prev && prev.calls)) : "本月明细待接入", "#3b82f6", avail) +
      kpiCardHtml("active", "活跃智能体", avail ? fmtInt(s.active) : "待接入",
        avail ? ("活跃率 " + fmtPct(s.online ? s.active / s.online : null) + " · " + diffText(s.active, prev && prev.active)) : "本月明细待接入",
        "#14b8a6", avail) +
      kpiCardHtml("hot", "高热度智能体", avail ? fmtInt(s.hot) : "待接入",
        avail ? ("占活跃 " + fmtPct(s.active ? s.hot / s.active : null) + " · " + diffText(s.hot, prev && prev.hot)) : "本月明细待接入",
        "#8b5cf6", avail) +
      kpiCardHtml("highEff", "活跃且高提效智能体", avail ? fmtInt(s.high) : "待接入",
        avail ? ("占活跃 " + fmtPct(s.active ? s.high / s.active : null) + " · " + diffText(s.high, prev && prev.high)) : "本月明细待接入",
        "#22c55e", avail);
    var kb = byId("agKpis").querySelectorAll(".agx-kpi");
    for (var i = 0; i < kb.length; i++) {
      (function (el) {
        var k = el.getAttribute("data-kpi");
        el.onclick = function () { openKpiDrill(k); };
        el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openKpiDrill(k); } };
      })(kb[i]);
    }
    byId("agScopeTip").textContent = "当前范围：" + state.month + "｜" +
      (state.province === "ALL" ? "全国" : state.province) + "｜" +
      (state.type === "ALL" ? "全部应用" : state.type);
    byId("agMonthNotice").innerHTML = avail ? "" :
      '<div class="agx-token-na" style="margin:10px 0 0">' + esc(state.month) +
      ' 应用明细待补齐，本页框架已就绪；缺失指标显示「待接入」，不以其他月份数据代替。</div>';
  }
  function kpiCardHtml(key, label, value, sub, color, enabled) {
    return '<div class="agx-kpi" data-kpi="' + key + '" tabindex="0" role="button" ' +
      'title="' + (enabled ? "点击查看趋势、分布与问题明细" : "本月明细待接入，暂不可下钻") + '"' +
      (enabled ? "" : ' style="opacity:.62;cursor:not-allowed"') + '>' +
      '<div class="lb">' + esc(label) + '</div>' +
      '<div class="val" style="color:' + color + '">' + value + '</div>' +
      '<div class="sub">' + sub + '</div>' +
      '<div class="go">' + (enabled ? "查看分析 ›" : "待接入") + '</div></div>';
  }

  /* ==================================================================
   * 十三、当月运营关注（5 个 Tab，含低Token高提效）
   * ================================================================== */
  var FOCUS_TABS = [
    { k: "hot", t: "高热度智能体" },
    { k: "high", t: "活跃且高提效" },
    { k: "lowToken", t: "低Token高提效" },
    { k: "promoIdle", t: "推广但未活跃" },
    { k: "benchmark", t: "优秀/双周标杆" }
  ];
  /* 同类比较层级：优先同月同场景（>=5）→ 同月同形态 → 同月全体使用大模型的活跃应用 */
  function peerMedian(row, pool) {
    var scene = row.appScene;
    if (scene) {
      var same = pool.filter(function (r) { return r.appScene === scene; });
      if (same.length >= 5) return { v: median(same.map(function (r) { return r.tokensPerCall; })), level: "同场景（" + scene + "，n=" + same.length + "）" };
    }
    var sameType = pool.filter(function (r) { return r.type === row.type; });
    if (sameType.length >= 5) return { v: median(sameType.map(function (r) { return r.tokensPerCall; })), level: "同形态（" + row.type + "，n=" + sameType.length + "）" };
    if (pool.length >= 5) return { v: median(pool.map(function (r) { return r.tokensPerCall; })), level: "全体大模型活跃应用（n=" + pool.length + "）" };
    return { v: null, level: "样本不足" };
  }
  function lowTokenRows(list) {
    if (!tokenAvailable(state.month)) return { ok: false, rows: [] };
    var pool = list.filter(function (r) {
      return r.isLLM && r.calls > THRESH.activeCalls && r.effRatio != null &&
        r.effRatio > THRESH.highEffRatio && r.tokens != null && r.tokens > 0;
    });
    if (!pool.length) return { ok: true, rows: [], pool: pool };
    var out = pool.filter(function (r) {
      var pm = peerMedian(r, pool);
      return pm.v != null && r.tokensPerCall != null && r.tokensPerCall <= pm.v;
    });
    out.sort(function (a, b) {
      var d = (b.effRatio || 0) - (a.effRatio || 0);
      if (Math.abs(d) > 1e-9) return d;
      var d2 = (a.tokensPerCall == null ? Infinity : a.tokensPerCall) - (b.tokensPerCall == null ? Infinity : b.tokensPerCall);
      if (Math.abs(d2) > 1e-9) return d2;
      return (b.calls || 0) - (a.calls || 0);
    });
    return { ok: true, rows: out, pool: pool };
  }
  function focusRows() {
    var list = scoped();
    if (state.focus === "hot") return list.filter(function (r) { return r.isHot; });
    if (state.focus === "high") return list.filter(function (r) { return r.isHighEff; });
    if (state.focus === "promoIdle") return list.filter(function (r) { return r.isPromo && !r.isActive; });
    if (state.focus === "benchmark") return list.filter(function (r) { return r.isExcellent || r.isBiweek; });
    return [];
  }
  function renderFocus() {
    byId("agFocusTabs").innerHTML = segHtml(FOCUS_TABS, state.focus);
    bindSeg("agFocusTabs", function (k) { state.focus = k; state.focusNode = null; renderFocus(); });
    var avail = monthAvailable(state.month);
    var tokOk = tokenAvailable(state.month);
    var rows = [], note = "";

    if (state.focus === "lowToken") {
      if (!avail) {
        note = '<div class="agx-token-na">' + esc(state.month) + ' 应用明细待接入，暂不支持低Token分析。</div>';
      } else if (!tokOk) {
        /* 1—5 月：保留模块位置的结构化空状态，不降级、不补 0、不跳月 */
        note = '<div class="agx-token-na"><b>Token 数据自 ' + esc(TOKEN_START) + ' 起统计</b><br/>' +
          '当前月份暂不支持低Token分析，其他运营指标不受影响。</div>';
      } else {
        var r = lowTokenRows(scoped());
        rows = r.rows;
        note = '<div class="agx-note">候选池：使用大模型 · 月调用量 &gt; ' + THRESH.activeCalls +
          ' · 提效比率 &gt; ' + (THRESH.highEffRatio * 100).toFixed(0) + '% · Token 非空。<br/>' +
          '「低Token」＝ 单次调用Token ≤ 同类中位数；同类优先取同月同场景（样本≥5），不足时回退同形态，再不足回退同月全体使用大模型的活跃应用。<br/>' +
          '排序：提效比率降序 → 单次调用Token升序 → 调用量降序。本模块只做观察，不做金额折算。</div>';
      }
    } else if (!avail) {
      note = '<div class="agx-token-na">' + esc(state.month) + ' 应用明细待接入。</div>';
    } else {
      rows = focusRows();
      rows.sort(function (a, b) { return b.calls - a.calls; });
    }
    byId("agFocusNote").innerHTML = note;
    byId("agFocusCount").textContent = rows.length ? ("当前 " + rows.length + " 个") : "暂无可分析对象";
    renderFocusVisual(rows, avail, tokOk);
    var ex = byId("agxFC_expand");
    if (ex) {
      if (!rows.length) { ex.innerHTML = '<button type="button" class="agx-exp" disabled>查看全部明细（0）</button>'; }
      else {
        ex.innerHTML = '<button type="button" class="agx-primary-btn" id="agxFC_btn">查看全部明细（' + rows.length + '）</button>';
        byId("agxFC_btn").onclick = function () {
          var n = newDrillNode("agentList", {
            title: (FOCUS_TABS.filter(function (x) { return x.k === state.focus; })[0] || {}).t + " · 完整清单",
            crumb: "展开总表", month: state.month, data: rows,
            sortKey: state.focus === "lowToken" && tokOk ? "effRatio" : "calls",
            wide: true,
            intro: note.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          });
          pushDrill(n);
          redrawDrawerBody();
        };
      }
    }
  }
  function renderFocusVisual(rows, avail, tokOk) {
    var visual = byId("agFocusVisual"), insight = byId("agFocusInsight");
    if (!visual || !insight) return;
    if (!avail || !rows.length) {
      visual.style.display = "block";
      visual.innerHTML = '<div class="agx-empty" style="border:1px dashed #d7e1ec;border-radius:12px">' +
        (state.focus === "lowToken" && !tokOk ? "Token 数据尚未开始统计，本月不做替代评价" : "当前范围内没有可分析对象") + '</div>';
      insight.innerHTML = "";
      return;
    }
    visual.style.display = "grid";
    visual.innerHTML =
      '<div class="agx-visual-card"><div class="agx-visual-title"><span id="agFocusProvTitle">重点省份</span><span class="agx-summary-note">点击省份看明细</span></div><div class="chart" id="agFocusProvince" style="height:260px"></div></div>' +
      '<div class="agx-visual-card"><div class="agx-visual-title"><span id="agFocusAgentTitle">重点智能体</span><span class="agx-summary-note">点击数据点看单体档案</span></div><div class="chart" id="agFocusAgents" style="height:260px"></div></div>';

    var calls = rows.reduce(function (s, r) { return s + (r.calls || 0); }, 0);
    var activeN = rows.filter(function (r) { return r.isActive; }).length;
    var caseN = rows.filter(function (r) { return r.isPromo || r.isExcellent || r.isBiweek; }).length;
    var insightHtml = '<span class="agx-insight">对象数 <b>' + fmtInt(rows.length) + '</b></span>' +
      '<span class="agx-insight">合计调用 <b>' + fmtWan(calls) + '</b></span>' +
      '<span class="agx-insight">活跃占比 <b>' + fmtPct(rows.length ? activeN / rows.length : null) + '</b></span>' +
      '<span class="agx-insight">案例对象 <b>' + fmtInt(caseN) + '</b></span>';
    if (state.focus === "lowToken") {
      insightHtml += '<span class="agx-insight">单次调用Token中位数 <b>' + fmtNum(median(rows.map(function (r) { return r.tokensPerCall; })), 0) + '</b></span>';
    }
    insight.innerHTML = insightHtml;

    var byProv = {};
    rows.forEach(function (r) {
      if (!byProv[r.province]) byProv[r.province] = { n: r.province, v: 0, rows: [] };
      byProv[r.province].v++;
      byProv[r.province].rows.push(r);
    });
    var prov = Object.keys(byProv).map(function (k) { return byProv[k]; })
      .sort(function (a, b) { return b.v - a.v || b.rows.reduce(function (s, r) { return s + r.calls; }, 0) - a.rows.reduce(function (s, r) { return s + r.calls; }, 0); })
      .slice(0, 10);
    byId("agFocusProvTitle").textContent = "重点省份 TOP10（按对象数）";
    drawProvRankChart("agFocusProvince", prov, function (pname) {
      var d = byProv[pname];
      if (d) openListDrill((FOCUS_TABS.filter(function (x) { return x.k === state.focus; })[0] || {}).t + " · " + pname,
        d.rows, { provinces: [pname], label: "运营关注" }, true);
    });

    var scatterMode = state.focus === "high" || state.focus === "lowToken" || state.focus === "benchmark";
    var title = state.focus === "lowToken" ? "提效 × 单次调用Token" : (scatterMode ? "调用规模 × 提效表现" : "重点智能体 TOP10（按调用量）");
    byId("agFocusAgentTitle").textContent = title;
    if (scatterMode) drawFocusScatter(rows);
    else drawFocusAgentBars(rows);
  }
  function drawFocusAgentBars(rows) {
    var top = rows.slice().sort(function (a, b) { return b.calls - a.calls; }).slice(0, 10).reverse();
    var c = draw("agFocusAgents", mergeBase({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: function (ps) {
        var p = ps[0], r = top[p.dataIndex];
        return '<b>' + esc(r.name) + '</b><br/>' + esc(r.province) + '<br/>调用量：' + fmtInt(r.calls) + '<br/>点击查看单体档案';
      } },
      grid: { left: 130, right: 34, top: 12, bottom: 24 },
      xAxis: { type: "value", axisLabel: { formatter: function (v) { return fmtWan(v); } } },
      yAxis: { type: "category", data: top.map(function (r) { return r.name.length > 10 ? r.name.slice(0, 10) + "…" : r.name; }), axisLabel: { fontSize: 10 } },
      series: [{ type: "bar", data: top.map(function (r) { return r.calls; }), barMaxWidth: 18,
        itemStyle: { color: "#4f7fe8", borderRadius: [0, 5, 5, 0] } }]
    }));
    if (c) c.on("click", function (p) { if (top[p.dataIndex]) openAgentProfile(top[p.dataIndex]); });
  }
  function drawFocusScatter(rows) {
    var lowTok = state.focus === "lowToken";
    var data = rows.filter(function (r) { return r.effRatio != null && (!lowTok || r.tokensPerCall != null); }).map(function (r) {
      return { value: [lowTok ? r.tokensPerCall : Math.max(1, r.calls), r.effRatio * 100, r.calls], name: r.name, row: r };
    });
    var c = draw("agFocusAgents", mergeBase({
      tooltip: { trigger: "item", formatter: function (p) { var r = p.data.row; return '<b>' + esc(r.name) + '</b><br/>' + esc(r.province) +
        '<br/>调用量：' + fmtInt(r.calls) + '<br/>提效：' + fmtPct(r.effRatio) +
        (lowTok ? '<br/>单次调用Token：' + fmtNum(r.tokensPerCall, 0) : '') + '<br/>点击查看单体档案'; } },
      grid: { left: 58, right: 24, top: 18, bottom: 42 },
      xAxis: { type: "log", name: lowTok ? "单次调用Token" : "月调用量", nameLocation: "middle", nameGap: 27,
        axisLabel: { formatter: function (v) { return lowTok ? fmtNum(v, 0) : fmtWan(v); } } },
      yAxis: { type: "value", name: "提效比率", axisLabel: { formatter: "{value}%" }, min: 0 },
      series: [{ type: "scatter", data: data, symbolSize: function (v) { return Math.max(8, Math.min(24, 7 + Math.log(Math.max(1, v[2])) / Math.log(10) * 2)); },
        itemStyle: { color: lowTok ? "#14b8a6" : "#5b7bea", opacity: .72, borderColor: "#fff", borderWidth: 1 }, emphasis: { scale: 1.35 } }]
    }));
    if (c) c.on("click", function (p) { if (p.data && p.data.row) openAgentProfile(p.data.row); });
  }

  /* ==================================================================
   * 十四、重点案例运行表现 ＋ 应用形态构成
   * ================================================================== */
  var CASE_KINDS = [
    { k: "promo", t: "推广案例" }, { k: "excellent", t: "优秀案例" }, { k: "biweek", t: "双周优秀" }
  ];
  function caseRowsOf(kind, list) {
    var ls = list || scoped();
    var f = kind === "promo" ? function (r) { return r.isPromo; }
      : kind === "excellent" ? function (r) { return r.isExcellent; }
      : function (r) { return r.isBiweek; };
    return ls.filter(f);
  }
  function renderCaseStack() {
    var list = scoped();
    var names = CASE_KINDS.map(function (x) { return x.t; });
    var data = CASE_KINDS.map(function (x) { return caseRowsOf(x.k, list); });
    var activeCnt = data.map(function (rs) {
      return rs.filter(function (r) { return r.isActive; }).length;
    });
    var pm = prevMonthOf(state.month);
    var prevActive = pm ? CASE_KINDS.map(function (x) {
      return caseRowsOf(x.k, scoped({ month: pm })).filter(function (r) { return r.isActive; }).length;
    }) : null;
    var c = draw("agCaseStack", mergeBase({
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: function (ps) {
          var i = ps[0].dataIndex;
          var rs = data[i], ac = activeCnt[i];
          var calls = rs.reduce(function (s, r) { return s + (r.calls || 0); }, 0);
          var pa = prevActive ? prevActive[i] : null;
          return '<b>' + names[i] + '</b><br/>当月在册：' + rs.length +
            '<br/>活跃：' + ac + '（' + fmtPct(rs.length ? ac / rs.length : null) + '）' +
            '<br/>月调用量：' + fmtWan(calls) +
            '<br/>活跃数环比：' + (pa == null ? "无上月可比" : diffText(ac, pa).replace(/<[^>]+>/g, ""));
        }
      },
      legend: { top: 6 },
      grid: { left: 54, right: 24, top: 44, bottom: 40 },
      xAxis: { type: "category", data: names },
      yAxis: { type: "value", name: "应用数" },
      series: [
        { name: "未活跃", type: "bar", stack: "cs", barMaxWidth: 74,
          data: data.map(function (rs, i) { return rs.length - activeCnt[i]; }), itemStyle: { color: "#cbd5e1" } },
        { name: "活跃", type: "bar", stack: "cs", barMaxWidth: 74,
          data: activeCnt, itemStyle: { color: "#3b82f6" },
          label: { show: true, position: "top", color: "#334155", lineHeight: 16,
            formatter: function (p) {
              var i = p.dataIndex;
              return data[i].length + "个\n活跃率 " + (data[i].length ? (activeCnt[i] / data[i].length * 100).toFixed(0) : 0) + "%";
            } } }
      ]
    }));
    if (c) c.on("click", function (p) {
      var kind = CASE_KINDS[p.dataIndex];
      if (!kind) return;
      var rs = caseRowsOf(kind.k);
      var sub = p.seriesName === "未活跃"
        ? rs.filter(function (r) { return !r.isActive; })
        : (p.seriesName === "活跃" ? rs.filter(function (r) { return r.isActive; }) : rs);
      openListDrill(kind.t + (p.seriesName === "未活跃" ? " · 未活跃" : (p.seriesName === "活跃" ? " · 活跃" : " · 全部")),
        sub, { label: kind.t + (p.seriesName && p.seriesName !== "" ? " · " + p.seriesName : "") });
    });
    var ex = byId("agxCaseStack_expand");
    if (ex) {
      var all = [];
      CASE_KINDS.forEach(function (k) { caseRowsOf(k.k).forEach(function (r) { all.push(r); }); });
      var seen = {}, uniq = [];
      all.forEach(function (r) { if (!seen[r.entityId]) { seen[r.entityId] = 1; uniq.push(r); } });
      ex.innerHTML = '<button type="button" class="agx-exp" id="agxCS_btn">展开三类案例总表（' + uniq.length + '）</button>';
      byId("agxCS_btn").onclick = function () {
        openListDrill("推广 / 优秀 / 双周 案例去重总表", uniq,
          { label: "三类标签去重" }, true);
      };
    }
  }
  function openListDrill(title, rows, scopePreset, wide, inheritedFilters, month) {
    var f = cloneFilters(inheritedFilters || defaultFilters());
    if (scopePreset && scopePreset.provinces && !f.provinces.length) f.provinces = scopePreset.provinces.slice();
    pushDrill(newDrillNode("agentList", {
      title: title, crumb: title, month: month || state.month, data: rows,
      filters: f, sortKey: "calls", wide: !!wide, scopePreset: scopePreset
    }));
    redrawDrawerBody();
  }
  function renderTypeDonut() {
    var base = scoped({ type: "ALL" });
    var by = {}, order = { "智能体": 1, "工作流": 2, "对话流": 3, "其他": 9 };
    base.forEach(function (r) { by[r.type] = (by[r.type] || 0) + (r.calls || 0); });
    var keys = Object.keys(by).sort(function (a, b) { return (order[a] || 8) - (order[b] || 8); });
    var total = 0;
    keys.forEach(function (k) { total += by[k]; });
    var colors = { "智能体": "#3b82f6", "工作流": "#14b8a6", "对话流": "#8b5cf6", "其他": "#94a3b8" };
    var c = draw("agTypeDonut", mergeBase({
      tooltip: {
        trigger: "item",
        formatter: function (p) {
          return '<b>' + p.name + '</b><br/>调用量：' + fmtInt(p.value) + '<br/>占比：' +
            (total ? (p.value / total * 100).toFixed(1) : 0) + '%<br/>点击可筛选全页';
        }
      },
      legend: { bottom: 2, icon: "circle" },
      series: [{
        type: "pie", radius: ["42%", "68%"], center: ["50%", "43%"],
        label: { formatter: "{b}\n{d}%", fontSize: 11 },
        itemStyle: { borderColor: "#fff", borderWidth: 3 },
        data: keys.map(function (k) {
          return {
            name: k, value: by[k],
            itemStyle: {
              color: colors[k] || "#94a3b8",
              opacity: (state.type === "ALL" || state.type === k) ? 1 : 0.25,
              borderColor: state.type === k ? "#1e40af" : "#fff",
              borderWidth: state.type === k ? 5 : 3
            }
          };
        })
      }],
      graphic: [{
        type: "text", left: "center", top: "36%",
        style: {
          text: state.type === "ALL" ? "全部调用\n" + fmtWan(total)
            : state.type + "\n" + fmtWan(by[state.type] || 0),
          textAlign: "center", fill: "#1f2937", font: "700 15px sans-serif", lineHeight: 21
        }
      }]
    }));
    if (c) c.on("click", function (p) {
      state.type = (state.type === p.name) ? "ALL" : p.name;
      state.selectedTypeFromChart = state.type === "ALL" ? null : state.type;
      resetPageNodes();
      renderAll();
    });
    var fbox = byId("agTypeFilter");
    if (fbox) {
      if (state.type === "ALL") {
        fbox.innerHTML = '<span class="agx-trendhint">当前未做形态筛选，点击扇区可筛全页。</span>';
      } else {
        fbox.innerHTML = '<span class="agx-scope-tag">当前形态：' + esc(state.type) +
          ' <button type="button" id="agxTypeClear" aria-label="清除形态筛选">×</button></span>';
        var b = byId("agxTypeClear");
        if (b) b.onclick = function () {
          state.type = "ALL"; state.selectedTypeFromChart = null;
          resetPageNodes(); renderAll();
        };
      }
    }
  }

  /* ==================================================================
   * 十五、全网四轨同步趋势
   * ================================================================== */
  var TREND_TRACKS = [
    { k: "calls", n: "月调用量", c: "#3b82f6", pick: function (s) { return s.calls; } },
    { k: "active", n: "活跃智能体数", c: "#14b8a6", pick: function (s) { return s.active; } },
    { k: "hot", n: "高热度智能体数", c: "#8b5cf6", pick: function (s) { return s.hot; } },
    { k: "highEff", n: "活跃且高提效数", c: "#22c55e", pick: function (s) { return s.high; } }
  ];
  function renderTrends() {
    var mm = REPORT_MONTHS;
    var ss = mm.map(function (m) {
      if (!monthAvailable(m)) return null;
      return stats(scoped({ month: m, province: state.province, type: state.type }));
    });
    var byIdTitle = byId("agTrendTitle");
    if (byIdTitle) {
      byIdTitle.innerHTML = '全网 1—' + mm.length + '月整体趋势 ' +
        '<span style="font-size:12px;font-weight:500;color:#6b7280">固定' +
        (state.province === "ALL" ? "全网" : esc(state.province)) +
        '口径 · 缺失月份断线显示「待接入」</span>';
    }
    var grids = [], xAxes = [], yAxes = [], series = [];
    var top = 34, gap = 12;
    var h = Math.floor((420 - top - 40 - gap * 3) / 4);
    for (var i = 0; i < 4; i++) {
      var yp = top + i * (h + gap);
      grids.push({ left: 62, right: 26, top: yp, height: h });
      xAxes.push({
        type: "category", gridIndex: i, data: mm,
        axisLabel: { show: i === 3, fontSize: 11 },
        axisTick: { show: i === 3 }, axisLine: { show: i === 3 },
        axisPointer: { show: true, label: { show: i === 3 } }
      });
      yAxes.push({
        type: "value", gridIndex: i, name: TREND_TRACKS[i].n,
        nameTextStyle: { fontSize: 11, color: "#6b7280", align: "left" },
        nameGap: 12,
        axisLabel: { fontSize: 10, formatter: function (v) { return fmtWan(v); } },
        splitLine: { lineStyle: { color: "#eef2f6" } }
      });
      var vals = ss.map(function (s) { return s ? TREND_TRACKS[i].pick(s) : null; });
      series.push({
        name: TREND_TRACKS[i].n, type: "line", xAxisIndex: i, yAxisIndex: i,
        data: vals, connectNulls: false, symbolSize: 6, smooth: true,
        lineStyle: { width: 2.6, color: TREND_TRACKS[i].c },
        itemStyle: { color: TREND_TRACKS[i].c },
        areaStyle: { opacity: .10, color: TREND_TRACKS[i].c },
        markPoint: state.month ? {
          symbol: "circle", symbolSize: 11,
          data: [{ coord: [state.month, ss[mm.indexOf(state.month)] ? TREND_TRACKS[i].pick(ss[mm.indexOf(state.month)]) : null],
            itemStyle: { color: TREND_TRACKS[i].c, borderColor: "#fff", borderWidth: 2 } }]
        } : undefined
      });
    }
    var c = draw("agTrendQuad", mergeBase({
      axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: "#94a3b8", width: 1, type: "dashed" } },
      tooltip: {
        trigger: "axis", axisPointer: { type: "line" },
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var i = ps[0].dataIndex;
          var s = '<b>' + mm[i] + '</b>';
          if (!monthAvailable(mm[i])) return s + '<br/><span style="color:#94a3b8">待接入</span>';
          for (var k = 0; k < TREND_TRACKS.length; k++) {
            var cur = ss[i] ? TREND_TRACKS[k].pick(ss[i]) : null;
            var pv = (i > 0 && ss[i - 1]) ? TREND_TRACKS[k].pick(ss[i - 1]) : null;
            var momTxt = (cur != null && pv != null && pv !== 0)
              ? ' <span style="color:' + ((cur - pv) > 0 ? "#ef4444" : ((cur - pv) < 0 ? "#22c55e" : "#6b7280")) + '">' +
                ((cur - pv) / Math.abs(pv) * 100 >= 0 ? "+" : "") + ((cur - pv) / Math.abs(pv) * 100).toFixed(1) + '%</span>'
              : ' <span style="color:#94a3b8">—</span>';
            s += '<br/>' + TREND_TRACKS[k].n + '：<b>' + fmtInt(cur) + '</b>' + momTxt;
          }
          return s;
        }
      },
      grid: grids, xAxis: xAxes, yAxis: yAxes, series: series
    }));
    if (c) c.on("click", function (p) {
      if (p == null || p.dataIndex == null) return;
      var m = mm[p.dataIndex];
      if (!monthAvailable(m)) return;
      openTrendMonthDrill(m, p.seriesName);
    });

    /* 案例活跃率趋势 */
    var rates = CASE_KINDS.map(function (k) {
      return mm.map(function (m) {
        if (!monthAvailable(m)) return null;
        var rs = caseRowsOf(k.k, scoped({ month: m }));
        if (!rs.length) return null;
        var ac = rs.filter(function (r) { return r.isActive; }).length;
        return ac / rs.length;
      });
    });
    var cc = draw("agTrendCase", mergeBase({
      tooltip: {
        trigger: "axis",
        formatter: function (ps) {
          var i = ps[0].dataIndex;
          if (!monthAvailable(mm[i])) return '<b>' + mm[i] + '</b><br/><span style="color:#94a3b8">待接入</span>';
          return '<b>' + mm[i] + '</b><br/>' + ps.map(function (p) {
            return p.marker + p.seriesName + '：<b>' + (p.value == null ? "/" : (p.value * 100).toFixed(1) + '%') + '</b>';
          }).join('<br/>') + '<br/><span style="color:#94a3b8">口径：活跃案例 / 当月在册案例</span>';
        }
      },
      legend: { top: 4 },
      grid: { left: 56, right: 22, top: 42, bottom: 30 },
      xAxis: { type: "category", data: mm },
      yAxis: { type: "value", max: 1, axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + "%"; } } },
      series: CASE_KINDS.map(function (k, i) {
        return {
          name: k.t, type: "line", data: rates[i], connectNulls: false, symbolSize: 6,
          lineStyle: { width: 2.6, color: ["#3b82f6", "#14b8a6", "#8b5cf6"][i] },
          itemStyle: { color: ["#3b82f6", "#14b8a6", "#8b5cf6"][i] }
        };
      })
    }));
    if (cc) cc.on("click", function (p) {
      var m = mm[p.dataIndex];
      if (!monthAvailable(m)) return;
      var kind = CASE_KINDS.filter(function (k) { return k.t === p.seriesName; })[0];
      if (!kind) return;
      var rs = caseRowsOf(kind.k, scoped({ month: m }));
      rs.sort(function (a, b) { return (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0) || b.calls - a.calls; });
      pushDrill(newDrillNode("agentList", {
        title: m + " · " + kind.t + "清单", crumb: kind.t, month: m, data: rs,
        sortKey: "calls", wide: true,
        intro: "默认排序：未活跃优先，再按调用量降序。可用下方「活跃状态」筛选只看未活跃。"
      }));
      redrawDrawerBody();
    });
  }
  /* 趋势图数据点下钻：省份贡献 TOP10 + 应用 TOP10 + 展开全部 + 与上月变化 */
  function openTrendMonthDrill(month, trackName) {
    var track = TREND_TRACKS.filter(function (x) { return x.n === trackName; })[0];
    var rows = scoped({ month: month });
    var list = rows;
    if (track) {
      if (track.k === "active") list = rows.filter(function (r) { return r.isActive; });
      else if (track.k === "hot") list = rows.filter(function (r) { return r.isHot; });
      else if (track.k === "highEff") list = rows.filter(function (r) { return r.isHighEff; });
    }
    pushDrill(newDrillNode("trendMonth", {
      title: month + " · " + (track ? track.n : "全网应用"), crumb: month + " " + (track ? track.n : "全网"),
      month: month, data: list, sortKey: "calls", wide: true, track: track
    }));
    redrawDrawerBody();
  }
  function drawTrendMonthBody(node, body) {
    var m = node.month, list = node.data || [];
    var pm = prevMonthOf(m);
    var prevIds = pm ? {} : null;
    if (pm) {
      var prs = scoped({ month: pm });
      for (var q = 0; q < prs.length; q++) prevIds[prs[q].entityId] = prs[q];
    }
    var byProv = {};
    for (var i = 0; i < list.length; i++) byProv[list[i].province] = (byProv[list[i].province] || 0) + 1;
    var provRank = Object.keys(byProv).map(function (p) { return { n: p, v: byProv[p] }; })
      .sort(function (a, b) { return b.v - a.v; });
    var curS = stats(list);
    var prevS = pm ? stats(scoped({ month: pm })) : null;

    var canIdentity = identityReliable();
    var entered = [], exited = [];
    if (prevIds && canIdentity) {
      var curIds = {};
      for (var j = 0; j < list.length; j++) curIds[list[j].entityId] = list[j];
      Object.keys(curIds).forEach(function (eid) { if (!prevIds[eid]) entered.push(curIds[eid]); });
      Object.keys(prevIds).forEach(function (eid) { if (!curIds[eid]) exited.push(prevIds[eid]); });
    }

    var h = [];
    var tmFiltered = applyFilters(list, node.filters);
    h.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px">' +
      card("当月数量", fmtInt(list.length), pm ? diffText(list.length, prevIds ? Object.keys(prevIds).length : null) : "无上月可比") +
      card("月调用量", fmtWan(curS.calls), prevS ? fmtMom(momPct(curS.calls, prevS.calls)) : "无上月可比") +
      card("活跃数", fmtInt(curS.active), prevS ? diffText(curS.active, prevS.active) : "无上月可比") +
      card("高热度数", fmtInt(curS.hot), prevS ? diffText(curS.hot, prevS.hot) : "无上月可比") +
      card("活跃高提效数", fmtInt(curS.high), prevS ? diffText(curS.high, prevS.high) : "无上月可比") +
      '</div>');
    h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 6px">' +
      '<b style="font-size:13px;color:#1f2937">省份贡献 TOP10</b>' +
      '<button type="button" class="agx-exp" id="agxTM_provAll" style="margin-left:auto">查看完整排名（' + provRank.length + '）</button></div>');
    h.push('<div class="chart" id="agxDC_tmProv" style="height:' + Math.max(190, Math.min(10, provRank.length) * 29) + 'px"></div>');
    h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 6px">' +
      '<b style="font-size:13px;color:#1f2937">应用 TOP10</b>' +
      '<button type="button" class="agx-exp" id="agxTM_all" style="margin-left:auto">查看筛选后明细（' + tmFiltered.length + ' / ' + list.length + '）</button></div>');
    h.push(renderFilterBar("agxTM_", node, { compact: true }));
    h.push(renderAgentTable("agxTM_", tmFiltered, node, { limit: 10, hidePager: true, short: true }).html);
    h.push('<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px">');
    h.push('<div><b style="font-size:13px;color:#1f2937">本月新进入</b>' +
      (canIdentity ? '' : '<div class="agx-note">应用ID不可用，不推断新增/退出。</div>') + '</div>');
    h.push('<div><b style="font-size:13px;color:#1f2937">本月退出</b>' +
      (canIdentity ? '' : '<div class="agx-note">应用ID不可用，不推断新增/退出。</div>') + '</div>');
    h.push('</div>');
    if (canIdentity) {
      h.push('<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
        '<div>' + (entered.length ? miniTableHtml(entered.slice(0, 10), m) : '<div class="agx-note">无</div>') + '</div>' +
        '<div>' + (exited.length ? miniTableHtml(exited.slice(0, 10), m) : '<div class="agx-note">无</div>') + '</div></div>');
    }
    body.innerHTML = h.join("");
    drawProvRankChart("agxDC_tmProv", provRank.slice(0, 10), function (pname) {
      pushDrill(newDrillNode("province", { title: pname + " 省份档案", crumb: pname, month: m }));
    });
    bindFilterBar("agxTM_", node, function () { redrawDrawerBody(); });
    bindAgentTable("agxTM_", tmFiltered, node, function () { redrawDrawerBody(); }, openAgentProfile);
    if (canIdentity) {
      bindMiniTable(body, entered.slice(0, 10), openAgentProfile);
      bindMiniTable(body, exited.slice(0, 10), openAgentProfile);
    }
    var pa = byId("agxTM_provAll");
    if (pa) pa.onclick = function () {
      pushDrill(newDrillNode("agentList", {
        title: m + " · 省份完整排名", crumb: "完整排名", month: m, data: list,
        render: "provRank", provRank: provRank, sortKey: "calls"
      }));
    };
    var aa = byId("agxTM_all");
    if (aa) aa.onclick = function () {
      openListDrill(m + " · " + (node.track ? node.track.n : "全网应用") + " 全部清单", list,
        { label: node.track ? node.track.n : "全网" }, true, node.filters, m);
    };
  }
  /* 省份排名表（非智能体行） */
  function drawProvRankBody(node, body) {
    var rank = node.provRank || [];
    var kw = (node.filters.keyword || "").toLowerCase();
    var rows = rank.filter(function (x) { return !kw || x.n.toLowerCase().indexOf(kw) >= 0; });
    var h = '<div class="agx-tblwrap"><table class="tbl agx-tbl"><thead><tr>' +
      '<th class="agx-num">排名</th><th>省份</th><th class="agx-num">数量</th><th>操作</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      h += '<tr><td class="agx-num">' + (i + 1) + '</td><td><b>' + esc(rows[i].n) + '</b></td>' +
        '<td class="agx-num">' + fmtInt(rows[i].v) + '</td>' +
        '<td><button type="button" class="agx-exp" data-p="' + esc(rows[i].n) + '">' +
        (node.kpiFilter ? "查看指标明细" : "查看该省档案") + '</button></td></tr>';
    }
    h += '</tbody></table></div>';
    body.innerHTML = '<div class="agx-fbar"><span class="lb">搜索</span>' +
      '<input type="search" id="agxPR_kw" value="' + esc(node.filters.keyword) + '" placeholder="省份名称" aria-label="按省份名称搜索"/></div>' +
      '<div style="font-size:12px;color:#6b7280;margin-bottom:8px">共 ' + rows.length + ' 个省份</div>' + h;
    var kwEl = byId("agxPR_kw");
    if (kwEl) kwEl.oninput = function () { node.filters.keyword = kwEl.value.trim(); redrawDrawerBody(); };
    var bs = body.querySelectorAll("button[data-p]");
    for (var j = 0; j < bs.length; j++) {
      (function (b) {
        b.onclick = function () {
          var pname = b.getAttribute("data-p");
          if (node.kpiFilter) {
            var base = scoped({ month: node.month, province: pname });
            var rows2 = base.filter(node.kpiFilter.filter);
            openListDrill(node.kpiFilter.t + " · " + pname, rows2,
              { provinces: [pname], label: node.kpiFilter.t }, true);
          } else {
            pushDrill(newDrillNode("province", { title: pname + " 省份档案", crumb: pname, month: node.month,
              scopePreset: { provinces: [pname] } }));
          }
        };
      })(bs[j]);
    }
  }

  /* ==================================================================
   * 十六、省份智能体全景
   * ================================================================== */
  var PAN_RANKS = [
    { k: "calls", t: "调用量" }, { k: "activeRate", t: "活跃率" },
    { k: "highEff", t: "活跃且高提效数" }, { k: "caseCount", t: "重点案例数" }
  ];
  var PAN_DIMS = [
    { k: "operation", t: "运营分层" }, { k: "case", t: "案例运营" }, { k: "scene", t: "业务场景" }
  ];
  function panDimCols(dim, rows) {
    if (dim === "operation") {
      return [
        { k: "hot", n: "高热度", ratio: false, test: function (r) { return !!r.isHot; } },
        { k: "highEff", n: "活跃且高提效", ratio: false, test: function (r) { return !!r.isHighEff; } },
        { k: "idle", n: "未活跃", ratio: false, test: function (r) { return !r.isActive; } }
      ];
    }
    if (dim === "case") {
      return [
        { k: "promo", n: "推广", ratio: false, test: function (r) { return !!r.isPromo; } },
        { k: "excellent", n: "优秀", ratio: false, test: function (r) { return !!r.isExcellent; } },
        { k: "biweek", n: "双周优秀", ratio: false, test: function (r) { return !!r.isBiweek; } }
      ];
    }
    var cnt = {};
    rows.forEach(function (r) {
      var s = r.appScene || "未分类";
      cnt[s] = (cnt[s] || 0) + 1;
    });
    var keys = Object.keys(cnt).filter(function (k) { return k !== "未分类"; })
      .sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 9);
    var out = keys.map(function (k) {
      return { k: k, n: k, ratio: false, test: function (r) { return (r.appScene || "未分类") === k; } };
    });
    out.push({ k: "未分类", n: "其他/未分类", ratio: false, test: function (r) { return !r.appScene; } });
    return out;
  }
  function heatQty(v, max) {
    if (!v || !max) return "#fff";
    var t = Math.min(1, Math.sqrt(v / max));
    return "rgb(" + Math.round(255 - (255 - 59) * t) + "," + Math.round(255 - (255 - 130) * t) + "," + Math.round(255 - (255 - 246) * t) + ")";
  }
  function heatRate(v) {
    if (v == null || !isFinite(v)) return "#fff";
    var t = Math.min(1, Math.max(0, v));
    return "rgb(" + Math.round(255 - (255 - 34) * t) + "," + Math.round(255 - (255 - 197) * t) + "," + Math.round(255 - (255 - 94) * t) + ")";
  }
  function renderPanorama() {
    byId("agPanRank").innerHTML = segHtml(PAN_RANKS, state.panoramaRankBy);
    bindSeg("agPanRank", function (k) { state.panoramaRankBy = k; renderPanorama(); });
    byId("agPanDim").innerHTML = segHtml(PAN_DIMS, state.panoramaDim);
    bindSeg("agPanDim", function (k) { state.panoramaDim = k; renderPanorama(); });

    var avail = monthAvailable(state.month);
    var list = scoped({ province: "ALL" });
    var pm = prevMonthOf(state.month);
    var prevByProv = pm ? {} : null;
    if (pm) {
      scoped({ month: pm, province: "ALL" }).forEach(function (r) {
        prevByProv[r.province] = (prevByProv[r.province] || 0) + (r.calls || 0);
      });
    }
    var byProv = {};
    list.forEach(function (r) {
      if (!byProv[r.province]) byProv[r.province] = { province: r.province, rows: [], calls: 0 };
      byProv[r.province].rows.push(r);
      byProv[r.province].calls += r.calls || 0;
    });
    var provs = Object.keys(byProv).map(function (p) {
      var d = byProv[p];
      var s = stats(d.rows);
      d.online = s.online; d.active = s.active; d.hot = s.hot; d.highEff = s.high;
      d.activeRate = s.online ? s.active / s.online : null;
      d.caseCount = d.rows.filter(function (r) { return r.isPromo || r.isExcellent || r.isBiweek; }).length;
      return d;
    });
    var rk = state.panoramaRankBy;
    provs.sort(function (a, b) {
      if (rk === "activeRate") return (b.activeRate == null ? -1 : b.activeRate) - (a.activeRate == null ? -1 : a.activeRate);
      if (rk === "highEff") return b.highEff - a.highEff;
      if (rk === "caseCount") return b.caseCount - a.caseCount;
      return b.calls - a.calls;
    });
    var cols = panDimCols(state.panoramaDim, list);
    var maxQty = 0;
    provs.forEach(function (p) {
      cols.forEach(function (c) {
        var v = p.rows.filter(c.test).length;
        if (v > maxQty) maxQty = v;
      });
    });

    var limit = state.panExpandAll ? provs.length : 15;
    var shown = provs.slice(0, limit);
    var noteTxt = avail
      ? ("排名按" + (PAN_RANKS.filter(function (x) { return x.k === rk; })[0] || {}).t +
        "降序；展示 " + shown.length + " / " + provs.length + " 个省份。热力越深代表数值越高，0 显示为「—」，数据缺失显示「/」。")
      : (state.month + " 应用明细待接入，矩阵暂不可下钻。");
    if (state.panoramaDim === "scene" && !list.some(function (r) { return r.appScene; })) {
      noteTxt += " 当前源表「应用场景小分类」全部为空，场景维度仅有「其他/未分类」一列，属数据缺失而非口径问题。";
    }
    byId("agPanNote").textContent = noteTxt;

    var head = '<tr>' +
      '<th class="agx-num" style="position:sticky;left:0;z-index:4">全国排名</th>' +
      '<th style="position:sticky;left:58px;z-index:4">省份</th>' +
      '<th class="agx-num">月调用量</th><th class="agx-num">调用量环比</th>' +
      '<th class="agx-num">上线应用数</th><th class="agx-num">活跃数</th><th class="agx-num">活跃率</th>' +
      cols.map(function (c) { return '<th style="text-align:center">' + esc(c.n) + '</th>'; }).join("") +
      '</tr>';
    var body = shown.map(function (p, i) {
      var momv = prevByProv && prevByProv[p.province] != null
        ? momPct(p.calls, prevByProv[p.province]) : null;
      var tds = cols.map(function (c) {
        var v = p.rows.filter(c.test).length;
        if (!avail) return '<td style="text-align:center;color:#94a3b8">/</td>';
        if (!v) return '<td class="agx-cell zero" title="' + esc(p.province + " × " + c.n + "：0，无应用可下钻") + '">—</td>';
        return '<td class="agx-cell" style="background:' + heatQty(v, maxQty) + '" tabindex="0" role="button" ' +
          'data-cell="1" data-p="' + esc(p.province) + '" data-c="' + esc(c.k) + '" ' +
          'title="' + esc(p.province + " × " + c.n + "：" + v + " 个，点击查看智能体") + '">' + v + '</td>';
      }).join("");
      return '<tr>' +
        '<th scope="row" class="agx-num" style="position:sticky;left:0">' + (i + 1) + '</th>' +
        '<th scope="row" style="position:sticky;left:58px"><span class="agx-click" data-prov="' + esc(p.province) +
          '" tabindex="0" role="button" title="点击查看 ' + esc(p.province) + ' 省份档案">' + esc(p.province) + '</span></th>' +
        '<td class="agx-num">' + (avail ? fmtWan(p.calls) : "待接入") + '</td>' +
        '<td class="agx-num">' + (avail ? (momv == null ? '<span style="color:#94a3b8">/</span>' : deltaSpan(momv, (momv >= 0 ? "+" : "") + momv.toFixed(1) + "%")) : '<span style="color:#94a3b8">/</span>') + '</td>' +
        '<td class="agx-num">' + (avail ? fmtInt(p.online) : "待接入") + '</td>' +
        '<td class="agx-num">' + (avail ? fmtInt(p.active) : "待接入") + '</td>' +
        '<td class="agx-num" style="background:' + (avail ? heatRate(p.activeRate) : "#fff") + '">' +
          (avail ? fmtPct(p.activeRate) : "待接入") + '</td>' +
        tds + '</tr>';
    }).join("");
    byId("agPanWrap").innerHTML = '<table class="agx-mx"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';

    var cells = byId("agPanWrap").querySelectorAll("td.agx-cell:not(.zero)");
    for (var ci = 0; ci < cells.length; ci++) {
      (function (td) {
        var open = function () {
          var pname = td.getAttribute("data-p"), ck = td.getAttribute("data-c");
          var col = panDimCols(state.panoramaDim, list).filter(function (x) { return x.k === ck; })[0];
          var rs = (byProv[pname] ? byProv[pname].rows : []).filter(col.test);
          openListDrill(pname + " / " + (col ? col.n : ck), rs,
            { provinces: [pname], label: (col ? col.n : ck) });
        };
        td.onclick = open;
        td.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      })(cells[ci]);
    }
    var pvEls = byId("agPanWrap").querySelectorAll("span[data-prov]");
    for (var pi = 0; pi < pvEls.length; pi++) {
      (function (el) {
        var open = function () {
          pushDrill(newDrillNode("province", {
            title: el.getAttribute("data-prov") + " 省份档案", crumb: el.getAttribute("data-prov"), month: state.month
          }));
        };
        el.onclick = open;
        el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      })(pvEls[pi]);
    }
    var ex = byId("agxPan_expand");
    if (ex) {
      ex.innerHTML = '<button type="button" class="agx-exp" id="agxPan_btn">' +
        (state.panExpandAll ? "收起为 TOP15" : "查看全部省份（共" + provs.length + "个）") + '</button>';
      byId("agxPan_btn").onclick = function () { state.panExpandAll = !state.panExpandAll; renderPanorama(); };
    }
  }

  /* ==================================================================
   * 十七、案例运营明细
   * ================================================================== */
  function cumCase(kind, uptoMonth) {
    var lc = lifecycle();
    var key = kind === "promo" ? "promoEntryMonth" : kind === "excellent" ? "excellentEntryMonth" : "biweekEntryMonth";
    var total = 0, added = 0, ids = [];
    var eids = Object.keys(lc);
    for (var i = 0; i < eids.length; i++) {
      var m = lc[eids[i]][key];
      if (!m) continue;
      if (monthNo(m) > monthNo(uptoMonth)) continue;
      total++;
      ids.push(eids[i]);
      if (m === uptoMonth) added++;
    }
    return { total: total, added: added, ids: ids };
  }
  function renderCaseDetail() {
    byId("agCaseTabs").innerHTML = segHtml(CASE_KINDS, state.caseType);
    bindSeg("agCaseTabs", function (k) { state.caseType = k; state.caseNode = null; renderCaseDetail(); });
    var kind = state.caseType;
    var kindName = (CASE_KINDS.filter(function (x) { return x.k === kind; })[0] || {}).t;
    var cur = caseRowsOf(kind);
    var avail = monthAvailable(state.month);
    var pm = prevMonthOf(state.month);
    var prevRows = pm ? caseRowsOf(kind, scoped({ month: pm })) : null;
    var cum = cumCase(kind, state.month);
    var activeN = cur.filter(function (r) { return r.isActive; }).length;
    var activeRate = cur.length ? activeN / cur.length : null;
    var calls = cur.reduce(function (s, r) { return s + (r.calls || 0); }, 0);
    var prevActiveN = prevRows ? prevRows.filter(function (r) { return r.isActive; }).length : null;
    var prevRate = (prevRows && prevRows.length) ? prevActiveN / prevRows.length : null;
    var prevCalls = prevRows ? prevRows.reduce(function (s, r) { return s + (r.calls || 0); }, 0) : null;

    var cards = "";
    if (kind === "promo") {
      cards =
        kpiCard2("累计推广案例", fmtInt(cum.total), "截至" + state.month + "累计") +
        kpiCard2("本月新增推广案例", fmtInt(cum.added), "入选月份＝" + state.month) +
        kpiCard2("当月活跃推广案例", avail ? fmtInt(activeN) : "待接入", avail ? diffText(activeN, prevActiveN) : "明细待接入") +
        kpiCard2("当月推广案例调用量", avail ? fmtWan(calls) : "待接入", avail ? fmtMom(momPct(calls, prevCalls)) : "明细待接入");
    } else {
      var rateDelta = (activeRate != null && prevRate != null) ? (activeRate - prevRate) * 100 : null;
      cards =
        kpiCard2("累计" + kindName, fmtInt(cum.total), "截至" + state.month + "累计｜本月新增 " + fmtInt(cum.added)) +
        kpiCard2("当月在册案例", avail ? fmtInt(cur.length) : "待接入", avail ? diffText(cur.length, prevRows && prevRows.length) : "明细待接入") +
        kpiCard2("活跃案例", avail ? fmtInt(activeN) : "待接入", avail ? diffText(activeN, prevActiveN) : "明细待接入") +
        kpiCard2("案例活跃率", avail ? fmtPct(activeRate) : "待接入",
          avail ? ("环比 " + (rateDelta == null ? '<span style="color:#6b7280">无上月可比</span>'
            : deltaSpan(rateDelta, (rateDelta >= 0 ? "+" : "") + rateDelta.toFixed(1) + "个百分点")) +
            '　上月 ' + fmtPct(prevRate)) : "明细待接入") +
        kpiCard2("当月调用量", avail ? fmtWan(calls) : "待接入", avail ? fmtMom(momPct(calls, prevCalls)) : "明细待接入");
    }
    byId("agCaseKpis").innerHTML = cards;
    byId("agCaseKpis").style.gridTemplateColumns = (kind === "promo" ? "repeat(4,minmax(0,1fr))" : "repeat(5,minmax(0,1fr))");

    renderPromoScene();

    /* 图表：推广 Tab 只放场景矩阵；优秀/双周保留省份 TOP10 与提效分布 */
    var chartBox = byId("agCaseCharts");
    if (kind === "promo") {
      chartBox.innerHTML = "";
    } else {
      chartBox.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:15px">' +
        '<div class="chart-card"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<div class="ct">案例省份 TOP10</div>' +
        '<button type="button" class="agx-exp" id="agxCaseProvAll" style="margin-left:auto">查看完整排名</button></div>' +
        '<div class="chart" id="agCaseProvince" style="height:300px"></div></div>' +
        '<div class="chart-card"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<div class="ct">提效分布</div>' +
        '<button type="button" class="agx-exp" id="agxCaseEffAll" style="margin-left:auto">查看全部区间明细</button></div>' +
        '<div class="chart" id="agCaseEfficiency" style="height:300px"></div></div></div>';
      drawCaseProvince(cur, kindName);
      drawCaseEfficiency(cur, kindName);
    }

    /* 案例清单 */
    var node = pageNode("caseNode", { title: "案例清单", data: cur, sortKey: "calls", limit: 30 });
    var filtered = applyFilters(node.data || [], node.filters);
    var t = renderAgentTable("agxCS_", filtered, node, { limit: 10, hidePager: true, short: true,
      columns: columnsByKeys(CASE_SUMMARY_COLUMN_KEYS, state.month) });
    byId("agCaseFilter").innerHTML = cur.length ? renderFilterBar("agxCS_", node, { compact: true, positive: true }) : "";
    var caseNote = '<div style="margin:8px 2px 0;font-size:12px;color:#94a3b8;line-height:1.6">' +
      '口径说明：「节约金额」「产生真实价值」仅源表 6–8 月有统计，且只针对「正向价值=是」的应用；其余行（1–5 月及非正向应用）源表本就为空，显示为「—」属正常。</div>';
    byId("agCaseTable").innerHTML = cur.length ? t.html + caseNote :
      '<div class="agx-tblwrap short"><table class="tbl agx-tbl"><tbody><tr><td class="agx-empty">当前范围内没有该类型案例</td></tr></tbody></table></div>' + caseNote;
    if (cur.length) {
      bindFilterBar("agxCS_", node, function () { renderCaseDetail(); });
      bindAgentTable("agxCS_", filtered, node, function () { renderCaseDetail(); }, openAgentProfile);
    }
    var ex = byId("agxCS_expand");
    if (ex) {
      if (!cur.length) ex.innerHTML = '<button type="button" class="agx-exp" disabled>查看全部明细（0）</button>';
      else {
        ex.innerHTML = '<button type="button" class="agx-exp" id="agxCS_btn2">查看筛选后明细（' + filtered.length + ' / ' + cur.length + '）</button>';
        byId("agxCS_btn2").onclick = function () {
          openListDrill(kindName + " · 完整案例清单", cur, { label: kindName }, true, node.filters, state.month);
        };
      }
    }
  }
  function kpiCard2(label, value, sub) {
    return '<div class="kpi" style="padding:13px 14px"><div class="lb" style="font-size:12px;color:#6b7280">' +
      esc(label) + '</div><div class="val" style="font-size:23px;line-height:1.35">' + value + '</div>' +
      '<div style="font-size:11px;color:#6b7280;min-height:17px">' + sub + '</div></div>';
  }
  function drawCaseProvince(rows, kindName) {
    var by = {};
    rows.forEach(function (r) { by[r.province] = (by[r.province] || 0) + 1; });
    var data = Object.keys(by).map(function (p) { return { n: p, v: by[p] }; }).sort(function (a, b) { return b.v - a.v; });
    drawProvRankChart("agCaseProvince", data.slice(0, 10), function (pname) {
      openListDrill(pname + " · " + kindName + "清单",
        rows.filter(function (r) { return r.province === pname; }), { provinces: [pname], label: kindName });
    });
    var b = byId("agxCaseProvAll");
    if (b) b.onclick = function () {
      pushDrill(newDrillNode("agentList", {
        title: kindName + " · 省份完整排名", crumb: "完整排名", month: state.month,
        data: rows, render: "provRank", provRank: data, sortKey: "calls"
      }));
    };
  }
  function drawCaseEfficiency(rows, kindName) {
    var bins = [
      { n: "未填/0", lo: null, hi: 0 }, { n: "0—30%", lo: 0, hi: 0.30 },
      { n: "30—50%", lo: 0.30, hi: 0.50 }, { n: "50—80%", lo: 0.50, hi: 0.80 },
      { n: "80%以上", lo: 0.80, hi: null }
    ];
    bins.forEach(function (b) { b.v = 0; b.rows = []; });
    rows.forEach(function (r) {
      var e = r.effRatio;
      if (e == null || e === 0) bins[0].rows.push(r);
      else if (e <= 0.30) bins[1].rows.push(r);
      else if (e <= 0.50) bins[2].rows.push(r);
      else if (e <= 0.80) bins[3].rows.push(r);
      else bins[4].rows.push(r);
    });
    bins.forEach(function (b) { b.v = b.rows.length; });
    var c = draw("agCaseEfficiency", mergeBase({
      tooltip: { trigger: "item" }, legend: { bottom: 2 },
      series: [{
        type: "pie", radius: ["36%", "66%"], center: ["50%", "44%"],
        label: { formatter: "{b}\n{c}个", fontSize: 11 },
        data: bins.map(function (b) { return { name: b.n, value: b.v }; }),
        color: ["#cbd5e1", "#93c5fd", "#3b82f6", "#14b8a6", "#22c55e"]
      }]
    }));
    if (c) c.on("click", function (p) {
      var b = bins.filter(function (x) { return x.n === p.name; })[0];
      if (b) openListDrill(kindName + " · 提效区间「" + b.n + "」", b.rows, { label: "提效区间 " + b.n });
    });
    var b2 = byId("agxCaseEffAll");
    if (b2) b2.onclick = function () {
      openListDrill(kindName + " · 全部提效区间明细", rows, { label: kindName }, true);
    };
  }
  /* 推广场景运营矩阵 */
  function renderPromoScene() {
    var wrap = byId("agPromoSceneWrap");
    if (!wrap) return;
    if (state.caseType !== "promo") { wrap.innerHTML = ""; return; }
    var kindKey = "promo";
    var rows = caseRowsOf(kindKey);
    var lc = lifecycle();
    var by = {};
    rows.forEach(function (r) {
      var s = r.promoScene || "未分类";
      if (!by[s]) by[s] = { scene: s, rows: [], ids: {} };
      by[s].rows.push(r);
    });
    /* 累计：按场景内应用的推广入选月份 */
    var list = Object.keys(by).map(function (s) {
      var d = by[s];
      var cum = 0, added = 0, seen = {};
      d.rows.forEach(function (r) {
        if (seen[r.entityId]) return;
        seen[r.entityId] = 1;
        var m = lc[r.entityId] ? lc[r.entityId].promoEntryMonth : null;
        if (!m || monthNo(m) > monthNo(state.month)) return;
        cum++;
        if (m === state.month) added++;
      });
      var provs = {};
      d.rows.forEach(function (r) { provs[r.province] = 1; });
      var act = d.rows.filter(function (r) { return r.isActive; }).length;
      d.cum = cum; d.added = added;
      d.provCount = Object.keys(provs).length;
      d.active = act;
      d.rate = d.rows.length ? act / d.rows.length : null;
      d.calls = d.rows.reduce(function (a, r) { return a + (r.calls || 0); }, 0);
      return d;
    }).sort(function (a, b) { return b.cum - a.cum; });

    var h = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      '<b style="color:#1f2937;font-size:13px">推广场景运营矩阵</b>' +
      '<span style="color:#6b7280;font-size:12px">共 ' + list.length + ' 类；未分类单独一行不隐藏。点击行内数值可下钻。</span>' +
      '<button type="button" class="agx-exp" id="agxSceneAll" style="margin-left:auto">展开全部场景案例</button></div>';
    h += '<div class="agx-tblwrap short"><table class="tbl agx-tbl"><thead><tr>' +
      '<th>场景分类</th><th class="agx-num">累计案例数</th><th class="agx-num">本月新增</th>' +
      '<th class="agx-num">上线省份数</th><th class="agx-num">当月活跃数</th>' +
      '<th class="agx-num">当月活跃率</th><th class="agx-num">当月调用量</th></tr></thead><tbody>';
    if (!list.length) {
      h += '<tr><td colspan="7" class="agx-empty">当前范围内没有推广案例</td></tr>';
    } else {
      list.forEach(function (d) {
        h += '<tr><td><b><span class="agx-click" data-scene="' + esc(d.scene) + '" data-act="scene" data-v="' + esc(d.scene) + '" tabindex="0" role="button" ' +
          'title="点击查看该场景全部应用">' + esc(d.scene) + '</span></b></td>' +
          '<td class="agx-num"><span class="agx-click" data-act="scene" data-v="' + esc(d.scene) + '" tabindex="0" role="button">' + fmtInt(d.cum) + '</span></td>' +
          '<td class="agx-num">' + fmtInt(d.added) + '</td>' +
          '<td class="agx-num"><span class="agx-click" data-act="prov" data-v="' + esc(d.scene) + '" tabindex="0" role="button" title="查看省份—应用两级列表">' + fmtInt(d.provCount) + '</span></td>' +
          '<td class="agx-num"><span class="agx-click" data-act="active" data-v="' + esc(d.scene) + '" tabindex="0" role="button" title="只看当月活跃应用">' + fmtInt(d.active) + '</span></td>' +
          '<td class="agx-num">' + fmtPct(d.rate) + '</td>' +
          '<td class="agx-num"><span class="agx-click" data-act="calls" data-v="' + esc(d.scene) + '" tabindex="0" role="button" title="按调用量排序打开">' + fmtWan(d.calls) + '</span></td></tr>';
      });
    }
    h += '</tbody></table></div>';
    wrap.innerHTML = h;
    var els = wrap.querySelectorAll("span[data-act]");
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        var open = function () {
          var act = el.getAttribute("data-act"), v = el.getAttribute("data-v");
          var d = list.filter(function (x) { return x.scene === v; })[0];
          if (!d) return;
          if (act === "prov") {
            /* 省份—应用两级列表 */
            var byP = {};
            d.rows.forEach(function (r) { (byP[r.province] || (byP[r.province] = [])).push(r); });
            var rank = Object.keys(byP).map(function (p) {
              return { n: p, v: byP[p].length, rows: byP[p] };
            }).sort(function (a, b) { return b.v - a.v; });
            pushDrill(newDrillNode("agentList", {
              title: "推广场景「" + v + "」· 省份分布", crumb: v + " 省份", month: state.month,
              data: d.rows, render: "provRank", provRank: rank, sceneRows: d.rows, sortKey: "calls",
              scopePreset: { label: "推广场景：" + v }
            }));
            return;
          }
          var sub = d.rows;
          if (act === "active") sub = d.rows.filter(function (r) { return r.isActive; });
          var sortKey = act === "calls" ? "calls" : "calls";
          openListDrill("推广场景「" + v + "」" + (act === "active" ? " · 当月活跃" : ""), sub,
            { label: "推广场景：" + v });
        };
        el.onclick = open;
        el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
      })(els[i]);
    }
    var sa = byId("agxSceneAll");
    if (sa && list.length) sa.onclick = function () {
      var all = [];
      list.forEach(function (d) { d.rows.forEach(function (r) { all.push(r); }); });
      openListDrill("推广案例 · 全部场景清单", all, { label: "全部推广场景" }, true);
    };
  }

  /* ==================================================================
   * 十八、应用查询与完整明细
   * ================================================================== */
  var DETAIL_STATUS = [
    { k: "ALL", t: "全部" }, { k: "ZERO", t: "零调用" }, { k: "LOW", t: "低频（1—1000）" },
    { k: "ACTIVE", t: "活跃" },
    { k: "HOT", t: "高热度" }, { k: "HIGHEFF", t: "活跃且高提效" },
    { k: "LOWTOKEN", t: "低Token高提效" }, { k: "CASE", t: "重点案例" }
  ];
  function detailRows() {
    var list = scoped();
    var out = list;
    if (state.detailStatus === "ZERO") out = out.filter(function (r) { return r.calls === 0; });
    else if (state.detailStatus === "LOW") out = out.filter(function (r) { return r.calls > 0 && r.calls <= THRESH.activeCalls; });
    else if (state.detailStatus === "ACTIVE") out = out.filter(function (r) { return r.isActive; });
    else if (state.detailStatus === "HOT") out = out.filter(function (r) { return r.isHot; });
    else if (state.detailStatus === "HIGHEFF") out = out.filter(function (r) { return r.isHighEff; });
    else if (state.detailStatus === "CASE") out = out.filter(function (r) { return r.isPromo || r.isExcellent || r.isBiweek; });
    else if (state.detailStatus === "LOWTOKEN") {
      if (!tokenAvailable(state.month)) return { blocked: true, rows: [] };
      var res = lowTokenRows(list);
      out = res.rows;
    }
    return { blocked: false, rows: out };
  }
  function renderDetail() {
    if (!monthAvailable(state.month)) {
      byId("agDetailTable").innerHTML = '<div class="agx-token-na"><b>' + esc(state.month) +
        ' 应用明细待接入</b><br/>本页框架已就绪，缺失明细显示「待接入」，不会用其他月份数据代替。</div>';
      return;
    }
    var fbox = byId("agDetailFilter");
    if (fbox) {
      fbox.innerHTML = '<div class="agx-fbar"><span class="lb">状态</span><div class="agx-chipset" id="agxDS_st">' +
        DETAIL_STATUS.map(function (x) {
          return '<button type="button" class="agx-chip' + (state.detailStatus === x.k ? " on" : "") + '" data-v="' + x.k + '">' + x.t + '</button>';
        }).join("") + '</div>' +
        '<button type="button" class="agx-rst" id="agxDS_rst">重置筛选</button></div>' +
        '<div id="agxDT_lowTokenTip"></div>';
      var sts = byId("agxDS_st").querySelectorAll("button");
      for (var i = 0; i < sts.length; i++) {
        (function (b) {
          b.onclick = function () { state.detailStatus = b.getAttribute("data-v"); state.detailNode = null; renderDetail(); };
        })(sts[i]);
      }
      var rb = byId("agxDS_rst");
      if (rb) rb.onclick = function () {
        state.detailStatus = "ALL"; state.detailKeyword = ""; state.detailNode = null; renderDetail();
      };
    }
    var res = detailRows();
    var tip = byId("agxDT_lowTokenTip");
    if (tip) {
      tip.innerHTML = res.blocked
        ? '<div class="agx-token-na" style="margin-bottom:10px"><b>Token 数据自 ' + esc(TOKEN_START) + ' 起统计</b><br/>' +
          '当前月份不支持「低Token高提效」筛选，请切换到 ' + esc(TOKEN_START) + ' 及以后月份，或改用其他状态筛选。</div>'
        : "";
    }
    var rows = res.rows;
    var node = pageNode("detailNode", { title: "应用查询", data: rows, sortKey: state.detailSort, limit: 100 });
    var sortMap = { calls: "calls", eff: "effRatio", copy: "copyCount" };
    node.tableState.sortKey = sortMap[state.detailSort] || "calls";
    var filtered = applyFilters(node.data || [], node.filters);
    byId("agDetailCount").textContent = "匹配 " + filtered.length + " 个（筛选后）/ " + rows.length + " 个，展示前 " + Math.min(50, filtered.length) + " 个";
    var t = renderAgentTable("agxDT_", filtered, node, { limit: 50, hidePager: true,
      columns: columnsByKeys(SUMMARY_COLUMN_KEYS, state.month) });
    byId("agDetailTable").innerHTML = t.html;
    bindFilterBarForDetail(node, filtered, rows);
    bindAgentTable("agxDT_", filtered, node, function () { renderDetail(); }, openAgentProfile);
    var ex = byId("agxDT_expand");
    if (ex) {
      if (!rows.length) ex.innerHTML = '<button type="button" class="agx-exp" disabled>查看全部明细（0）</button>';
      else {
        ex.innerHTML = '<button type="button" class="agx-primary-btn" id="agxDT_btn">查看筛选后明细（' + filtered.length + ' / ' + rows.length + '）</button>';
        byId("agxDT_btn").onclick = function () {
          openListDrill("应用查询 · 完整明细", rows, { label: "应用查询" }, true, node.filters, state.month);
        };
      }
    }
  }
  /* 明细区筛选条：注入到 agDetailTable 上方 */
  function bindFilterBarForDetail(node, filtered, allRows) {
    var host = byId("agDetailTable");
    if (!host) return;
    var old = byId("agxDT_bar");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var bar = document.createElement("div");
    bar.id = "agxDT_bar";
    bar.innerHTML = renderFilterBar("agxDT_", node, { compact: true });
    host.parentNode.insertBefore(bar, host);
    bindFilterBar("agxDT_", node, function () {
      var f2 = applyFilters(allRows, node.filters);
      var t2 = renderAgentTable("agxDT_", f2, node, { limit: 50, hidePager: true,
        columns: columnsByKeys(SUMMARY_COLUMN_KEYS, state.month) });
      byId("agDetailTable").innerHTML = t2.html;
      byId("agDetailCount").textContent = "匹配 " + f2.length + " 个（筛选后）/ " + allRows.length + " 个，展示前 " + Math.min(50, f2.length) + " 个";
      var exp = byId("agxDT_btn");
      if (exp) exp.textContent = "查看筛选后明细（" + f2.length + " / " + allRows.length + "）";
      bindAgentTable("agxDT_", f2, node, function () { renderDetail(); }, openAgentProfile);
    });
  }

  /* ==================================================================
   * 十九、省份档案抽屉
   * ================================================================== */
  function drawProvinceBody(node, body) {
    var pname = (node.scopePreset && node.scopePreset.provinces && node.scopePreset.provinces[0]) || null;
    if (!pname && node.title) pname = String(node.title).replace(/\s*省份档案\s*$/, "");
    var m = node.month;
    var rs = rowsOfProvinceMonth(pname, m);
    var all = scoped({ month: m, province: "ALL" });
    var byProv = {};
    all.forEach(function (r) { byProv[r.province] = (byProv[r.province] || 0) + (r.calls || 0); });
    var rankList = Object.keys(byProv).map(function (p) { return { p: p, v: byProv[p] }; })
      .sort(function (a, b) { return b.v - a.v; });
    var rank = 0;
    for (var i = 0; i < rankList.length; i++) if (rankList[i].p === pname) { rank = i + 1; break; }
    var s = stats(rs);
    var avail = monthAvailable(m);

    var h = [];
    h.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px;margin-bottom:14px">' +
      card("全国排名", avail ? (rank ? (rank + " / " + rankList.length) : "/") : "待接入", "按当月调用量") +
      card("月调用量", avail ? fmtWan(s.calls) : "待接入", "—") +
      card("上线应用", avail ? fmtInt(s.online) : "待接入", "—") +
      card("活跃", avail ? fmtInt(s.active) : "待接入", avail ? "活跃率 " + fmtPct(s.online ? s.active / s.online : null) : "—") +
      card("高热度", avail ? fmtInt(s.hot) : "待接入", "—") +
      card("活跃且高提效", avail ? fmtInt(s.high) : "待接入", "—") +
      '</div>');
    h.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 6px">' +
      '<b style="font-size:13px;color:#1f2937">省内调用量 TOP10</b>' +
      '<button type="button" class="agx-exp" id="agxPV_all" style="margin-left:auto">查看筛选后明细</button></div>');
    var top10 = rs.slice().sort(function (a, b) { return b.calls - a.calls; }).slice(0, 10);
    node.data = rs;   // 供统一筛选条作用于全省全集
    var pvFiltered = avail ? applyFilters(rs, node.filters) : [];
    if (avail) {
      h.push(renderFilterBar("agxPV_", node, { compact: true }));
      h.push(renderAgentTable("agxPV_", pvFiltered, node, { limit: 10, hidePager: true, short: true }).html);
    } else {
      h.push('<div class="agx-token-na">本月应用明细待接入。</div>');
    }
    h.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">省内运营对象</div>');
    h.push('<div class="agx-fbar"><div class="agx-chipset" id="agxPV_jump">' +
      '<button type="button" class="agx-chip" data-v="idle">未活跃</button>' +
      '<button type="button" class="agx-chip" data-v="hot">高热度</button>' +
      '<button type="button" class="agx-chip" data-v="highEff">活跃且高提效</button>' +
      '<button type="button" class="agx-chip" data-v="promo">推广案例</button>' +
      '<button type="button" class="agx-chip" data-v="excellent">优秀案例</button>' +
      '<button type="button" class="agx-chip" data-v="biweek">双周优秀</button></div></div>');
    h.push('<div style="font-size:13px;font-weight:700;color:#1f2937;margin:16px 0 6px">省内案例构成</div>');
    var caseRow = CASE_KINDS.map(function (k) {
      var n = caseRowsOf(k.k, rs).length;
      return card(k.t, avail ? fmtInt(n) : "待接入", "点击查看清单");
    }).join("");
    h.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px" id="agxPV_cases">' + caseRow + '</div>');
    body.innerHTML = h.join("");
    var allBtn = byId("agxPV_all");
    if (allBtn) allBtn.textContent = "查看筛选后明细（" + pvFiltered.length + " / " + rs.length + "）";
    if (avail) {
      bindFilterBar("agxPV_", node, function () { redrawDrawerBody(); });
      bindAgentTable("agxPV_", pvFiltered, node, function () { redrawDrawerBody(); }, openAgentProfile);
    }

    var jb = byId("agxPV_jump");
    if (jb) {
      var bs = jb.querySelectorAll("button");
      for (var j = 0; j < bs.length; j++) {
        (function (b) {
          b.onclick = function () {
            var v = b.getAttribute("data-v");
            var sub = rs.filter(function (r) {
              if (v === "idle") return !r.isActive;
              if (v === "hot") return r.isHot;
              if (v === "highEff") return r.isHighEff;
              if (v === "promo") return r.isPromo;
              if (v === "excellent") return r.isExcellent;
              if (v === "biweek") return r.isBiweek;
              return true;
            });
            var names = { idle: "未活跃", hot: "高热度", highEff: "活跃且高提效", promo: "推广案例", excellent: "优秀案例", biweek: "双周优秀" };
            openListDrill(pname + " / " + names[v], sub, { provinces: [pname], label: names[v] });
          };
        })(bs[j]);
      }
    }
    var cbox = byId("agxPV_cases");
    if (cbox) {
      var cs = cbox.querySelectorAll(".agx-kpi");
      for (var k = 0; k < cs.length; k++) {
        (function (el, idx) {
          el.style.cursor = "pointer";
          el.onclick = function () {
            var kind = CASE_KINDS[idx];
            if (!kind) return;
            openListDrill(pname + " / " + kind.t, caseRowsOf(kind.k, rs),
              { provinces: [pname], label: kind.t });
          };
        })(cs[k], k);
      }
    }
    var ab = byId("agxPV_all");
    if (ab) ab.onclick = function () {
      openListDrill(pname + " · 全部智能体", rs, { provinces: [pname] }, true, node.filters, node.month);
    };
  }

  /* ==================================================================
   * 二十、汇总渲染
   * ================================================================== */
  function renderAll() {
    if (!sourceRows().length) {
      var root = ensureRoot();
      if (root) root.innerHTML = '<div class="gap-card" style="padding:24px"><b>智能体数据尚未接入</b>' +
        '<div style="margin-top:8px;color:#6b7280">请由基座负责人将「智能体清单（各省）」写入 agentMonthly 域、' +
        '「推广+双周+优秀（总表）」写入 agentCaseCatalog 域、派生入选月份写入 agentLifecycle 域；页面不直接读取 Excel。</div></div>';
      return;
    }
    buildIndexes();
    renderKpis();
    renderFocus();
    renderCaseStack();
    renderTypeDonut();
    renderTrends();
    renderPanorama();
    renderCaseDetail();
    renderDetail();
    renderPositiveConclusion();
    renderDataNote();
  }
  function renderDataNote() {
    var q = META.dataQuality || {};
    var miss = REPORT_MONTHS.filter(function (m) { return !monthAvailable(m); });
    var lines = [];
    lines.push('口径：活跃＝月调用量 &gt; ' + THRESH.activeCalls + '；高热度＝月调用量 &gt; ' + THRESH.hotCalls +
      '；活跃且高提效＝月调用量 &gt; ' + THRESH.activeCalls + ' 且提效比率 &gt; ' + (THRESH.highEffRatio * 100).toFixed(0) + '%。');
    lines.push('Token 与模型计费自 ' + esc(TOKEN_START) + ' 起统计；更早月份统一显示「自6月起统计」，不补 0、不降级为替代指标。');
    if (miss.length) lines.push('缺失月份：' + miss.join("、") + ' 应用级明细待接入，图表断线、表格显示「待接入」。');
    lines.push('案例累计按案例入选月份计算（暂以标记首次为 1 的月份派生）；应用ID 暂缺，' +
      '按「省份+应用名称+创建人」关联' +
      (q.identityFallbackRows ? '，回退关联 ' + fmtInt(q.identityFallbackRows) + ' 行，同月冲突 ' + fmtInt(q.identityCollisionCount) + ' 处' : '') +
      '；数据补齐ID后自动切换。');
    if (q.missingPromoSceneCount != null) lines.push('推广场景未分类 ' + fmtInt(q.missingPromoSceneCount) + ' 条（源表场景列为空）。');
    lines.push('本页不展示：投入产出类金额折算、人力节约折算，以及源表尚未接入的调用质量类字段。');
    byId("agDataNote").innerHTML = lines.map(function (x) { return "· " + x; }).join("<br/>");
  }
  /* ==================================================================
   * 十八、正向价值智能体分析与引导结论（实时计算）
   * ================================================================== */
  function posKpiCard(label, value, sub, color, opts) {
    opts = opts || {};
    var cls = "agx-kpi" + (opts.click ? " clickable" : "");
    var style = opts.click ? "" : ' style="cursor:default"';
    var attr = opts.click
      ? (' data-kpi-click="' + esc(opts.click) + '" tabindex="0" role="button" aria-label="' + esc(label) + '"')
      : " tabindex=\"0\"";
    var go = opts.click ? '<div class="go">查看明细 ›</div>' : "";
    return '<div class="' + cls + '"' + attr + style + '>' +
      '<div class="lb">' + esc(label) + '</div>' +
      '<div class="val" style="color:' + color + '">' + value + '</div>' +
      '<div class="sub">' + esc(sub) + '</div>' + go + '</div>';
  }
  function posRateBar(id, arr) {
    if (!arr || !arr.length) return;
    var names = arr.map(function (r) { return r.dn; });
    var rates = arr.map(function (r) { return +(r.rate * 100).toFixed(1); });
    var opt = mergeBase({
      grid: { left: 104, right: 52, top: 12, bottom: 22 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        formatter: function (ps) { var i = ps[0].dataIndex; var r = arr[i]; return esc(r.name) + "<br/>正向率：" + (r.rate * 100).toFixed(1) + "%<br/>正向 / 总：" + r.pos + " / " + r.all; } },
      xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
      yAxis: { type: "category", data: names, inverse: true, axisLabel: { fontSize: 11 } },
      series: [{ type: "bar", data: rates, barWidth: "56%",
        label: { show: true, position: "right", formatter: "{c}%", fontSize: 11 },
        itemStyle: { color: "#16a34a", borderRadius: [0, 4, 4, 0] } }]
    });
    draw(id, opt);
  }
  function renderPositiveConclusion() {
    var data = window.LINGYUN_DATA;
    var rows = data && data.agentMonthly;
    var host = byId("agPosConclusion");
    if (!host) return;
    if (!rows || !rows.length) { host.innerHTML = '<div class="agx-empty">智能体数据尚未接入</div>'; return; }
    var NN = function (x) { return (x == null || x === "" || (typeof x === "number" && x !== x)) ? null : Number(x); };
    function bump(o, v) { v = (v == null ? "" : String(v)).trim(); if (!v) return; o[v] = (o[v] || 0) + 1; }
    function modeOf(o) { var mk = "", mv = 0; for (var k in o) { if (o[k] > mv) { mv = o[k]; mk = k; } } return mk; }

    var agents = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; var id = r.appId; if (!id) continue;
      var a = agents[id];
      if (!a) { a = agents[id] = { name: r.name, type: r.type, sp: {}, sc: {}, pr: {}, calls: 0, save: 0, real: 0, neg: 0, hasNeg: 0, pos: 0, negRows: [] }; }
      if (r.positiveValue === 1) a.pos = 1;
      var c = NN(r.calls); if (c) a.calls += c;
      var sa = NN(r.saveAmount); if (sa != null) a.save += sa;
      var rv = NN(r.realValue); if (rv != null) { a.real += rv; if (rv < 0) { a.neg += rv; a.hasNeg = 1; a.negRows.push({ month: r.month, province: r.province, real: rv, calls: c, save: sa, positive: r.positiveValue }); } }
      bump(a.sp, r.servicePhase); bump(a.sc, r.appScene); bump(a.pr, r.promoScene || "");
    }
    var list = [];
    for (var id2 in agents) { var x = agents[id2]; x.servicePhaseM = modeOf(x.sp); x.appSceneM = modeOf(x.sc); x.promoSceneM = modeOf(x.pr); list.push(x); }
    var total = list.length;
    var pos = list.filter(function (a) { return a.pos; });
    var posN = pos.length;
    var totSave = list.reduce(function (s, a) { return s + a.save; }, 0);
    var totReal = list.reduce(function (s, a) { return s + a.real; }, 0);
    var posSave = pos.reduce(function (s, a) { return s + a.save; }, 0);
    var posReal = pos.reduce(function (s, a) { return s + a.real; }, 0);
    /* 亏损价值智能体：存在「产生真实价值<0」月份的应用（无论是否某月被标为正向） */
    var loss = list.filter(function (a) { return a.hasNeg; });
    var lossN = loss.length;
    var lossSum = loss.reduce(function (s, a) { return s + a.neg; }, 0);

    function groupBy(keyFn, minAll) {
      var m = {};
      list.forEach(function (a) { var k = keyFn(a) || "(空)"; (m[k] = m[k] || { all: 0, pos: 0, save: 0 }); m[k].all++; if (a.pos) { m[k].pos++; m[k].save += a.save; } });
      var arr = Object.keys(m).map(function (k) { return { name: k, dn: (k === "(空)" ? "未标注" : k), all: m[k].all, pos: m[k].pos, save: m[k].save, rate: m[k].all ? m[k].pos / m[k].all : 0 }; });
      if (minAll) arr = arr.filter(function (x) { return x.all >= minAll; });
      arr.sort(function (a, b) { return b.rate - a.rate; });
      return arr;
    }
    var byType = groupBy(function (a) { return a.type; });
    var byPhase = groupBy(function (a) { return a.servicePhaseM; });
    var byScene = groupBy(function (a) { return a.appSceneM; }, 5);
    var byPromo = groupBy(function (a) { return a.promoSceneM; });

    var nameMap = {};
    list.forEach(function (a) {
      var k = a.name || "(未命名)";
      if (!nameMap[k]) nameMap[k] = { name: k, dn: k, all: 0, pos: 0, save: 0 };
      nameMap[k].all++; if (a.pos) nameMap[k].pos++;
      nameMap[k].save += a.save;
    });
    var byNameTop = Object.keys(nameMap).map(function (k) {
      var o = nameMap[k];
      return { name: o.name, dn: (o.name.length > 14 ? o.name.slice(0, 13) + "…" : o.name), all: o.all, pos: o.pos, save: o.save, rate: o.all ? o.pos / o.all : 0 };
    }).sort(function (a, b) { return b.save - a.save; }).slice(0, 12);

    var topArr = pos.slice().sort(function (a, b) { return b.save - a.save; });
    var top1 = topArr[0];
    var top1Share = totSave ? top1.save / totSave : 0;
    var top10Share = totSave ? topArr.slice(0, 10).reduce(function (s, a) { return s + a.save; }, 0) / totSave : 0;

    byId("agPosKpis").innerHTML = [
      posKpiCard("智能体总数", fmtInt(total), "去重应用 · 全量", "#475569"),
      posKpiCard("正向价值智能体", fmtInt(posN) + "（" + (posN / total * 100).toFixed(1) + "%）", "含任一正向月份", "#16a34a"),
      posKpiCard("正向价值贡献占比", (posSave / (totSave || 1) * 100).toFixed(1) + "%", "节约金额 " + fmtWan(posSave) + " / " + fmtWan(totSave), "#2563eb"),
      posKpiCard("亏损价值智能体", fmtInt(lossN), "产生真实价值为负 · 累计 " + fmtWan(lossSum) + " 元", "#dc2626", { click: "loss" }),
      posKpiCard("头部集中度", (top1Share * 100).toFixed(1) + "%", "Top1 占全部节约金额", "#dc2626")
    ].join("");

    var lossCard = byId("agPosKpis").querySelector('[data-kpi-click="loss"]');
    if (lossCard) {
      lossCard.addEventListener("click", function () { openLossDetail(loss); });
      lossCard.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openLossDetail(loss); } });
    }

    posRateBar("agPosType", byPhase);
    posRateBar("agPosPhase", byScene);
    posRateBar("agPosScene", byNameTop);
    posRateBar("agPosPromo", byPromo);

    var wf = byType.filter(function (x) { return x.name === "工作流"; })[0];
    var wfVal = wf ? (wf.save / (totSave || 1) * 100).toFixed(1) : "—";
    var ag = byType.filter(function (x) { return x.name === "智能体"; })[0];
    var agRate = ag ? (ag.rate * 100).toFixed(1) : "—";
    var bestScene = byScene[0];
    var bestPhase = byPhase[0];
    var promoted = byPromo.filter(function (x) { return x.name !== "(空)"; });
    var nat = byPromo.filter(function (x) { return x.name === "(空)"; })[0];
    var promoAvg = promoted.length ? (promoPromotedAvg(promoted) * 100).toFixed(1) : "—";
    var natRate = nat ? (nat.rate * 100).toFixed(1) : "0";
    var promoRatio = "—";
    if (promoAvg !== "—" && parseFloat(natRate) > 0) promoRatio = (parseFloat(promoAvg) / parseFloat(natRate)).toFixed(0);

    host.innerHTML =
      '<div class="agx-insights">' +
      '<p><b>一、总体：价值极度头部化。</b>全量 ' + fmtInt(total) + ' 个智能体中仅 <b>' + posN + ' 个（' + (posN / total * 100).toFixed(1) + '%）</b>被判定为正向价值，却贡献了约 <b>' + (posSave / (totSave || 1) * 100).toFixed(1) + '%</b> 的节约金额与全部正向真实价值；另有 <b>' + lossN + ' 个</b>应用存在「产生真实价值为负」的月份（累计亏损约 ' + fmtWan(lossSum) + ' 元，已在上方「亏损价值智能体」卡片单列），95% 的智能体在当前计量口径下不产生可衡量价值。</p>' +
      '<p><b>二、类型画像。</b>「工作流」是价值主引擎，独占正向价值约 <b>' + wfVal + '%</b>；「智能体」正向率最高（' + agRate + '%），是命中率更优的"精兵"；「对话流」正向率为 0，应停止在其上设定价值目标。</p>' +
      '<p><b>三、分类画像（服务类型 + 场景族）。</b>按服务环节看，正向率最高的是 <b>' + esc(bestPhase.name) + '（' + (bestPhase.rate * 100).toFixed(1) + '%）</b>，其次为服务中、服务后；高频正向场景清一色属于 <b>"稽核 / 查证 / 预判 / 分析"</b> 四类：正向率最高的是 ' + esc(bestScene.name) + '（' + (bestScene.rate * 100).toFixed(1) + '%），其次为退费稽核、工单查证、服务质量稽核等。被平台<b>策展推广</b>的场景正向率平均 ' + promoAvg + '%，而<b>自然生长</b>场景仅 ' + natRate + '%（约 ' + promoRatio + ' 倍差距）。</p>' +
      '<p><b>四、价值分布风险。</b>头部极端集中：单个智能体即占全部节约金额的 <b>' + (top1Share * 100).toFixed(1) + '%</b>，Top10 占 ' + (top10Share * 100).toFixed(1) + '%；且正向智能体几乎全部为单省部署，优秀模式尚未跨省复制（省份孤岛）。</p>' +
      '<p><b>五、平台引导方向。</b>① 类型：主力用「工作流」规模化承重，精兵用「智能体」，停投「对话流」；② 场景：优先孵化服务前预判拦截（命中率最高）、规模化服务后稽核质检，聚焦已验证的稽核/查证/预判场景族；③ 机制：以"策展模板化推广"替代自由生长（复制 15–25 倍正向率），把头部模式抽象为跨省模板打破省份孤岛，并以"正向率 + 价值密度"替代"智能体数量"作为健康度 KPI。</p>' +
      '</div>';
  }
  /* 亏损价值智能体明细弹窗：点击「亏损价值智能体」KPI 卡片触发 */
  function fmtYuan(v) { return (v == null || isNaN(v)) ? "/" : (v < 0 ? "-" : "") + fmtWan(Math.abs(v)) + "元"; }
  function openLossDetail(lossAgents) {
    closeLossDetail();
    var sorted = (lossAgents || []).slice().sort(function (a, b) { return a.neg - b.neg; }); // 亏损最多的排前面
    var totalNeg = sorted.reduce(function (s, a) { return s + a.neg; }, 0);

    function negDetail(a) {
      var rows = (a.negRows || []).slice().sort(function (x, y) { return monthNo(y.month) - monthNo(x.month); });
      if (!rows.length) return "—";
      return rows.map(function (x) {
        var mp = (x.month || "?") + (x.province ? "·" + x.province : "");
        return esc(mp) + ": " + fmtYuan(x.real);
      }).join("；");
    }

    var tb = "";
    sorted.forEach(function (a) {
      tb += "<tr>" +
        "<td><b>" + esc(a.name || "(未命名)") + "</b></td>" +
        "<td>" + esc(a.type || "—") + "</td>" +
        "<td>" + esc(a.servicePhaseM || "—") + "</td>" +
        "<td>" + esc(a.appSceneM || "—") + "</td>" +
        "<td class='num' style='color:#dc2626;white-space:nowrap'>" + fmtYuan(a.neg) + "</td>" +
        "<td class='num'>" + fmtInt((a.negRows || []).length) + "</td>" +
        "<td style='white-space:normal;min-width:300px;color:#475569'>" + negDetail(a) + "</td>" +
        "</tr>";
    });
    var trow = "<tr class='qe-modal-total'><td colspan='4'><b>合计（" + fmtInt(sorted.length) + " 个亏损智能体）</b></td>" +
      "<td class='num' style='color:#dc2626'><b>" + fmtYuan(totalNeg) + "</b></td><td class='num'>—</td><td></td></tr>";

    var body = '<div class="qe-modal-scroll"><table class="qe-modal-table">' +
      "<thead><tr>" +
      "<th>应用名称</th><th>类型</th><th>服务环节</th><th>应用场景</th>" +
      "<th>累计亏损</th><th>负价值月份数</th><th>负价值明细（月份·省份: 金额）</th>" +
      "</tr></thead><tbody>" + tb + trow + "</tbody></table></div>";

    var modal = document.createElement("div");
    modal.className = "qe-modal-mask";
    modal.id = "agLossModal";
    modal.innerHTML =
      '<div class="qe-modal" role="dialog" aria-modal="true" aria-label="亏损价值智能体明细">' +
        '<div class="qe-modal-head">' +
          '<div class="qe-modal-title">亏损价值智能体明细 · 共 ' + fmtInt(sorted.length) + ' 个</div>' +
          '<button type="button" class="qe-modal-close" id="agLossModalClose" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="qe-modal-body">' + body + '</div>' +
        '<div class="qe-modal-foot">口径：以应用（appId）为维度汇总「产生真实价值&lt;0」的月份，累计为各月负值之和；明细按 月份·省份 列出每条负值记录。</div>' +
      '</div>';
    document.body.appendChild(modal);
    var cb = byId("agLossModalClose");
    if (cb) cb.onclick = closeLossDetail;
    modal.onclick = function (ev) { if (ev.target === modal) closeLossDetail(); };
    document.addEventListener("keydown", onLossModalKey, true);
  }
  function onLossModalKey(ev) { if (ev.key === "Escape") closeLossDetail(); }
  function closeLossDetail() {
    var m = byId("agLossModal");
    if (m && m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener("keydown", onLossModalKey, true);
  }
  function promoPromotedAvg(arr) { return arr.reduce(function (s, x) { return s + x.rate; }, 0) / arr.length; }

  function renderAgents() {
    _rows = null; _cases = null; _life = null;
    _months = null; _provinces = null;
    _idxEntity = _idxProv = _idxMonth = _idxProvMonth = null;
    built = false;
    loadMeta();
    var note = document.querySelector && document.querySelector(".filter-note");
    if (note) note.textContent = "预览数据：来自【合】灵运BI重要数据_智能体分类_20260902.xlsx · 正式接入由基座统一生成 data.js";
    buildShell();
    if (!sourceRows().length) { renderAll(); return; }
    renderControls();
    renderAll();
  }

  if (window.addEventListener) window.addEventListener("resize", function () {
    Object.keys(charts).forEach(function (k) { try { charts[k].resize(); } catch (e) {} });
  });
})();
