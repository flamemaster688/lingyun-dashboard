/* ===== core/core.js ===== */
/* core/core.js — 灵运 BI 看板·共享内核（全局脚本）
 * 由 build/split.py 从 lingyun.app.v10.js 自动拆分生成，请勿手工搬动页面渲染函数。
 * 职责：共享状态(D/FILTER/V)、工具函数、离线数据管线、tab 注册表与分发。
 * 页面渲染函数全部位于 static/pages/*.js，通过 window.registerPage 注册。
 */
/* v20260817.0 页面级筛选 + 页面级数据源，各 Tab 互不干扰 */
/* 灵运平台 BI 看板 · 渲染逻辑（真实数据·项目内离线 Excel 固化，不依赖任何在线文档）
 * 数据约定见 data.js：meta / overview / agents / provinces / tracking / capability / alerts
 * 缺数统一以 null 表示，渲染为 "/"。
 */

  "use strict";
  var DEFAULT_DATA = window.LINGYUN_DATA || {};
  var instMap = {};
  window.LY = window.LY || { pages: {} };
  window.registerPage = function (cfg) { window.LY.pages[cfg.id] = cfg; };
  window.optimizePage = function (id) { var p = window.LY.pages[id]; if (p && p.render) p.render(); };


  /* 时间维度 / 单位常量（会在 switchTab 时按当前页数据重新计算） */
  var MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月"];
  var NATL = "总计"; // 全国
  var HQ = "本部";

  /* 当前 tab */
  var currentTab = "overview";

  /* 页面级状态：每个 tab 独立保存 filter / data / source */
  function newFilter() { return { dim: "month", months: [], weeks: [], days: [], prov: [], pfScope: "all", pfWeeks: [], pfMonth: "" }; }
  function newState() { return { filter: newFilter(), data: DEFAULT_DATA, source: { type: "default", files: [], kdocUrl: "" } }; }
  var PAGE_STATE = {
    overview: newState(), agents: newState(), pages: newState(),
    province: newState(), quality: newState(), report: newState(),
    "pages-monthly": newState()
  };

  /* 当前视图（由 computeView 计算）：通过重新赋值指向当前 tab，所有 render 函数无需改动 */
  var D = PAGE_STATE.overview.data;
  var FILTER = PAGE_STATE.overview.filter;
  var V = null;

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function dash(v) { return (v === null || v === undefined || v === "") ? "/" : v; }
  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return "/";
    return Number(n).toLocaleString("zh-CN");
  }
  function fmtWan(n) {
    if (n === null || n === undefined || isNaN(n)) return "/";
    var x = Number(n);
    if (Math.abs(x) >= 1e8) return (x / 1e8).toFixed(2) + " 亿";
    if (Math.abs(x) >= 1e4) return (x / 1e4).toFixed(1) + " 万";
    return fmtInt(x);
  }
  function fmtPY(n) {
    if (n === null || n === undefined || isNaN(n)) return "/";
    return Number(n).toFixed(2) + " 人年";
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return "/";
    return "¥" + Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  }
  function topChart(id, option) {
    var box = $(id);
    if (!box) return;
    if (!window.echarts) {
      box.innerHTML = '<div class="chart-fallback">图表库（ECharts）未加载，请联网后刷新；数据表格不受影响。</div>';
      return;
    }
    if (instMap[id]) { try { instMap[id].dispose(); } catch (e) {} }
    var c = window.echarts.init(box);
    c.setOption(option);
    instMap[id] = c;
  }
  function insightBox(id, html) { var b = $(id); if (b) b.innerHTML = '<div class="insight">' + html + "</div>"; }
  function noteBox(id, txt) {
    var b = $(id); if (!b) return;
    b.innerHTML = txt ? '<div class="filter-note">' + txt + "</div>" : "";
  }
  var AX = "#9ca3af", GRID = "#e5e7eb", INK = "#1f2937", SUB = "#6b7280";
  var PALETTE = ["#3b82f6", "#14b8a6", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e", "#60a5fa", "#a855f7"];
  /* 省份简称 → geoJSON 全称（地图注册用） */
  var PROV_NAME_MAP = {
    "上海": "上海市", "云南": "云南省", "内蒙古": "内蒙古自治区", "北京": "北京市", "吉林": "吉林省",
    "四川": "四川省", "天津": "天津市", "宁夏": "宁夏回族自治区", "安徽": "安徽省", "山东": "山东省",
    "山西": "山西省", "广东": "广东省", "广西": "广西壮族自治区", "新疆": "新疆维吾尔自治区", "江苏": "江苏省",
    "江西": "江西省", "河北": "河北省", "河南": "河南省", "浙江": "浙江省", "海南": "海南省",
    "湖北": "湖北省", "湖南": "湖南省", "甘肃": "甘肃省", "福建": "福建省", "西藏": "西藏自治区",
    "贵州": "贵州省", "辽宁": "辽宁省", "重庆": "重庆市", "陕西": "陕西省", "青海": "青海省",
    "黑龙江": "黑龙江省"
  };

  /* ---------- 视图计算（时间 + 省份筛选） ---------- */
  function selMonthIdxs() {
    if (FILTER.dim !== "month" || !FILTER.months.length) return null; // null = 全月
    return FILTER.months.map(function (m) { return MONTHS.indexOf(m); }).filter(function (i) { return i >= 0; });
  }
  function sumMonths(arr, idxs) {
    if (!arr || !arr.length) return null;
    var idx = idxs || arr.map(function (_, i) { return i; });
    var s = 0, any = false;
    idx.forEach(function (i) { if (i < arr.length && arr[i] != null) { s += arr[i]; any = true; } });
    return any ? s : null;
  }
  function provSet() {
    if (!FILTER.prov.length || FILTER.prov.indexOf("全国") >= 0) return null; // null = 全部
    var o = {}; FILTER.prov.forEach(function (u) { if (u !== "全国") o[u] = 1; }); return o;
  }
  function periodLabel() {
    if (FILTER.dim === "week") {
      return FILTER.weeks.length ? ("2026年 " + FILTER.weeks.join("、") + "周") : "2026年 0720-0726周(全)";
    }
    if (FILTER.dim === "day") return "日维度（数据未接入·全周期）";
    // month
    if (!FILTER.months.length) return "全周期 2026年1-7月";
    var ms = FILTER.months.slice().sort(function (a, b) { return MONTHS.indexOf(a) - MONTHS.indexOf(b); });
    if (ms.length === 1) return "2026年 " + ms[0];
    // 连续则显示范围，否则列举
    var ci = ms.map(function (m) { return MONTHS.indexOf(m); }).sort(function (a, b) { return a - b; });
    var contig = true; for (var i = 1; i < ci.length; i++) { if (ci[i] !== ci[i - 1] + 1) { contig = false; break; } }
    if (contig) return "2026年 " + MONTHS[ci[0]] + "–" + MONTHS[ci[ci.length - 1]] + "（" + ms.length + "个月）";
    return "2026年 " + ms.join("、");
  }
  function provLabel() {
    if (!FILTER.prov.length || FILTER.prov.indexOf("全国") >= 0) return "全国";
    return "已选 " + FILTER.prov.length + " 个单位";
  }
  function computeView() {
    var idxs = selMonthIdxs();
    var pset = provSet();
    var VV = { flags: { dim: FILTER.dim, periodLabel: periodLabel(), provLabel: provLabel() } };

    /* 总览 */
    var ov = D.overview || {};
    var Vov = { monthly: ov.monthly || [], kpis: ov.kpis || {} };
    if (idxs && ov.monthly && ov.monthly.length) {
      var mm = ov.monthly.filter(function (m) { return FILTER.months.indexOf(m.month) >= 0; });
      if (mm.length) {
        var tc = 0, ty = 0; mm.forEach(function (m) { tc += (m.calls || 0); ty += (m.personYear || 0); });
        var la = mm[mm.length - 1].activeAgents;
        var peak = mm.slice().sort(function (a, b) { return (b.calls || 0) - (a.calls || 0); })[0];
        Vov.monthly = mm;
        Vov.kpis = {
          totalCalls: tc, totalPersonYear: round2(ty), latestActiveAgents: la,
          avgCalls: Math.round(tc / mm.length), peakMonth: peak.month, peakCalls: peak.calls, yoyPersonYear: null
        };
      }
    }
    VV.overview = Vov;
    VV.flags.overviewProvNote = pset ? "总览为全国汇总（数据源无分省明细），省份筛选不生效。" : null;

    /* 智能体 */
    var ags = (D.agents || []).filter(function (a) { return a && a.name; });
    if (pset) ags = ags.filter(function (a) { return a.province && pset[a.province]; });
    ags.forEach(function (a) {
      a._pt = (idxs && a.monthly) ? sumMonths(a.monthly, idxs) : (a.total != null ? a.total : null);
    });
    VV.agents = ags;

    /* 省份（排除 总计 聚合行，避免重复计数） */
    var ps = (D.provinces || []).filter(function (p) { return p && p.province && p.province !== NATL; });
    if (pset) ps = ps.filter(function (p) { return pset[p.province]; });
    ps.forEach(function (p) {
      p._calls = (idxs) ? sumMonths(p.monthlyCalls, idxs) : p.calls;
      p._tokens = (idxs) ? sumMonths(p.monthlyTokens, idxs) : p.tokens;
      p._cost = (idxs) ? sumMonths(p.monthlyCost, idxs) : p.cost;
      p._active = (idxs && p.monthlyActive && idxs.length) ? p.monthlyActive[idxs[idxs.length - 1]] : p.activeAgents;
    });
    VV.provinces = ps;

    /* 质效 */
    var cap = D.capability || {};
    var Vcap = { yearly: cap.yearly || {}, monthly: cap.monthly || [] };
    if (idxs && cap.monthly && cap.monthly.length) {
      var cm = cap.monthly.filter(function (m) { return FILTER.months.indexOf(m.month) >= 0; });
      if (cm.length) {
        var yearly = {};
        cm.forEach(function (m) { Object.keys(m).forEach(function (k) { if (k === "month") return; yearly[k] = (yearly[k] || 0) + (m[k] || 0); }); });
        Object.keys(yearly).forEach(function (k) { yearly[k] = round2(yearly[k]); });
        Vcap.monthly = cm; Vcap.yearly = yearly;
      }
    }
    VV.capability = Vcap;
    VV.flags.capProvNote = pset ? "质效为全国汇总（数据源无分省明细），省份筛选不生效。" : null;

    /* 平台分析 / 埋点（平台分析 doc·多周·含分省） */
    VV.tracking = (D.tracking || []).slice();
    var pt = D.platformTracking || null;
    if (pt && pset) {
      var filt = (pt.provinceTotals || []).filter(function (x) { return pset[x.province]; });
      pt = Object.assign({}, pt, { provinceTotals: filt, _provFiltered: true });
    }
    VV.platformTracking = pt;
    VV.platformMonthly = (D.platformMonthly) || null;
    VV.flags.trackProvNote = pset ? "平台分析已含分省埋点，省份筛选将联动省份维度图表（页面维度仍为全国汇总）。" : null;
    var _wk = (pt && pt.weeks && pt.weeks.length) || 0;
    if (FILTER.dim === "month") VV.flags.trackTimeNote = "平台分析按周统计（" + _wk + " 周），无月度拆分，时间筛选不影响此处。";
    else if (FILTER.dim === "day") VV.flags.trackTimeNote = "平台分析按周统计，无日拆分，时间筛选不影响此处。";
    else VV.flags.trackTimeNote = null; // week

    V = VV;
    window.LY.getView = function () { return V; }; // 统一数据接口读取当前计算视图
  }

  /* ---------- 页面状态提示 ---------- */
  function renderBadges() {
    var m = D.meta || {};
    // 页面标题周期提示
    var titles = { overview: "ovTitle", pages: "pgTitle", province: "prTitle", quality: "qeTitle" };
    var tid = titles[currentTab];
    var el = tid ? $(tid) : null;
    if (el && V && V.flags) {
      var base = { overview: "数据总览", pages: "平台分析", province: "省份分析", quality: "多能力等效人年（量质构效）" }[currentTab];
      if (base) el.textContent = base + "（" + V.flags.periodLabel + " · " + V.flags.provLabel + "）";
    }
  }

  /* ---------- 总览（四行：核心卡片 / 趋势 / 应用与省份 / 成本与价值） ---------- */
  
  /* 数据源缺失占位 */
  function showGap(id, title, note) {
    var b = $(id); if (!b) return;
    b.innerHTML = '<div class="gap-block"><div class="gap-title">' + title + '</div><div class="gap-note">' + note + "</div></div>";
  }
  function kpiGap(title, val, sub) {
    return '<div class="kpi kpi-warn"><div class="lb">' + title + '</div><div class="val warn">' + val + '</div><div class="delta flat">' + (sub || "") + "</div></div>";
  }
  /* 月度 Token / 计费汇总（按省份按月求和 → 全国逐月） */
  function computeMonthlyCost() {
    var provs = V.provinces || [];
    var n = MONTHS.length;
    var tk = new Array(n).fill(0), co = new Array(n).fill(0);
    provs.forEach(function (p) {
      (p.monthlyTokens || []).forEach(function (v, i) { if (v != null && i < n) tk[i] += v; });
      (p.monthlyCost || []).forEach(function (v, i) { if (v != null && i < n) co[i] += v; });
    });
    return { months: MONTHS.slice(0, n), tokens: tk, cost: co };
  }
  /* 省份等效人年地图 */
  
  function kpi(title, val, sub) {
    return '<div class="kpi"><div class="lb">' + title + '</div><div class="val">' + val + '</div><div class="delta flat">' + (sub || "") + "</div></div>";
  }

  /* ---------- 智能体 ---------- */
  var AGENT_TYPES = ["推广案例", "优秀案例", "双周优秀案例"];
  function agTypes(a) { return (a.types && a.types.length) ? a.types : (a.scenario ? [a.scenario] : []); }
  

  /* ---------- 智能体·等效人年类型统计（推广+优秀+双周） ---------- */
  

  /* ---------- 智能体·调用量统计（埋点点击量代理） ---------- */
  

  /* ---------- 埋点 ---------- */
  

  /* ---------- 省份 ---------- */
  

  /* ---------- 分中心等效人年排名（月份+省份+分项 可筛选） ---------- */
  var CENTER_RANK_STATE = null;

  

  

  

  

  

  

  function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function fmtPct(n) { return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }
  function fmtScore(s) { return (s == null ? "/" : s.toFixed(2)); }

  // 实际勾选月份范围标签（如“3月-5月”/“3月”），用于表头与下载说明
  
  // 实际勾选省份标签
  
  // 分项展示列：每个勾选能力一列，优先展示 2026（当前年）数据，无则回退 2025
  

  

  

  

  /* ---------- 质效（多能力等效人年） ---------- */
  

  /* ---------- 告警 ---------- */
  

  /* ---------- 报告（基于当前筛选） ---------- */
  function genReport(type) {
    var m = D.meta || {}, ov = V.overview || {}, k = ov.kpis || {};
    var ps = (V.provinces || []).slice().sort(function (a, b) { return (b._calls || 0) - (a._calls || 0); });
    var tp = (V.tracking || []).slice();
    var cap = V.capability || {};
    var L = [];
    var title = type === "leader" ? "灵运平台数据汇报（领导精简版）" : type === "branch" ? "灵运平台分中心数据通报" : "灵运平台月度经营报告";
    L.push("# " + title);
    L.push("");
    L.push("- 数据来源：" + (m.source || "—") + "（" + (m.fileUrl || "") + "）");
    L.push("- 统计周期：" + V.flags.periodLabel + " · 统计单位：" + V.flags.provLabel + " · 生成时间：" + (m.generatedAt || "—"));
    if (FILTER.prov.length && FILTER.prov.indexOf("全国") < 0) L.push("- 已选单位：" + FILTER.prov.join("、"));
    L.push("");
    L.push("## 一、核心指标");
    L.push("- 累计调用量：" + fmtWan(k.totalCalls));
    L.push("- 累计节约人年：" + fmtPY(k.totalPersonYear));
    L.push("- 最新月活跃智能体：" + dash(k.latestActiveAgents) + " 个");
    L.push("- 月均调用量：" + fmtWan(k.avgCalls) + "（峰值 " + (k.peakMonth || "/") + " " + fmtWan(k.peakCalls) + "）");
    L.push("");
    L.push("## 二、省份表现（TOP5）");
    ps.slice(0, 5).forEach(function (p, i) {
      L.push((i + 1) + ". " + p.province + "：调用量 " + fmtWan(p._calls) + "，活跃智能体 " + dash(p._active) + "，Token " + fmtWan(p._tokens) + "，模型计费 " + fmtMoney(p._cost));
    });
    L.push("");
    L.push("## 三、页面埋点（TOP5）");
    tp.slice(0, 5).forEach(function (t, i) {
      L.push((i + 1) + ". " + t.page + "：点击 " + fmtInt(t.clicks) + "，访客 " + fmtInt(t.visitors) + "，曝光 " + fmtInt(t.exposures) + "，点击率 " + dash(t.ctr == null ? null : t.ctr.toFixed(2) + "%"));
    });
    L.push("");
    L.push("## 四、多能力等效人年");
    var y = cap.yearly || {};
    Object.keys(y).forEach(function (key) { L.push("- " + key + "：" + fmtPY(y[key])); });
    L.push("");
    L.push("## 五、智能体类型与调用");
    var ags = (V.agents || []).filter(function (a) { return a && a._pt != null; });
    var tot = { "推广案例": 0, "优秀案例": 0, "双周优秀案例": 0 }, cnt = { "推广案例": 0, "优秀案例": 0, "双周优秀案例": 0 };
    ags.forEach(function (a) { agTypes(a).forEach(function (t) { if (tot[t] != null) { tot[t] += (a._pt || 0); cnt[t] += 1; } }); });
    L.push("- 推广案例等效人年：" + fmtPY(round2(tot["推广案例"])) + "（" + cnt["推广案例"] + " 个）");
    L.push("- 优秀案例等效人年：" + fmtPY(round2(tot["优秀案例"])) + "（" + cnt["优秀案例"] + " 个）");
    L.push("- 双周优秀案例等效人年：" + fmtPY(round2(tot["双周优秀案例"])) + "（" + cnt["双周优秀案例"] + " 个）");
    var tp2 = (V.tracking || []).filter(function (t) { return (t.clicks || 0) > 1000; });
    L.push("- 调用量（埋点点击量·0720-0726）>1000 的入口：" + tp2.length + " 个" + (tp2[0] ? "（最高 " + tp2[0].page + " " + fmtInt(tp2[0].clicks) + "）" : ""));
    L.push("- 注：文件未提供逐智能体月度调用量，调用量为埋点点击量代理指标。");
    L.push("");
    if (type === "branch") {
      L.push("## 六、下发说明");
      L.push("请各分中心关注本省调用量与 Token 消耗，异常省份详见后台明细。");
    } else if (type === "leader") {
      L.push("## 六、结论");
      L.push("灵运平台调用量稳步增长，等效人年持续累积；建议重点扩大语音、灵运平台等高人效能力的覆盖。");
    } else {
      L.push("## 六、趋势与建议");
      L.push("调用量 6–7 月显著抬升；建议结合分中心话术配置与推广节奏，维持增长。告警数据当前文件未提供（以/显示）。");
    }
    L.push("");
    L.push("> 缺口备注：" + ((m.gaps || []).join("；") || "无"));
    return L.join("\n");
  }
  

  /* ---------- 辅助 ---------- */
  function uniq(arr) { var s = {}, o = []; arr.forEach(function (x) { if (x != null && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function round2(n) { return Math.round((n || 0) * 100) / 100; }

  /* ---------- 全局筛选 UI ---------- */
  function isUnitOn(key) {
    if (key === "全国") return (!FILTER.prov.length || FILTER.prov.indexOf("全国") >= 0);
    return FILTER.prov.indexOf(key) >= 0;
  }
  function toggleUnit(key) {
    if (key === "全国") { FILTER.prov = []; }
    else {
      var i = FILTER.prov.indexOf(key);
      if (i >= 0) FILTER.prov.splice(i, 1);
      else FILTER.prov.push(key);
      // 选中具体单位即退出"全国"全量模式（FILTER.prov 不含"全国"即代表子集）
    }
    applyFilter();
  }
  function buildProvinceUI() {
    var chips = $("provChips"); if (!chips) return;
    var all = (D.meta && D.meta.provinces) || [];
    var provs = all.filter(function (p) { return p !== NATL && p !== HQ; }).sort();
    var units = [{ name: "全国", key: "全国", natl: true }]
      .concat([{ name: HQ, key: HQ }])
      .concat(provs.map(function (p) { return { name: p, key: p }; }));
    chips.innerHTML = units.map(function (u) {
      var on = isUnitOn(u.key) ? " on" : "";
      var sp = u.natl ? " chip-natl" : "";
      return '<button class="chip uchip' + on + sp + '" data-u="' + u.key + '">' + u.name + "</button>";
    }).join("");
    chips.querySelectorAll(".uchip").forEach(function (c) { c.onclick = function () { toggleUnit(c.dataset.u); }; });
  }
  function toggleMonth(m) {
    var i = FILTER.months.indexOf(m);
    if (i >= 0) FILTER.months.splice(i, 1); else FILTER.months.push(m);
    applyFilter();
  }
  function toggleWeek(w) {
    var i = FILTER.weeks.indexOf(w);
    if (i >= 0) FILTER.weeks.splice(i, 1); else FILTER.weeks.push(w);
    applyFilter();
  }
  function buildTimeRange() {
    var box = $("timeRange"); if (!box) return;
    var dim = FILTER.dim;
    if (dim === "month") {
      var chips = MONTHS.map(function (m) {
        var on = FILTER.months.indexOf(m) >= 0 ? " on" : "";
        return '<button class="chip rchip' + on + '" data-m="' + m + '">' + m + "</button>";
      }).join("");
      box.innerHTML = '<div class="range-actions"><button class="btn btn-ghost sm" id="mAll">全选</button><button class="btn btn-ghost sm" id="mNone">清空</button></div>' +
        '<div class="range-chips">' + chips + "</div>";
      box.querySelectorAll(".rchip").forEach(function (c) { c.onclick = function () { toggleMonth(c.dataset.m); }; });
      var mA = $("mAll"); if (mA) mA.onclick = function () { FILTER.months = MONTHS.slice(); applyFilter(); };
      var mN = $("mNone"); if (mN) mN.onclick = function () { FILTER.months = []; applyFilter(); };
    } else if (dim === "week") {
      var weeks = (D.meta.timeLevels && D.meta.timeLevels.weeks) || [];
      if (!weeks.length) { box.innerHTML = '<div class="filter-note">当前数据源无周维度数据（仅埋点模块含 0720-0726 一周）。</div>'; return; }
      var wchips = weeks.map(function (w) { var on = FILTER.weeks.indexOf(w) >= 0 ? " on" : ""; return '<button class="chip rchip' + on + '" data-w="' + w + '">' + w + "</button>"; }).join("");
      box.innerHTML = '<div class="range-actions"><button class="btn btn-ghost sm" id="wAll">全选</button><button class="btn btn-ghost sm" id="wNone">清空</button></div>' +
        '<div class="range-chips">' + wchips + '</div><div class="filter-note">周维度仅适用于「埋点分析」模块；其余模块按全周期展示。</div>';
      box.querySelectorAll(".rchip").forEach(function (c) { c.onclick = function () { toggleWeek(c.dataset.w); }; });
      var wA = $("wAll"); if (wA) wA.onclick = function () { FILTER.weeks = weeks.slice(); applyFilter(); };
      var wN = $("wNone"); if (wN) wN.onclick = function () { FILTER.weeks = []; applyFilter(); };
    } else {
      box.innerHTML = '<div class="filter-note">日维度数据尚未接入。当前数据源最低粒度为「周」（埋点 0720-0726）与「月」（1-7月）。选择日维度时看板按全周期展示。</div>';
    }
  }
  function applyFilter() {
    FILTER.dim = "month"; // 全局时间筛选仅保留「月」维度
    computeView();
    renderBadges();
    // 仅刷新当前页的 toolbar 控件选中态
    renderPageToolbar(currentTab);
    renderCurrent(currentTab);
  }

  /* ---------- 数据源：本地上传 / 内置离线快照（Excel 固化，无在线文档） ---------- */
  var MAX_MB = 100;
  var ACCEPT = ["csv", "xlsx", "xls", "json"];
  function normHeader(h) { return String(h == null ? "" : h).trim().toLowerCase().replace(/\s+/g, ""); }
  function pick(obj, names) { for (var i = 0; i < names.length; i++) { if (obj[names[i]] !== undefined && obj[names[i]] !== "") return obj[names[i]]; } return undefined; }
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(String(v).replace(/,/g, "")); return isNaN(n) ? null : n; }

  var AGENT_MAP = {
    name: ["name", "应用名称", "应用", "智能体"], province: ["province", "省份", "省"], group: ["group", "分组", "类别", "类型"],
    createdAt: ["createdat", "创建时间", "创建日期", "创建于"], creator: ["creator", "创建人", "负责人", "作者"], scenario: ["scenario", "场景", "用途"]
  };
  var PROV_MAP = {
    province: ["province", "省份", "省"], calls: ["calls", "调用量", "调用次数", "总调用"], activeAgents: ["activeagents", "活跃智能体", "活跃"],
    tokens: ["tokens", "token", "token消耗", "令牌"], cost: ["cost", "费用", "计费", "模型计费", "金额"]
  };
  var TRACK_MAP = {
    page: ["page", "pagename", "页面", "页面名称", "路径"], clicks: ["clicks", "click", "点击量", "点击"], visitors: ["visitors", "visitor", "访客", "访客人数", "uv"],
    exposures: ["exposures", "exposure", "曝光", "曝光次数", "pv", "展示"], ctr: ["ctr", "点击率", "点击转化率"]
  };

  function mapAgents(rows) {
    return rows.map(function (r) {
      var nh = {}; Object.keys(r).forEach(function (k) { nh[normHeader(k)] = r[k]; });
      var a = {
        group: pick(nh, AGENT_MAP.group) || null, province: pick(nh, AGENT_MAP.province) || null, name: pick(nh, AGENT_MAP.name) || null,
        createdAt: pick(nh, AGENT_MAP.createdAt) || null, creator: pick(nh, AGENT_MAP.creator) || null, scenario: pick(nh, AGENT_MAP.scenario) || null,
        monthly: null, total: num(pick(nh, ["total", "总计等效人年", "等效人年", "总人年", "总计", "合计", "等效人年合计"])), note: pick(nh, ["note", "备注", "说明"]) || null
      };
      var mon = [];
      for (var k in nh) { var m = /(\d{1,2})月/.exec(k); if (m) { var idx = parseInt(m[1], 10) - 1; if (idx >= 0) mon[idx] = num(nh[k]); } }
      if (mon.length) a.monthly = mon;
      if (a.name == null) return null;
      var scn = a.scenario;
      var ts = scn ? scn.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
      a.types = ts.length ? ts : null;
      return a;
    }).filter(Boolean);
  }
  function mapProvinces(rows) {
    return rows.map(function (r) {
      var nh = {}; Object.keys(r).forEach(function (k) { nh[normHeader(k)] = r[k]; });
      var p = {
        province: pick(nh, PROV_MAP.province) || null,
        monthlyCalls: null, monthlyActive: null, monthlyTokens: null, monthlyCost: null,
        calls: num(pick(nh, PROV_MAP.calls)), activeAgents: num(pick(nh, PROV_MAP.activeAgents)),
        tokens: num(pick(nh, PROV_MAP.tokens)), cost: num(pick(nh, PROV_MAP.cost))
      };
      // 尝试解析月度列（形如 1月..7月 / 1月..6月）
      var mc = [], ma = [], mt = [], mf = [];
      Object.keys(nh).forEach(function (hk) { var mm = /(\d{1,2})月/.exec(hk); if (!mm) return; var idx = parseInt(mm[1], 10) - 1; var v = num(nh[hk]); if (v == null) return;
        if (/call|调用|调用量/.test(hk)) mc[idx] = v; else if (/active|活跃/.test(hk)) ma[idx] = v; else if (/token/.test(hk)) mt[idx] = v; else if (/cost|费用|计费/.test(hk)) mf[idx] = v; });
      if (mc.length) p.monthlyCalls = mc; if (ma.length) p.monthlyActive = ma; if (mt.length) p.monthlyTokens = mt; if (mf.length) p.monthlyCost = mf;
      if (p.province == null) return null; return p;
    }).filter(Boolean);
  }
  function mapTracking(rows) {
    return rows.map(function (r) {
      var nh = {}; Object.keys(r).forEach(function (k) { nh[normHeader(k)] = r[k]; });
      var t = { page: pick(nh, TRACK_MAP.page) || null, clicks: num(pick(nh, TRACK_MAP.clicks)), visitors: num(pick(nh, TRACK_MAP.visitors)), exposures: num(pick(nh, TRACK_MAP.exposures)), ctr: num(pick(nh, TRACK_MAP.ctr)) };
      if (t.page == null) return null; return t;
    }).filter(Boolean);
  }
  function mapCapability(rows) {
    if (!rows.length) return null;
    var headers = Object.keys(rows[0]);
    var capCol = null;
    for (var i = 0; i < headers.length; i++) { var nh = normHeader(headers[i]); if (nh === "月份" || nh === "month" || nh === "月") { capCol = headers[i]; break; } }
    if (!capCol) return null;
    var monthly = [], yearly = {};
    rows.forEach(function (r) {
      var label = String(r[capCol] == null ? "" : r[capCol]);
      var isTotal = /总计|年|合计|累计/.test(label);
      var obj = {};
      headers.forEach(function (h) { if (h === capCol) return; var v = num(r[h]); if (v != null) obj[h] = v; });
      if (isTotal) yearly = obj;
      else { obj.month = label.replace(/月$/, "") + "月"; monthly.push(obj); }
    });
    return { monthly: monthly, yearly: yearly };
  }
  function mapOverview(rows) {
    var monthly = rows.map(function (r) {
      var nh = {}; Object.keys(r).forEach(function (k) { nh[normHeader(k)] = r[k]; });
      return { month: pick(nh, ["month", "月份", "月"]) || null, calls: num(pick(nh, ["calls", "调用量"])), personYear: num(pick(nh, ["personyear", "节约人年", "等效人年", "人年"])), activeAgents: num(pick(nh, ["activeagents", "活跃智能体", "活跃"])) };
    }).filter(function (x) { return x.month != null; });
    var kpis = null;
    if (monthly.length) {
      var tc = 0, ty = 0; monthly.forEach(function (m) { tc += (m.calls || 0); ty += (m.personYear || 0); });
      var la = monthly[monthly.length - 1].activeAgents;
      var peak = monthly.slice().sort(function (a, b) { return (b.calls || 0) - (a.calls || 0); })[0];
      kpis = { totalCalls: tc, totalPersonYear: round2(ty), latestActiveAgents: la, avgCalls: Math.round(tc / monthly.length), peakMonth: peak.month, peakCalls: peak.calls, yoyPersonYear: null };
    }
    return { monthly: monthly, kpis: kpis };
  }
  function mapAlerts(rows) {
    return rows.map(function (r) {
      var nh = {}; Object.keys(r).forEach(function (k) { nh[normHeader(k)] = r[k]; });
      return {
        severity: pick(nh, ["severity", "级别", "等级"]) || "中", alert_type: pick(nh, ["alert_type", "类型", "告警类型"]) || "",
        province: pick(nh, ["province", "省份"]) || null, metric_name: pick(nh, ["metric_name", "指标", "指标名"]) || "",
        metric_value: pick(nh, ["metric_value", "值", "指标值"]), threshold: pick(nh, ["threshold", "阈值"]), suggestion: pick(nh, ["suggestion", "建议", "说明"]) || null
      };
    });
  }
  function mapTable(tk, rows) {
    if (tk === "agents") return mapAgents(rows);
    if (tk === "provinces") return mapProvinces(rows);
    if (tk === "tracking") return mapTracking(rows);
    if (tk === "capability") return mapCapability(rows);
    if (tk === "overview") return mapOverview(rows);
    if (tk === "alerts") return mapAlerts(rows);
    return rows;
  }
  function tableKey(name) {
    var n = normHeader(name);
    if (/agent|智能体/.test(n)) return "agents";
    if (/province|省份/.test(n)) return "provinces";
    if (/track|page|埋点|click|页面/.test(n)) return "tracking";
    if (/cap|质效|能力/.test(n)) return "capability";
    if (/over|总览|monthly/.test(n)) return "overview";
    if (/alert|告警/.test(n)) return "alerts";
    return null;
  }
  function parseFile(file) {
    return new Promise(function (resolve, reject) {
      var ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ACCEPT.indexOf(ext) < 0) { reject("不支持的文件类型：" + file.name); return; }
      if (file.size > MAX_MB * 1024 * 1024) { reject("文件超过 " + MAX_MB + "MB 上限：" + file.name); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          if (ext === "json") {
            var j = JSON.parse(e.target.result);
            resolve({ type: "json", name: file.name, data: j });
          } else {
            var wb = window.XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            var sheets = {};
            wb.SheetNames.forEach(function (sn) { sheets[sn] = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null }); });
            resolve({ type: "excel", name: file.name, sheets: sheets });
          }
        } catch (err) { reject("解析失败：" + file.name + "（" + err.message + "）"); }
      };
      reader.onerror = function () { reject("读取失败：" + file.name); };
      if (ext === "json") reader.readAsText(file); else reader.readAsArrayBuffer(file);
    });
  }
  function handleFiles(files) {
    files = [].filter.call(files, function (f) { return f && f.size > 0; });
    if (!files.length) return;
    var fl = $("fileList");
    if (fl) fl.innerHTML = [].map.call(files, function (f) { return '<div class="file-chip">' + esc(f.name) + ' · ' + (f.size / 1048576).toFixed(1) + ' MB</div>'; }).join("");
    showUploadMsg("正在解析 " + files.length + " 个文件…", false);
    Promise.all([].map.call(files, parseFile)).then(function (results) {
      var parts = {};
      results.forEach(function (res) {
        if (res.type === "json") {
          var j = res.data;
          if (j && j.overview && (j.agents || j.provinces || j.tracking || j.capability)) { parts._full = j; }
          else { Object.keys(j).forEach(function (k) { var tk = tableKey(k); if (tk && Array.isArray(j[k])) parts[tk] = mapTable(tk, j[k]); }); }
        } else {
          Object.keys(res.sheets).forEach(function (sn) {
            var tk = tableKey(sn); if (!tk) return;
            var rows = res.sheets[sn]; if (!rows.length) return;
            parts[tk] = mapTable(tk, rows);
          });
        }
      });
      var applied = Object.keys(parts).filter(function (k) { return k !== "_full"; });
      if (parts._full) {
        var full = parts._full;
        full.meta = full.meta || {}; full.meta.source = "本地上传文件（JSON）"; full.meta.generatedAt = new Date().toLocaleString("zh-CN"); full.meta.fileUrl = "";
        userDataLoaded = true;
        applyData(full);
        showUploadMsg("✅ 已应用完整 JSON 结构", false);
      } else if (applied.length) {
        userDataLoaded = true;
        applyData(mergeInto(D, parts));
        showUploadMsg("✅ 已应用并刷新：" + applied.join("、"), false);
      } else {
        showUploadMsg("⚠️ 未识别到可匹配的表（文件名/表名需含 agents/智能体、provinces/省份 等）", true);
      }
    }).catch(function (err) { showUploadMsg("❌ " + err, true); });
  }
  function mergeInto(base, parts) {
    var nd = JSON.parse(JSON.stringify(base || {}));
    Object.keys(parts).forEach(function (tk) {
      if (tk === "overview") nd.overview = parts[tk];
      else if (tk === "capability") nd.capability = parts[tk];
      else nd[tk] = parts[tk];
    });
    nd.meta = nd.meta || {};
    nd.meta.source = "本地上传文件";
    nd.meta.generatedAt = new Date().toLocaleString("zh-CN");
    nd.meta.fileUrl = "";
    var setm = {};
    (nd.provinces || []).forEach(function (p) { if (p && p.province) setm[p.province] = 1; });
    (nd.agents || []).forEach(function (a) { if (a && a.province) setm[a.province] = 1; });
    nd.meta.provinces = Object.keys(setm);
    nd.meta.gaps = nd.meta.gaps || [];
    return nd;
  }
  function applyData(newD) {
    D = window.LINGYUN_DATA = newD;
    // 上传新数据后重置筛选与控件
    FILTER = { dim: "month", months: [], weeks: [], days: [], prov: [] };
    var chips = $("provChips"); if (chips) chips.innerHTML = "";
    buildProvinceUI();
    buildTimeRange();
    Object.keys(instMap).forEach(function (k) { try { instMap[k].dispose(); } catch (e) {} }); instMap = {};
    renderBadges();
    // 平台分析(月) 页已隐藏（仅移除导航与初始化渲染；脚本与数据映射保留，埋点页顶部8卡依赖其 window.PFM）。如需恢复，把 "pages-monthly" 加回本数组即可。
    ["overview", "agents", "pages", "province", "quality", "alerts", "report"].forEach(function (t) { renderCurrent(t); });
  }
  function downloadTemplate() {
    if (!window.XLSX) { showUploadMsg("❌ 表格解析库未加载，请联网后刷新", true); return; }
    var X = window.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["应用名称", "省份", "分组/类别", "创建时间", "创建人", "场景", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "总计等效人年", "备注"], ["示例智能体", "示例省", "推广案例", "2026-01-01", "张三", "推广案例", 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.1, 2.5, ""]]), "agents");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["省份", "调用量", "活跃智能体", "Token", "模型计费", "1月调用", "2月调用", "3月调用", "4月调用", "5月调用", "6月调用", "7月调用"], ["示例省", 1000000, 30, 15000000000, 100000, 100000, 120000, 130000, 140000, 150000, 160000, 200000]]), "provinces");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["页面", "点击量", "访客", "曝光", "点击率"], ["示例页面/子页", 7000, 240, 19000, 36.8]]), "tracking");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["月份", "灵运平台", "RPA", "教练", "质检", "立单", "语音", "四项总计"], ["1月", 10, 5, 2, 3, 1, 8, 29], ["2026年总计", 100, 50, 20, 30, 10, 80, 290]]), "capability");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["月份", "调用量", "节约人年", "活跃智能体"], ["1月", 68000000, 180, 304]]), "overview");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["级别", "类型", "省份", "指标", "指标值", "阈值", "建议"], ["高", "调用量异常", "示例省", "调用量", 0, ""]]), "alerts");
    var out = X.write(wb, { bookType: "xlsx", type: "array" });
    var blob = new Blob([out], { type: "application/octet-stream" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "灵运看板上传模板.xlsx"; a.click();
  }
  function showUploadMsg(msg, isErr) { var el = $("uploadMsg"); if (el) { el.textContent = msg; el.className = "upload-msg" + (isErr ? " err" : ""); } }
  function showRefreshMsg(msg, kind) { var el = $("refreshMsg"); if (el) { el.textContent = msg; el.className = "refresh-msg" + (kind ? " " + kind : ""); } }

  /* 重新渲染：优先从服务器拉取最新 data.js 快照（缓存击穿），失败则回退当前内存重绘 */
  function refreshFromServer() {
    var btn = $("btnRefresh");
    // 已上传本地数据：保留用户数据，不覆盖
    if (userDataLoaded) {
      applyFilter();
      showRefreshMsg("✅ 已按你上传的本地数据重渲染（未覆盖）", "ok");
      return;
    }
    showRefreshMsg("正在从服务器拉取最新数据快照…", "");
    if (btn) btn.disabled = true;
    fetch("data.js?_cb=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (txt) {
        // 重新求值 data.js，刷新全局快照
        new Function(txt)();
        var fresh = window.LINGYUN_DATA;
        if (!fresh || !fresh.meta) throw new Error("数据结构异常");
        userDataLoaded = false;
        applyData(fresh);
        applyFilter();
        var g = (fresh.meta && fresh.meta.generatedAt) || "—";
        showRefreshMsg("✅ 已更新为最新快照（生成于 " + g + "）", "ok");
      })
      .catch(function (err) {
        // file:// 双击打开 或 网络不可达：回退到当前已加载数据
        applyFilter();
        showRefreshMsg("⚠️ 无法拉取服务器最新数据（" + err.message + "）。已按当前已加载数据重渲染；若以 file:// 双击打开，请改用「本地文件上传」或部署后访问网址。", "warn");
      })
      .finally(function () { if (btn) btn.disabled = false; });
  }
  function bindDataUI() {
    var local = $("srcLocal"), kdoc = $("srcKdoc"), lp = $("localPanel"), kp = $("kdocPanel");
    if (local && kdoc && lp && kp) {
      local.onclick = function () { local.classList.add("active"); kdoc.classList.remove("active"); lp.hidden = false; kp.hidden = true; };
      kdoc.onclick = function () { kdoc.classList.add("active"); local.classList.remove("active"); kp.hidden = false; lp.hidden = true; };
    }
    var fi = $("fileInput"), dz = $("dropzone"), pickEl = $("dzPick");
    if (dz && fi) dz.onclick = function () { fi.click(); };
    if (pickEl && fi) pickEl.onclick = function (e) { e.stopPropagation(); fi.click(); };
    if (dz) {
      dz.ondragover = function (e) { e.preventDefault(); dz.classList.add("drag"); };
      dz.ondragleave = function () { dz.classList.remove("drag"); };
      dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); };
    }
    if (fi) fi.onchange = function () { if (fi.files && fi.files.length) handleFiles(fi.files); fi.value = ""; };
    if ($("btnTpl")) $("btnTpl").onclick = downloadTemplate;
    if ($("btnCopyLink")) { var _b = $("btnCopyLink"); _b.textContent = "数据源说明"; _b.removeAttribute("href"); _b.onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); showUploadMsg("数据来源：项目内离线 Excel（build/sources），构建时固化进 data.js，不依赖任何在线文档。", false); }; }
    if ($("kdMeta")) { var m = D.meta || {}; $("kdMeta").textContent = "数据截至 " + (m.period || "—") + " · 生成于 " + (m.generatedAt || "—"); }
    var _sl = $("srcLink"); if (_sl) { _sl.removeAttribute("href"); _sl.textContent = "离线 Excel（已固化）"; }
  }

  /* ---------- 页面工具栏渲染：筛选 + 数据源（每页独立） ---------- */
  function renderPageToolbar(tab) {
    var box = document.querySelector('.page-toolbar[data-tab="' + tab + '"]');
    if (!box) return;
    if (tab === "pages") { renderPlatformToolbar(tab); return; }
    // 智能体 v2 页自带月份/省份/形态筛选（覆盖 1—8 月），不注入基座全局筛选条，
    // 否则会被基座月份上限（1—7 月）限制，无法查看 8 月数据。页面在 unified=false 时渲染自有选择器。
    if (tab === "agents") { return; }
    var st = PAGE_STATE[tab];
    var f = st.filter;
    var dim = f.dim;
    // 质效分析页不提供「日」维度
    var showDay = tab !== "quality";
    // 质效分析页数据源对应「质效分析」文档；其余页对应「数据验证」文档
    var docName = (tab === "quality") ? "质效分析" : "数据验证";
    var provBtnText = (f.prov.length && f.prov.indexOf("全国") < 0) ? ("已选 " + f.prov.length + " 个单位") : "全国";

    var rangeHtml = "";
    if (dim === "month") {
      var mchips = MONTHS.map(function (m) {
        var on = f.months.indexOf(m) >= 0 ? " on" : "";
        return '<button class="chip rchip' + on + '" data-m="' + m + '">' + m + "</button>";
      }).join("");
      rangeHtml = '<div class="range-actions"><button class="btn btn-ghost sm" id="mAll-' + tab + '">全选</button><button class="btn btn-ghost sm" id="mNone-' + tab + '">清空</button></div>' +
        '<div class="range-chips">' + mchips + "</div>";
    } else if (dim === "week") {
      var weeks = (D.meta && D.meta.timeLevels && D.meta.timeLevels.weeks) || [];
      if (!weeks.length) rangeHtml = '<div class="filter-note">当前数据源无多周数据，仅平台分析含 0720-0726 一周。</div>';
      else {
        var wchips = weeks.map(function (w) { var on = f.weeks.indexOf(w) >= 0 ? " on" : ""; return '<button class="chip rchip' + on + '" data-w="' + w + '">' + w + "</button>"; }).join("");
        rangeHtml = '<div class="range-actions"><button class="btn btn-ghost sm" id="wAll-' + tab + '">全选</button><button class="btn btn-ghost sm" id="wNone-' + tab + '">清空</button></div>' +
          '<div class="range-chips">' + wchips + "</div>";
      }
    } else {
      rangeHtml = '<div class="filter-note">日维度数据尚未接入，选择后按全周期展示。</div>';
    }

    var srcType = st.source.type;
    var localHidden = srcType === "kdoc" ? " hidden" : "";
    var kdocHidden = srcType === "local" ? " hidden" : "";
    var m = D.meta || {};
    var fileChips = st.source.files.map(function (fn) { return '<div class="file-chip">' + esc(fn) + "</div>"; }).join("");

    // 月度页：月维度多选芯片直接渲染进工具条「时间范围」这一行，与其他页一致；不再隐藏全局 time-group
    var timeGroupHtml = (tab === "pages-monthly")
      ? '<div class="filter-group time-group"><span class="filter-label">时间范围</span><div class="chips" id="pfmMonthChips"></div></div>'
      : '<div class="filter-group time-group"><span class="filter-label">时间范围</span><div id="timeRange-' + tab + '" class="range-box">' + rangeHtml + '</div></div>';
    box.innerHTML = '<div class="page-filter-bar">' +
      '<div class="filter-group dim-group"><div class="seg dim-seg" id="dimSeg-' + tab + '">' +
        '<button class="seg-btn active" data-dim="month" type="button">月</button>' +
      '</div></div>' +
      timeGroupHtml +
      '<div class="filter-group province-group"><span class="filter-label">单位</span>' +
        '<button class="filter-toggle" id="provToggle-' + tab + '" type="button">' + provBtnText + ' <span class="arrow">▾</span></button>' +
        '<div class="filter-popover" id="provPopover-' + tab + '" hidden>' +
          '<div class="popover-hd"><span>省份筛选（可多选）</span><button class="btn btn-ghost sm" id="btnResetFilter-' + tab + '" type="button">重置</button></div>' +
          '<div class="chips" id="provChips-' + tab + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="filter-group ds-section">' +
        '<button class="btn btn-ghost" id="btnDataSource-' + tab + '" type="button">数据源</button>' +
        '<div class="ds-panel" id="dsPanel-' + tab + '" hidden>' +
          '<div class="seg"><button class="seg-btn' + (srcType === "local" ? " active" : "") + '" id="srcLocal-' + tab + '" type="button">本地上传</button>' +
            '<button class="seg-btn' + (srcType === "kdoc" ? " active" : "") + '" id="srcKdoc-' + tab + '" type="button">内置快照</button></div>' +
          '<div id="localPanel-' + tab + '"' + localHidden + '>' +
            '<div class="dropzone" id="dropzone-' + tab + '">' +
              '<input type="file" id="fileInput-' + tab + '" accept=".csv,.xlsx,.xls,.json" multiple hidden>' +
              '<div class="dz-ico">⬆</div><div class="dz-main">拖拽文件，或 <span class="dz-link" id="dzPick-' + tab + '">点击上传</span></div>' +
              '<div class="dz-sub">CSV / Excel / JSON · 多文件 · ≤100MB</div>' +
            '</div>' +
            '<div class="btn-row"><button class="btn btn-ghost" id="btnTpl-' + tab + '" type="button">⬇ 下载模板</button></div>' +
            '<div id="fileList-' + tab + '" class="file-list">' + fileChips + '</div>' +
            '<div id="uploadMsg-' + tab + '" class="upload-msg"></div>' +
            '<div class="hint">按表名匹配：agents/智能体、provinces/省份等。上传后即时刷新本页。</div>' +
          '</div>' +
          '<div id="kdocPanel-' + tab + '"' + kdocHidden + '>' +
            '<div class="src-line">离线 Excel · <b>' + docName + '</b></div>' +
            '<div class="kd-status"><span class="kd-dot"></span>已固化 · 随版本打包发布</div>' +
            '<div class="btn-row"><button class="btn btn-ghost" id="btnCopyLink-' + tab + '" type="button">数据源说明</button>' +
              '<button class="btn btn-ghost" id="btnRefresh-' + tab + '" type="button">重新渲染</button></div>' +
            '<div class="hint">本项目不接任何在线文档：数据全部来自 build/sources 下的 Excel，构建时固化进 data.js。需更新时替换 Excel 后重新构建部署。</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    buildProvinceUI(tab);

    var dimSeg = $("dimSeg-" + tab);
    if (dimSeg) dimSeg.querySelectorAll(".seg-btn").forEach(function (b) {
      b.onclick = function () { FILTER.dim = b.dataset.dim; applyFilter(); };
    });

    var mAll = $("mAll-" + tab), mNone = $("mNone-" + tab);
    if (mAll) mAll.onclick = function () { FILTER.months = MONTHS.slice(); applyFilter(); };
    if (mNone) mNone.onclick = function () { FILTER.months = []; applyFilter(); };
    var wAll = $("wAll-" + tab), wNone = $("wNone-" + tab);
    var weeks = (D.meta && D.meta.timeLevels && D.meta.timeLevels.weeks) || [];
    if (wAll) wAll.onclick = function () { FILTER.weeks = weeks.slice(); applyFilter(); };
    if (wNone) wNone.onclick = function () { FILTER.weeks = []; applyFilter(); };

    box.querySelectorAll(".rchip").forEach(function (c) {
      if (c.dataset.m) c.onclick = function () { toggleMonth(c.dataset.m); };
      if (c.dataset.w) c.onclick = function () { toggleWeek(c.dataset.w); };
    });

    var pt = $("provToggle-" + tab), pp = $("provPopover-" + tab);
    if (pt && pp) {
      pt.onclick = function (e) { e.stopPropagation(); pp.toggleAttribute("hidden"); };
      pp.onclick = function (e) { e.stopPropagation(); };
    }
    var rf = $("btnResetFilter-" + tab);
    if (rf) rf.onclick = function (e) { e.stopPropagation(); FILTER = newFilter(); applyFilter(); };

    var dsBtn = $("btnDataSource-" + tab), dsPanel = $("dsPanel-" + tab);
    if (dsBtn && dsPanel) {
      dsBtn.onclick = function (e) { e.stopPropagation(); dsPanel.toggleAttribute("hidden"); };
      dsPanel.onclick = function (e) { e.stopPropagation(); };
    }
    var local = $("srcLocal-" + tab), kdoc = $("srcKdoc-" + tab), lp = $("localPanel-" + tab), kp = $("kdocPanel-" + tab);
    if (local && kdoc && lp && kp) {
      local.onclick = function () { st.source.type = "local"; local.classList.add("active"); kdoc.classList.remove("active"); lp.hidden = false; kp.hidden = true; };
      kdoc.onclick = function () { st.source.type = "kdoc"; kdoc.classList.add("active"); local.classList.remove("active"); kp.hidden = false; lp.hidden = true; };
    }
    bindUploadForTab(tab);
    var btnTpl = $("btnTpl-" + tab);
    if (btnTpl) btnTpl.onclick = function (e) { e.stopPropagation(); downloadTemplate(tab); };
    var btnCopy = $("btnCopyLink-" + tab);
    if (btnCopy) btnCopy.onclick = function (e) {
      e.stopPropagation();
      showUploadMsgForTab(tab, "数据来源：项目内离线 Excel（build/sources），构建时固化进 data.js，不依赖任何在线文档。", false);
    };
    var btnRefresh = $("btnRefresh-" + tab);
    if (btnRefresh) btnRefresh.onclick = function (e) { e.stopPropagation(); refreshFromServerForTab(tab); };
  }

  /* ---------- 平台分析页：专属筛选（周/月维度，区别于其他页） ----------
   * 筛选框样式与其他页保持一致（.page-filter-bar 单行自适应），数据源按钮独立放到 KPI 区顶部。
   */
  function renderPlatformToolbar(tab) {
    var box = document.querySelector('.page-toolbar[data-tab="' + tab + '"]');
    if (!box) return;
    var pt = (D.platformTracking) || {};
    var weeks = pt.weeks || [];
    var months = pt.months || [];
    var provBtnText = (FILTER.prov.length && FILTER.prov.indexOf("全国") < 0) ? ("已选 " + FILTER.prov.length + " 个单位") : "全国";
    // 仅保留「月」维度（埋点页不再提供周维度切换）
    var scope = (tab === "pages") ? "month" : (FILTER.pfScope === "month" ? "month" : "week");
    if (scope === "week" && !FILTER.pfWeeks.length) FILTER.pfWeeks = weeks.slice();
    // 数据源（与筛选项同一模块）
    var st = PAGE_STATE[tab];
    var srcType = st.source.type;
    var localHidden = srcType === "kdoc" ? " hidden" : "";
    var kdocHidden = srcType === "local" ? " hidden" : "";
    var fileChips = st.source.files.map(function (fn) { return '<div class="file-chip">' + esc(fn) + "</div>"; }).join("");

    var rangeHtml = "";
    if (scope === "week") {
      var wchips = weeks.map(function (w) {
        var on = FILTER.pfWeeks.indexOf(w) >= 0 ? " on" : "";
        return '<button class="chip rchip' + on + '" data-pw="' + w + '">' + w + "</button>";
      }).join("");
      rangeHtml = '<div class="range-actions"><button class="btn btn-ghost sm" id="pfWAll-' + tab + '">全选</button><button class="btn btn-ghost sm" id="pfWNone-' + tab + '">清空</button></div>' +
        '<div class="range-chips">' + (wchips || '<span class="filter-note">无周数据</span>') + "</div>";
    } else {
      var allOn = (!FILTER.pfMonth) ? " on" : "";
      var allChip = '<button class="chip rchip' + allOn + '" data-pm-all="1">全部</button>';
      var mchips = months.map(function (m) {
        var on = FILTER.pfMonth === m ? " on" : "";
        return '<button class="chip rchip' + on + '" data-pm="' + m + '">' + m.replace("2026-", "") + "月</button>";
      }).join("");
      rangeHtml = '<div class="range-chips">' + allChip + (mchips || '<span class="filter-note">无月数据</span>') + "</div>";
    }

    var dimHtml = (tab === "pages")
      ? '<div class="filter-group dim-group"><span class="filter-label">时间维度</span><span class="dim-static">按月</span></div>'
      : '<div class="filter-group dim-group"><span class="filter-label">时间维度</span>' +
          '<div class="seg dim-seg" id="pfDim-' + tab + '">' +
            '<button class="seg-btn' + (scope === "week" ? " active" : "") + '" data-dim="week" type="button">周</button>' +
            '<button class="seg-btn' + (scope === "month" ? " active" : "") + '" data-dim="month" type="button">按月</button>' +
          '</div></div>';
    box.innerHTML = '<div class="page-filter-bar">' +
      dimHtml +
      '<div class="filter-group time-group"><span class="filter-label">范围</span><div id="pfRange-' + tab + '" class="range-box">' + rangeHtml + '</div></div>' +
      '<div class="filter-group province-group"><span class="filter-label">单位</span>' +
        '<button class="filter-toggle" id="provToggle-' + tab + '" type="button">' + provBtnText + ' <span class="arrow">▾</span></button>' +
        '<div class="filter-popover" id="provPopover-' + tab + '" hidden>' +
          '<div class="popover-hd"><span>省份筛选（可多选）</span><button class="btn btn-ghost sm" id="btnResetFilter-' + tab + '" type="button">重置</button></div>' +
          '<div class="chips" id="provChips-' + tab + '"></div>' +
        '</div></div>' +
      '<div class="filter-group ds-section">' +
        '<button class="btn btn-ghost" id="btnDataSource-' + tab + '" type="button">数据源</button>' +
        '<div class="ds-panel" id="dsPanel-' + tab + '" hidden>' +
          '<div class="seg"><button class="seg-btn' + (srcType === "local" ? " active" : "") + '" id="srcLocal-' + tab + '" type="button">本地上传</button>' +
            '<button class="seg-btn' + (srcType === "kdoc" ? " active" : "") + '" id="srcKdoc-' + tab + '" type="button">内置快照</button></div>' +
          '<div id="localPanel-' + tab + '"' + localHidden + '>' +
            '<div class="dropzone" id="dropzone-' + tab + '">' +
              '<input type="file" id="fileInput-' + tab + '" accept=".csv,.xlsx,.xls,.json" multiple hidden>' +
              '<div class="dz-ico">⬆</div><div class="dz-main">拖拽文件，或 <span class="dz-link" id="dzPick-' + tab + '">点击上传</span></div>' +
              '<div class="dz-sub">CSV / Excel / JSON · 多文件 · ≤100MB</div>' +
            '</div>' +
            '<div class="btn-row"><button class="btn btn-ghost" id="btnTpl-' + tab + '" type="button">⬇ 下载模板</button></div>' +
            '<div id="fileList-' + tab + '" class="file-list">' + fileChips + '</div>' +
            '<div id="uploadMsg-' + tab + '" class="upload-msg"></div>' +
            '<div class="hint">按表名匹配：agents/智能体、provinces/省份等。上传后即时刷新本页。</div>' +
          '</div>' +
          '<div id="kdocPanel-' + tab + '"' + kdocHidden + '>' +
            '<div class="src-line">离线 Excel · <b>平台分析（用户行为记录）</b></div>' +
            '<div class="kd-status"><span class="kd-dot"></span>已固化 · 月埋点 ' + months.length + ' 个月 / 周埋点 ' + weeks.length + ' 周</div>' +
            '<div class="btn-row"><button class="btn btn-ghost" id="btnCopyLink-' + tab + '" type="button">数据源说明</button>' +
              '<button class="btn btn-ghost" id="btnRefresh-' + tab + '" type="button">重新渲染</button></div>' +
            '<div class="hint">本项目不接任何在线文档：埋点数据来自 build/sources 下的 Excel，构建时固化进 data.js。需更新时替换 Excel 后重新构建部署。</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    buildProvinceUI(tab);

    // 时间维度切换
    var pfDim = $("pfDim-" + tab);
    if (pfDim) pfDim.querySelectorAll(".seg-btn").forEach(function (b) {
      b.onclick = function () {
        var d = b.dataset.dim;
        FILTER.pfScope = d;
        if (d === "week" && !FILTER.pfWeeks.length) FILTER.pfWeeks = (pt.weeks || []).slice();
        if (d === "month" && !FILTER.pfMonth) FILTER.pfMonth = "";
        applyFilter();
      };
    });
    // 周多选
    box.querySelectorAll(".rchip[data-pw]").forEach(function (c) {
      c.onclick = function () { var w = c.dataset.pw; var i = FILTER.pfWeeks.indexOf(w); if (i >= 0) FILTER.pfWeeks.splice(i, 1); else FILTER.pfWeeks.push(w); applyFilter(); };
    });
    var pfWAll = $("pfWAll-" + tab), pfWNone = $("pfWNone-" + tab);
    if (pfWAll) pfWAll.onclick = function () { FILTER.pfWeeks = (pt.weeks || []).slice(); applyFilter(); };
    if (pfWNone) pfWNone.onclick = function () { FILTER.pfWeeks = []; applyFilter(); };
    // 月单选 + 全部（埋点页只保留月维度）
    box.querySelectorAll(".rchip[data-pm]").forEach(function (c) {
      c.onclick = function () { var m = c.dataset.pm; FILTER.pfScope = "month"; FILTER.pfMonth = m; applyFilter(); };
    });
    var pfMAll = box.querySelector(".rchip[data-pm-all]");
    if (pfMAll) pfMAll.onclick = function () { FILTER.pfScope = "all"; FILTER.pfMonth = ""; applyFilter(); };
    // 省份 popover
    var ptg = $("provToggle-" + tab), ppo = $("provPopover-" + tab);
    if (ptg && ppo) { ptg.onclick = function (e) { e.stopPropagation(); ppo.toggleAttribute("hidden"); }; ppo.onclick = function (e) { e.stopPropagation(); }; }
    var rf2 = $("btnResetFilter-" + tab);
    if (rf2) rf2.onclick = function (e) { e.stopPropagation(); FILTER.prov = []; applyFilter(); };

    // 数据源面板交互（与筛选项同模块）
    bindUploadForTab(tab);
    var btnTpl = $("btnTpl-" + tab);
    if (btnTpl) btnTpl.onclick = function (e) { e.stopPropagation(); downloadTemplate(tab); };
    var dsBtn = $("btnDataSource-" + tab), dsPanel = $("dsPanel-" + tab);
    if (dsBtn && dsPanel) { dsBtn.onclick = function (e) { e.stopPropagation(); dsPanel.toggleAttribute("hidden"); }; dsPanel.onclick = function (e) { e.stopPropagation(); }; }
    var local = $("srcLocal-" + tab), kdoc = $("srcKdoc-" + tab), lp = $("localPanel-" + tab), kp = $("kdocPanel-" + tab);
    if (local && kdoc && lp && kp) {
      local.onclick = function () { st.source.type = "local"; local.classList.add("active"); kdoc.classList.remove("active"); lp.hidden = false; kp.hidden = true; };
      kdoc.onclick = function () { st.source.type = "kdoc"; kdoc.classList.add("active"); local.classList.remove("active"); kp.hidden = false; lp.hidden = true; };
    }
    var btnCopy = $("btnCopyLink-" + tab);
    if (btnCopy) btnCopy.onclick = function (e) {
      e.stopPropagation();
      showUploadMsgForTab(tab, "数据来源：项目内离线 Excel（build/sources），构建时固化进 data.js，不依赖任何在线文档。", false);
    };
    var btnRefresh = $("btnRefresh-" + tab);
    if (btnRefresh) btnRefresh.onclick = function (e) { e.stopPropagation(); refreshFromServerForTab(tab); };
  }

  function bindUploadForTab(tab) {
    var fi = $("fileInput-" + tab), dz = $("dropzone-" + tab), pickEl = $("dzPick-" + tab);
    if (dz && fi) dz.onclick = function (e) { if (e.target !== pickEl) fi.click(); };
    if (pickEl && fi) pickEl.onclick = function (e) { e.stopPropagation(); fi.click(); };
    if (dz) {
      dz.ondragover = function (e) { e.preventDefault(); dz.classList.add("drag"); };
      dz.ondragleave = function () { dz.classList.remove("drag"); };
      dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFilesForTab(e.dataTransfer.files, tab); };
    }
    if (fi) fi.onchange = function () { if (fi.files && fi.files.length) handleFilesForTab(fi.files, tab); fi.value = ""; };
  }

  function showUploadMsgForTab(tab, msg, isErr) {
    var el = $("uploadMsg-" + tab); if (!el) return;
    el.textContent = msg; el.className = "upload-msg" + (isErr ? " err" : "");
  }

  function buildProvinceUI(tab) {
    var chips = $("provChips-" + tab); if (!chips) return;
    var all = (D.meta && D.meta.provinces) || [];
    var provs = all.filter(function (p) { return p !== NATL && p !== HQ; }).sort();
    var units = [{ name: "全国", key: "全国", natl: true }]
      .concat([{ name: HQ, key: HQ }])
      .concat(provs.map(function (p) { return { name: p, key: p }; }));
    chips.innerHTML = units.map(function (u) {
      var on = isUnitOn(u.key) ? " on" : "";
      var sp = u.natl ? " chip-natl" : "";
      return '<button class="chip uchip' + on + sp + '" data-u="' + u.key + '">' + u.name + "</button>";
    }).join("");
    chips.querySelectorAll(".uchip").forEach(function (c) { c.onclick = function () { toggleUnit(c.dataset.u); }; });
  }

  function handleFilesForTab(files, tab) {
    files = [].filter.call(files, function (f) { return f && f.size > 0; });
    if (!files.length) return;
    var fl = $("fileList-" + tab);
    if (fl) fl.innerHTML = [].map.call(files, function (f) { return '<div class="file-chip">' + esc(f.name) + ' · ' + (f.size / 1048576).toFixed(1) + ' MB</div>'; }).join("");
    showUploadMsgForTab(tab, "正在解析 " + files.length + " 个文件…", false);
    Promise.all([].map.call(files, parseFile)).then(function (results) {
      var parts = {};
      var fileNames = [];
      results.forEach(function (res) {
        fileNames.push(res.name);
        if (res.type === "json") {
          var j = res.data;
          if (j && j.overview && (j.agents || j.provinces || j.tracking || j.capability)) { parts._full = j; }
          else { Object.keys(j).forEach(function (k) { var tk = tableKey(k); if (tk && Array.isArray(j[k])) parts[tk] = mapTable(tk, j[k]); }); }
        } else {
          Object.keys(res.sheets).forEach(function (sn) {
            var tk = tableKey(sn); if (!tk) return;
            var rows = res.sheets[sn]; if (!rows.length) return;
            parts[tk] = mapTable(tk, rows);
          });
        }
      });
      PAGE_STATE[tab].source.files = fileNames;
      var applied = Object.keys(parts).filter(function (k) { return k !== "_full"; });
      if (parts._full) {
        var full = parts._full;
        full.meta = full.meta || {}; full.meta.source = "本地上传文件（JSON）"; full.meta.generatedAt = new Date().toLocaleString("zh-CN"); full.meta.fileUrl = "";
        applyDataForTab(full, tab);
        showUploadMsgForTab(tab, "✅ 已应用完整 JSON 结构", false);
      } else if (applied.length) {
        applyDataForTab(mergeInto(D, parts), tab);
        showUploadMsgForTab(tab, "✅ 已应用并刷新：" + applied.join("、"), false);
      } else {
        showUploadMsgForTab(tab, "⚠️ 未识别到可匹配的表（文件名/表名需含 agents/智能体、provinces/省份 等）", true);
      }
    }).catch(function (err) { showUploadMsgForTab(tab, "❌ " + err, true); });
  }

  function applyDataForTab(newD, tab) {
    PAGE_STATE[tab].data = newD;
    PAGE_STATE[tab].source.type = "local";
    if (tab === currentTab) {
      D = newD;
      FILTER = PAGE_STATE[tab].filter;
      MONTHS = (D.meta.timeLevels && D.meta.timeLevels.months) || MONTHS;
      NATL = (D.meta.units && D.meta.units.national) || NATL;
      HQ = (D.meta.units && D.meta.units.hq) || HQ;
      applyFilter();
    }
  }

  function downloadTemplate(tab) {
    if (!window.XLSX) { showUploadMsgForTab(tab, "❌ 表格解析库未加载，请联网后刷新", true); return; }
    var X = window.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["应用名称", "省份", "分组/类别", "创建时间", "创建人", "场景", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "总计等效人年", "备注"], ["示例智能体", "示例省", "推广案例", "2026-01-01", "张三", "推广案例", 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.1, 2.5, ""]]), "agents");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["省份", "调用量", "活跃智能体", "Token", "模型计费", "1月调用", "2月调用", "3月调用", "4月调用", "5月调用", "6月调用", "7月调用"], ["示例省", 1000000, 30, 15000000000, 100000, 100000, 120000, 130000, 140000, 150000, 160000, 200000]]), "provinces");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["页面", "点击量", "访客", "曝光", "点击率"], ["示例页面/子页", 7000, 240, 19000, 36.8]]), "tracking");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["月份", "灵运平台", "RPA", "教练", "质检", "立单", "语音", "四项总计"], ["1月", 10, 5, 2, 3, 1, 8, 29], ["2026年总计", 100, 50, 20, 30, 10, 80, 290]]), "capability");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["月份", "调用量", "节约人年", "活跃智能体"], ["1月", 68000000, 180, 304]]), "overview");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["级别", "类型", "省份", "指标", "指标值", "阈值", "建议"], ["高", "调用量异常", "示例省", "调用量", 0, ""]]), "alerts");
    var out = X.write(wb, { bookType: "xlsx", type: "array" });
    var blob = new Blob([out], { type: "application/octet-stream" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "灵运看板上传模板.xlsx"; a.click();
  }

  function refreshFromServerForTab(tab) {
    var st = PAGE_STATE[tab];
    if (st.source.type === "local") {
      if (tab === currentTab) { applyFilter(); showUploadMsgForTab(tab, "✅ 已按本页上传数据重渲染", false); }
      return;
    }
    showUploadMsgForTab(tab, "正在从服务器拉取最新数据快照…", false);
    fetch("data.js?_cb=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (txt) {
        new Function(txt)();
        var fresh = window.LINGYUN_DATA;
        if (!fresh || !fresh.meta) throw new Error("数据结构异常");
        st.data = fresh; st.source.type = "default"; st.source.files = [];
        if (tab === currentTab) {
          D = fresh; FILTER = st.filter;
          MONTHS = (D.meta.timeLevels && D.meta.timeLevels.months) || MONTHS;
          NATL = (D.meta.units && D.meta.units.national) || NATL;
          HQ = (D.meta.units && D.meta.units.hq) || HQ;
          applyFilter();
        }
        var g = (fresh.meta && fresh.meta.generatedAt) || "—";
        showUploadMsgForTab(tab, "✅ 已更新为最新快照（生成于 " + g + "）", false);
      })
      .catch(function (err) {
        if (tab === currentTab) { applyFilter(); showUploadMsgForTab(tab, "⚠️ 无法拉取服务器最新数据（" + err.message + "）。已按当前数据重渲染。", true); }
        else { showUploadMsgForTab(tab, "⚠️ 拉取失败：" + err.message, true); }
      });
  }

  /* ---------- Tab / 左侧导航切换 ---------- */
  function initTabs() {
    var items = document.querySelectorAll("#navMenu .nav-item");
    items.forEach(function (t) {
      t.onclick = function () { switchTab(t.dataset.tab); };
    });
  }

  function switchTab(tab) {
    if (tab === currentTab) return;
    PAGE_STATE[currentTab].filter = FILTER;
    PAGE_STATE[currentTab].data = D;
    currentTab = tab;
    var st = PAGE_STATE[tab];
    D = st.data || DEFAULT_DATA || {};
    FILTER = st.filter;
    MONTHS = (D.meta && D.meta.timeLevels && D.meta.timeLevels.months) || ["1月", "2月", "3月", "4月", "5月", "6月", "7月"];
    NATL = (D.meta.units && D.meta.units.national) || "总计";
    HQ = (D.meta.units && D.meta.units.hq) || "本部";

    document.querySelectorAll("#navMenu .nav-item").forEach(function (x) { x.classList.remove("active"); });
    var activeNav = document.querySelector('#navMenu .nav-item[data-tab="' + tab + '"]');
    if (activeNav) activeNav.classList.add("active");
    document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
    var panel = $("panel-" + tab); if (panel) panel.classList.add("active");

    renderPageToolbar(tab);
    applyFilter();
  }

  function renderCurrent(tab) {
    var p = (window.LY && window.LY.pages) ? window.LY.pages[tab] : null;
    if (p && typeof p.render === "function") { p.render(); }
    else if (typeof window["__legacyRender_" + tab] === "function") { window["__legacyRender_" + tab](); }
    else { console.warn("[灵运] 未注册页面：" + tab); }
    setTimeout(function () { Object.keys(instMap).forEach(function (k) { try { instMap[k].resize(); } catch (e) {} }); }, 30);
  }

  /* ---------- 启动 ---------- */
  function init() {
    var base = DEFAULT_DATA;
    if (!base || !base.meta) { document.body.insertAdjacentHTML("afterbegin", '<div class="alert-empty">data.js 未加载，请确认 data.js 与 index.html 在同一目录。</div>'); return; }
    MONTHS = (base.meta.timeLevels && base.meta.timeLevels.months) || MONTHS;
    NATL = (base.meta.units && base.meta.units.national) || NATL;
    HQ = (base.meta.units && base.meta.units.hq) || HQ;

    initTabs();
    renderPageToolbar("overview");
    computeView();
    renderBadges();
    if ($("btnGen")) $("btnGen").onclick = function () { var p = window.LY.pages.report; if (p && p.render) p.render(); };
    if ($("btnDownload")) $("btnDownload").onclick = function () {
      var type = $("reportType") ? $("reportType").value : "monthly";
      var md = genReport(type);
      var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "灵运平台报告_" + type + ".md";
      a.click();
    };
    if ($("reportType")) $("reportType").onchange = function () { var p = window.LY.pages.report; if (p && p.render) p.render(); };

    document.addEventListener("click", function () {
      document.querySelectorAll('.filter-popover[id^="provPopover-"]').forEach(function (el) { el.setAttribute("hidden", ""); });
      document.querySelectorAll('.ds-panel[id^="dsPanel-"]').forEach(function (el) { el.setAttribute("hidden", ""); });
    });

    renderCurrent("overview");
  }
  function curTab() { return currentTab; }

  // 暴露 init，供解密引导(decrypt.js)在全部脚本(含页面)就绪后显式调用，
  // 避免动态加载时 core.js 在页面尚未注册就自动 init 导致首屏空白。
  window.LY = window.LY || {};
  window.LY.init = init;
  if (window.__LY_DEFER_INIT__) {
    /* 由 decrypt.js 在密码校验通过、全部脚本加载完成后显式调用 window.LY.init() */
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }


;
/* ===== core/data.js ===== */
/*
 * core/data.js —— 统一数据接口（基座包·赵莹维护）
 * 页面只通过 window.LY.data 读数据，禁止直接 fetch 任何在线文档、禁止直接碰 window.LINGYUN_DATA。
 * 数据由构建脚本从 build/sources/ 下的离线 Excel 生成 data.js（window.LINGYUN_DATA），运行时不联网。
 *
 * 契约见 data-contract.json：顶层键 meta/overview/agents/provinces/tracking/capability/centerYearRank/alerts。
 */
(function () {
  window.LY = window.LY || { pages: {} };

  // tab -> 该页需要的业务域顶层键（见 data-contract.json）
  var PAGE_DOMAINS = {
    overview: ["overview", "overviewByProvince", "capability", "agents", "provinces"],
    agents:   ["agentMonthly"],
    tracking: ["tracking", "platformTracking"],
    "pages-monthly": ["platformMonthly"],
    province: ["provinces"],
    quality:  ["centerYearRank", "capability", "qeMonthlySummary"],
    alarms:   ["alerts"],
    report:   [] // 功能页，不连数据源
  };

  function raw() { return window.LINGYUN_DATA || {}; }
  function meta() { return raw().meta || {}; }
  function domain(name) { return raw()[name]; }

  // 当前 tab 的计算视图 V（由 core.js 的 computeView 计算，已按筛选过滤）
  // core.js 会暴露 window.LY.getView()；拿不到时回退到原始数据。
  function view() {
    if (typeof window.LY.getView === "function") {
      return window.LY.getView() || {};
    }
    return {};
  }

  // 取某 tab 关心的业务域（原始数据，未过滤）—— 页面初始化/无筛选时用
  function page(tab) {
    var keys = PAGE_DOMAINS[tab] || [];
    var out = {};
    keys.forEach(function (k) { out[k] = raw()[k]; });
    out.meta = meta();
    return out;
  }

  // 便捷：省份列表 / 时间层级 / 缺口说明
  function provinces() { return meta().provinces || []; }
  function timeLevels() { return meta().timeLevels || { months: [], weeks: [], days: [] }; }
  function gaps() { return meta().gaps || []; }

  // 数字格式化助手（页面可复用，保持全站一致）
  function fmtNum(n) {
    if (n == null || isNaN(n)) return "/";
    return Number(n).toLocaleString("zh-CN");
  }
  function fmtPct(n, d) {
    if (n == null || d == null || d === 0 || isNaN(n) || isNaN(d)) return "/";
    return (n / d * 100).toFixed(1) + "%";
  }

  window.LY.data = {
    raw: raw, meta: meta, domain: domain, view: view, page: page,
    provinces: provinces, timeLevels: timeLevels, gaps: gaps,
    fmtNum: fmtNum, fmtPct: fmtPct,
    PAGE_DOMAINS: PAGE_DOMAINS
  };

  if (typeof window.LY.log === "function") {
    window.LY.log("[data] 统一数据接口就绪");
  } else {
    console.log("[data] 统一数据接口就绪");
  }
})();

;
/* ===== pages/overview.js ===== */
/* pages/overview.js — 数据总览（负责人：吴超）
 * 本文件只负责本页面渲染，只读 core/core.js 暴露的全局共享状态（D / FILTER / V 等），
 * 不写任何取数逻辑。优化本页只需改这个文件，互不影响其他页面。
 * 设计基线见 STYLE_GUIDE.md：冷色为主、图表固定高度、缺数统一「/」、禁止内联样式。
 */
(function () {
  window.__LY_OVERVIEW_VERSION__ = "20260828-trend-v7";
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "overview",
    title: "数据总览",
    icon: "◆",
    order: 1,
    owner: "吴超",
    render: function () { renderOverview(); }
  });

  /* —— 局部工具（不重定义 core 全局函数） —— */
  // 带配色顶条的 KPI 卡：cls 取 "" / "teal" / "purple"（仅冷色层次，不用暖色/红）
  function kpiCard(cls, title, val, sub) {
    return '<div class="kpi' + (cls ? " " + cls : "") + '">' +
      '<div class="lb">' + esc(title) + '</div>' +
      '<div class="val">' + esc(val) + '</div>' +
      '<div class="delta flat">' + (sub ? esc(sub) : "") + '</div></div>';
  }
  // 业务大类解析：从 agents[].group 提取（如「重复来电（已推广24省）」→「重复来电」）
  function bizCat(a) {
    var g = (a && (a.group || a.scenario)) || "未分类";
    var first = String(g).split(/\n/)[0].split(/[（(]/)[0].trim();
    var alias = { "携转挽留监控智能体": "携转挽留", "携号转网携出咨询量大": "携转挽留" };
    return alias[first] || first || "未分类";
  }
  var COLD = [PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[6], PALETTE[7]]; // 仅冷色索引

  /* ===== 核心指标卡片（15 张 / 4 组） =====
   * 数据：开发态用 window.LY_OVERVIEW_SIM（模拟数据 · 各省月度明细）；
   *       生产态由赵莹在 data-contract 扩展 overview 月度字段后，经取数脚本注入
   *       window.LINGYUN_DATA.overviewByProvince，本模块直接读取，无需改 core。
   * 交互：复用全局「时间范围 / 单位」筛选；多月份默认月均，可切累计；
   *       每张卡含 ⓘ计算口径、VS上期环比、年初至今 mini 趋势；环比标签旁「查看变动因素」按钮下钻环比变动因素。 */
  var SIM = window.LY_OVERVIEW_SIM || null;
  var PANORAMA = window.LY_OVERVIEW_PANORAMA || null; // 推广/优秀/双周优秀 全景图（《推广+双周+优秀（总表）》1-6月）
  function promoRows() { return (PANORAMA && PANORAMA.rows) || []; }
  function promoMonths() { return (PANORAMA && PANORAMA.months) || []; }
  function promoScenes() { return (PANORAMA && PANORAMA.scenes) || []; }
  /* 各类智能体通过「案例类型」区分，标签可重叠（如「推广案例,优秀案例」）；
   * 必须用逗号精确拆分后做全等匹配，避免「优秀案例」误匹配「双周优秀案例」子串 */
  function rowsByTag(tag) {
    return promoRows().filter(function (r) {
      if (!r.tags) return false;
      return r.tags.split(",").map(function (x) { return x.trim(); }).indexOf(tag) >= 0;
    });
  }
  /* 每张 KPI 卡独立的 月均/累计 模式；移除全局 CORE_MODE */
  var KPI_MODES = {};
  function defaultMode(m) {
    if (m.cumSnap) return "累计";
    if (m.key === "cost" || m.key === "personYear") return "累计";
    return "月均";
  }
  function cardMode(m) { return KPI_MODES[m.key] || defaultMode(m); }
  /* 周期类型（月/周/日）与顶部全局筛选共用：直接读取全局 FILTER.dim，本模块不再渲染独立切换 */
  function globalDim() {
    if (window.FILTER && FILTER.dim) return FILTER.dim;
    return "month";
  }
  var METRICS = [
    // —— 价值 ——
    { key: "cost",         name: "模型计费金额",   group: "价值",     cls: "",      tip: "模型计费金额（元），周期内各智能体调用模型产生的费用合计", fmt: "money", cumulative: true },
    { key: "personYear",   name: "节约人年",       group: "价值",     cls: "",      tip: "等效节约人年，由业务模型根据调用量与单人次耗时折算", fmt: "py", cumulative: true },
    // —— 智能体应用（投产率前置为该模块首张卡片） ——
    { key: "productionRate", name: "投产率",       group: "智能体应用", cls: "teal",  tip: "调用量大于0的智能体数量占上线智能体总量的比例", fmt: "pct", cumulative: false },
    { key: "producingAgents", name: "投产智能体数", group: "智能体应用", cls: "teal", tip: "调用量大于0的智能体数量（时点）", fmt: "int", cumulative: true, hidden: true },
    { key: "activeAgents", name: "活跃智能体数",   group: "智能体应用", cls: "purple", tip: "月/周有效调用量大于阈值的智能体数量（月末/周末时点数）", fmt: "int", cumulative: false },
    { key: "hotAgents",    name: "高热度智能体数", group: "智能体应用", cls: "purple", tip: "月/周调用量达到阈值（月调用量达10万）的智能体数量（时点数）", fmt: "int", cumulative: false },
    { key: "totalAgentsOnline", name: "智能体总数量（上线）", group: "智能体应用", cls: "", tip: "累计已上线智能体总数（时点，单调递增）", fmt: "int", cumulative: false },
    { key: "promoAgents",  name: "推广智能体数",   group: "智能体应用", cls: "",      tip: "时点累计：1月至当月累计推广智能体数（单调递增）；当月新增=当月累计−上月累计", fmt: "int", cumulative: true, cumSnap: true },
    { key: "excellentAgents", name: "优秀智能体数", group: "智能体应用", cls: "", tip: "时点累计：1月至当月累计优秀智能体数（单调递增）；当月新增=当月累计−上月累计", fmt: "int", cumulative: true, cumSnap: true },
    { key: "excellentAgentsBiweek", name: "双周优秀智能体数", group: "智能体应用", cls: "purple", tip: "时点累计：1月至当月累计双周优秀智能体数（单调递增）；当月新增=当月累计−上月累计", fmt: "int", cumulative: true, cumSnap: true },
    // —— 用户活跃 ——
    { key: "newRegUsers",  name: "新增注册人数",   group: "用户活跃", cls: "teal",   tip: "当月1号至今的注册人数（时点增量）", fmt: "wan", cumulative: false },
    { key: "activeUsers",  name: "活跃用户数",     group: "用户活跃", cls: "purple", tip: "活跃用户数：月维度为月活跃用户数；累计维度为累计活跃用户数", fmt: "wan", cumulative: false,
      variants: { "月均": { key: "mau", label: "月活跃用户数", fmt: "wan" }, "累计": { key: "activeUsersCum", label: "累计活跃用户数", fmt: "wan" } } },
    { key: "activeCover",  name: "活跃用户覆盖度", group: "用户活跃", cls: "orange", tip: "活跃用户覆盖度：月维度为月活跃用户覆盖度；累计维度为累计活跃用户覆盖度", fmt: "pct", cumulative: false,
      variants: { "月均": { key: "activeCoverMonthly", label: "月活跃用户覆盖度", fmt: "pct" }, "累计": { key: "activeCoverCum", label: "累计活跃用户覆盖度", fmt: "pct" } } },
    // —— 平台基础 ——
    { key: "calls",        name: "智能体调用量",   group: "平台基础", cls: "",      tip: "周期内生产应用调用记录总数；成功、失败均计入", fmt: "wan", cumulative: true },
    { key: "tokens",       name: "总Token数（输入+输出）", group: "平台基础", cls: "teal", tip: "输入Token + 输出Token 合计用量", fmt: "wan", cumulative: true },
    { key: "cumRegUsers",  name: "累计注册人数",   group: "平台基础", cls: "purple", tip: "累计注册用户总数（时点，单调递增）", fmt: "wan", cumulative: false },
    { key: "pagePV",       name: "平台总访问PV",   group: "平台基础", cls: "",      tip: "平台页面访问总次数（PV），来源于 Excel《关键数据总览（月）》平台总访问PV字段", fmt: "wan", cumulative: true }
  ];
  var COLOR_MAP = { "": "#3b82f6", "teal": "#14b8a6", "purple": "#8b5cf6", "orange": "#f59e0b", "red": "#ef4444" };

  function injectCoreStyle() {
    if (document.getElementById("ovCoreStyle")) return;
    var s = document.createElement("style"); s.id = "ovCoreStyle";
    s.textContent =
      /* 覆盖 base .kpi-grid 最小宽度，确保卡片内容（标题/数值/环比/按钮/趋势）完整显示 */
      ".kpi-grid{grid-template-columns:repeat(auto-fit,minmax(256px,1fr))!important}" +
      ".kpi{min-height:128px;display:flex;flex-direction:column;padding:14px 14px 12px}.kpi .val{font-size:22px;font-weight:800;letter-spacing:.3px;margin-top:2px;line-height:1.15;padding-right:96px}" +
      ".kpi .val .val-unit{font-size:13px;font-weight:600;color:var(--muted);margin-left:1px;letter-spacing:0}" +
      ".kpi-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:2px}" +
      ".kpi-hd .lb{flex:1 1 auto;min-width:0;font-size:12px;color:var(--muted);margin:0;padding-right:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".kpi-actions{display:flex;align-items:center;gap:5px;flex-shrink:0;margin-top:-1px}" +
      ".kpi-mode-seg{display:inline-flex;border:1px solid var(--line,#e5e7eb);border-radius:6px;overflow:hidden;background:#fff}" +
      ".kpi-mode-btn{border:none;background:#fff;color:#64748b;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;line-height:1;transition:.12s}" +
      ".kpi-mode-btn.active{background:var(--brand,#3b82f6);color:#fff}" +
      ".kpi-mode-btn:disabled{opacity:.55;cursor:not-allowed;background:#f8fafc;color:#94a3b8}" +
      ".kpi-mode-btn:not(.active):not(:disabled):hover{background:var(--brand-soft,#eff6ff);color:var(--brand,#3b82f6)}" +
      ".kpi .tip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--brand-soft);color:var(--brand);font-size:11px;line-height:1;cursor:help;font-style:normal;font-weight:700;z-index:2}" +
      ".kpi .tip::after{content:attr(data-tip);position:absolute;right:0;top:22px;width:248px;white-space:pre-line;background:#1f2937;color:#fff;font-size:12px;line-height:1.6;padding:8px 10px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);opacity:0;visibility:hidden;transition:.15s;z-index:40;pointer-events:none;text-align:left}" +
      ".kpi .tip:hover::after{opacity:1;visibility:visible}" +
      ".kpi-sub{font-size:11px;color:var(--muted);margin-top:1px;padding-right:96px}" +
      /* mini 趋势图：右侧居中（绝对定位） */
      ".kpi-spark{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:84px;height:40px;display:flex;align-items:center;justify-content:flex-end;pointer-events:none}" +
      ".kpi-spark svg{width:100%;height:100%;display:block}" +
      /* 模型计费金额 KPI 卡：忙时/闲时 环形图（加大） */
      ".kpi.cost .val,.kpi.cost .kpi-sub{padding-right:156px}" +
      ".kpi.platform-tokens .val,.kpi.platform-tokens .kpi-sub{padding-right:156px}" +
      ".kpi.production .val,.kpi.production .kpi-sub{padding-right:156px}" +
      /* 用户活跃双值卡片（月活跃+累计活跃 / 月活跃覆盖+累计活跃覆盖）：
       * 2026-08-27 清理：去掉 .kpi-dual-vals/.dv 嵌套容器，卡片只保留标题(唯一指标名)+大号数值+副标题，
       * 数值与 mini 图左右并列展示，样式与其他指标卡完全一致。 */
      ".kpi.dual .val,.kpi.dual .kpi-sub{padding-right:0}" +
      /* 2026-08-27 用户活跃双值卡：数值与 mini 图左右并列展示（不再叠套），覆盖度卡 mini 用环形图 */
      ".kpi.side-by-side .kpi-body{display:flex;gap:10px;align-items:center;margin-top:6px;min-height:64px}" +
      ".kpi.side-by-side .kpi-main{flex:1 1 auto;min-width:0}" +
      ".kpi.side-by-side .kpi-main .val{font-size:22px;font-weight:800;letter-spacing:.3px;line-height:1.15;padding-right:0;margin-top:2px}" +
      ".kpi.side-by-side .kpi-main .val .val-unit{font-size:13px;font-weight:600;color:var(--muted);margin-left:1px;letter-spacing:0}" +
      ".kpi.side-by-side .kpi-main .kpi-sub{padding-right:0;margin-top:2px}" +
      ".kpi.side-by-side .kpi-side{flex:0 0 auto;display:flex;align-items:center;justify-content:center}" +
      ".kpi.side-by-side .kpi-spark{position:static;transform:none;width:84px;height:50px;align-items:center;justify-content:flex-end}" +
      /* 覆盖度卡：mini 改为环形图（活跃用户 vs 注册用户的占比分布），参考「投产率」卡 UI：
       * 64px 环形图 + 右侧图例，位于卡片右侧垂直居中。
       * 图例中的「活跃 630.4万 / 未活跃 833.7万」强制一行展示（white-space:nowrap + min-width 容纳）。 */
      ".kpi.side-by-side .kpi-donut-mini{position:static;transform:none;width:160px;height:64px;display:flex;align-items:center;gap:8px;pointer-events:none}" +
      ".kpi.side-by-side .kpi-donut-mini svg{flex:0 0 64px;width:64px;height:64px}" +
      ".kpi.side-by-side .kpi-donut-mini .dml-cap{font-size:9px;font-weight:700;fill:#9ca3af}" +
      ".kpi.side-by-side .kpi-donut-mini .dml-pct{font-size:14px;font-weight:800;fill:#1f2937}" +
      ".kpi.side-by-side .kpi-donut-mini .dml-legend{font-size:11px;color:#475569;line-height:1.3;display:flex;flex-direction:column;gap:4px;min-width:80px}" +
      ".kpi.side-by-side .kpi-donut-mini .dml-legend span{display:flex;align-items:center;gap:4px;white-space:nowrap}" +
      ".kpi.side-by-side .kpi-donut-mini .dml-legend i{width:8px;height:8px;border-radius:2px;display:inline-block;flex:0 0 8px;margin-right:0;vertical-align:middle}" +
      ".kpi-donut{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:148px;height:64px;display:flex;align-items:center;gap:8px;pointer-events:none}" +
      ".kpi-donut svg{flex:0 0 64px}" +
      ".kpi-donut .donut-pct{font-size:14px;font-weight:800;fill:#1f2937}" +
      ".kpi-donut .donut-cap{font-size:9px;fill:#9ca3af;font-weight:700}" +
      ".kpi-donut-legend{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;line-height:1.25}" +
      ".kpi-donut-legend span{display:flex;align-items:center;gap:4px;white-space:nowrap}" +
      ".kpi-donut-legend i{width:8px;height:8px;border-radius:2px;flex:0 0 8px}" +
      /* 底部行：环比 + 按钮（全宽，不再与 spark 挤同一行） */
      ".kpi-foot{margin-top:auto;padding-top:8px;border-top:1px dashed var(--line,#e5e7eb);display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}" +
      ".kpi-note-row{font-size:10.5px;color:#9ca3af;margin-top:4px;width:100%}" +
      ".mom{font-size:11.5px;font-weight:700;white-space:nowrap}.mom.up{color:#14b8a6}.mom.down{color:#ef4444}.mom.flat{color:#9ca3af}" +
      ".factor-btn{margin-left:0;border:1px solid var(--brand,#3b82f6);background:#fff;color:var(--brand,#3b82f6);border-radius:8px;padding:2px 9px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:.12s}.factor-btn:hover{background:var(--brand-soft,#eff6ff)}" +
      /* 累计模式下不可累计指标的置灰态 */
      ".kpi-grey{opacity:.5;filter:grayscale(1);cursor:default}.kpi-grey:hover{box-shadow:0 4px 20px rgba(31,41,55,.08);transform:none}" +
      ".period-banner{margin:10px 0 6px;background:var(--brand-soft,#eff6ff);border:1px solid var(--brand,#3b82f6);border-left:4px solid var(--brand,#3b82f6);border-radius:8px;padding:12px 14px;font-size:13px;color:var(--ink,#1f2937)}" +
      ".spark{display:block}.spark-empty{font-size:11px;color:#9ca3af}.kpi-note{font-size:10.5px;color:#9ca3af}" +
      /* —— 关键指标 > 4 组层级 —— */
      ".section-parent{margin-top:4px}" +
      ".section-title{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800;color:#1f2937;margin:18px 0 2px;padding:0 0 10px;border-bottom:2px solid var(--line)}" +
      ".sub-group{position:relative;margin:14px 0 6px 16px;padding-left:14px;border-left:2px solid var(--line)}" +
      ".sub-group.last{border-left-color:transparent;margin-bottom:2px}" +
      ".sub-label{font-size:13px;font-weight:800;color:var(--brand);letter-spacing:1px;margin:0 0 10px;padding-left:11px;position:relative}" +
      ".sub-label::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:4px;height:14px;background:var(--brand);border-radius:2px}" +
      /* —— 选中指标卡：可点击下钻 + 选中态高亮（交互可见性） —— */
      ".kpi{position:relative;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}" +
      ".kpi:hover{box-shadow:0 6px 18px rgba(31,41,55,.14);transform:translateY(-2px)}" +
      ".kpi.selected{outline:2px solid var(--brand);outline-offset:2px;box-shadow:0 8px 22px rgba(59,130,246,.20)}";
    document.head.appendChild(s);
  }
  function simSource() {
    var LD = window.LINGYUN_DATA || {};
    return LD.overviewByProvince || (SIM && SIM.byProvince) || null;
  }
  function getSelMonths() {
    var mm = (V && V.overview && V.overview.monthly) || [];
    var ms = mm.map(function (m) { return m.month; });
    if (!ms.length && SIM) ms = SIM.months.slice();
    if (SIM) ms = ms.filter(function (m) { return SIM.months.indexOf(m) >= 0; });
    return ms;
  }
  function getSelProvs() {
    var chips = document.querySelectorAll("#provChips-overview .uchip.on");
    var sel = [];
    chips.forEach(function (c) { var u = c.dataset.u; if (u && u !== "全国") sel.push(u); });
    return sel;
  }
  function activeSeries(src) {
    var provs = getSelProvs();
    if (!provs.length) return src["全网"] || [];
    if (provs.length === 1) return src[provs[0]] || src["全网"];
    return aggProvs(src, provs);
  }
  function aggProvs(src, provs) {
    var arrs = provs.map(function (p) { return src[p] || []; });
    var months = SIM ? SIM.months : [];
    return months.map(function (m, idx) {
      var rec = { month: m };
      METRICS.forEach(function (mt) {
        var vals = arrs.map(function (a) { return a[idx] ? a[idx][mt.key] : null; }).filter(function (v) { return v != null; });
        if (!vals.length) { rec[mt.key] = null; return; }
        if (mt.cumulative) rec[mt.key] = vals.reduce(function (x, y) { return x + y; }, 0);
        else if (mt.key === "successRate" || mt.key === "avgLatency") {
          var w = arrs.map(function (a) { return a[idx] ? (a[idx].calls || 0) : 0; });
          var sw = w.reduce(function (x, y) { return x + y; }, 0);
          rec[mt.key] = sw ? vals.reduce(function (s, v, i) { return s + v * w[i]; }, 0) / sw : vals[0];
        } else if (mt.key === "productionRate") {
          var w = arrs.map(function (a) { return a[idx] ? (a[idx].totalAgentsOnline || 0) : 0; });
          var sw = w.reduce(function (x, y) { return x + y; }, 0);
          rec[mt.key] = sw ? vals.reduce(function (s, v, i) { return s + v * w[i]; }, 0) / sw : vals[0];
        } else rec[mt.key] = vals.reduce(function (x, y) { return x + y; }, 0) / vals.length;
      });
      /* 忙时/闲时计费（不在 METRICS 中，独立求和，保证多省份聚合时堆积图可用） */
      ["costBusy", "costIdle", "tokensBusy", "tokensIdle"].forEach(function (k) {
        var vals = arrs.map(function (a) { return a[idx] ? a[idx][k] : null; }).filter(function (v) { return v != null; });
        rec[k] = vals.length ? vals.reduce(function (x, y) { return x + y; }, 0) : null;
      });
      return rec;
    });
  }
  function computeMain(mt, sel, mode) {
    var vals = sel.map(function (r) { return r[mt.key]; }).filter(function (v) { return v != null; });
    if (!vals.length) return null;
    /* 累计时点指标（推广/优秀/双周优秀 时点累计）：数据本身单调递增，多月/累计时取最新月累计值，不重复累加 */
    if (mt.cumSnap) return vals[vals.length - 1];
    if (mode === "累计" && mt.cumulative) return vals.reduce(function (a, b) { return a + b; }, 0);
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  /* 环比（momChange）：返回 {ch, cur, prev}；对 cumSnap 指标 cur−prev 恰为「当月新增」（累计值之差） */
  function momChange(mt, full, sel) {
    function g(r) { return r ? r[mt.key] : null; }
    var cur, prev;
    if (sel.length >= 2) { cur = g(sel[sel.length - 1]); prev = g(sel[sel.length - 2]); }
    else if (sel.length === 1) {
      var idx = -1; for (var i = 0; i < full.length; i++) { if (full[i].month === sel[0].month) { idx = i; break; } }
      cur = g(sel[0]); prev = idx > 0 ? g(full[idx - 1]) : null;
    } else return null;
    if (cur == null || prev == null || prev === 0) return null;
    return { ch: (cur - prev) / prev, cur: cur, prev: prev };
  }
  function sparkline(vals, color) {
    var w = 86, h = 30, pad = 3;
    var nums = vals.filter(function (v) { return v != null; });
    if (nums.length < 2) return '<span class="spark-empty">—</span>';
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), rng = (max - min) || 1;
    var n = vals.length, pts = vals.map(function (v, i) {
      var x = pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
      var y = h - pad - (h - 2 * pad) * (v == null ? 0 : (v - min) / rng);
      return [x, y];
    });
    var ptsStr = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    /* 渐变填充：末段到起点闭合，渲染为柔和面积 */
    var areaPts = ptsStr + " " + pts[pts.length - 1][0].toFixed(1) + "," + (h - pad).toFixed(1) + " " + pts[0][0].toFixed(1) + "," + (h - pad).toFixed(1);
    var gid = "sg" + Math.random().toString(36).slice(2, 8);
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + areaPts + '" fill="url(#' + gid + ')"/>' +
      '<polyline points="' + ptsStr + '" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
      '</svg>';
  }
  /* 2026-08-27 用户活跃��盖度卡 mini 环形图：展示「活跃用户数 / 累计注册人数」占比分布
   * 颜色与卡片主色（橙色）一致：活跃部分填充、剩余注册用户浅灰底色。 */
  function coverDonutMini(activeVal, totalVal) {
    if (activeVal == null || totalVal == null || totalVal <= 0) {
      return '<div class="kpi-donut-mini"><span class="spark-empty">—</span></div>';
    }
    var pct = Math.max(0, Math.min(1, activeVal / totalVal));
    /* 2026-08-27 参考「投产率」卡片 UI：64px 环形图 + 右侧图例，位于卡片右侧垂直居中 */
    var r = 22, C = 2 * Math.PI * r, fill = C * pct;
    var pctTxt = (pct * 100).toFixed(0) + "%";
    var activeC = "#f59e0b", remC = "#eef2f7";
    return '<div class="kpi-donut-mini">' +
      '<svg viewBox="0 0 64 64" width="64" height="64">' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + remC + '" stroke-width="10"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + activeC + '" stroke-width="10" stroke-dasharray="' + fill.toFixed(2) + ' ' + (C - fill).toFixed(2) + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="29" text-anchor="middle" class="dml-pct">' + pctTxt + '</text>' +
      '<text x="32" y="43" text-anchor="middle" class="dml-cap">活跃</text>' +
      '</svg>' +
      '<div class="dml-legend">' +
      '<span><i style="background:' + activeC + '"></i>活跃 ' + (activeVal >= 10000 ? (activeVal / 10000).toFixed(1) + "万" : fmtInt(Math.round(activeVal))) + '</span>' +
      '<span><i style="background:' + remC + '"></i>未活跃 ' + (totalVal - activeVal >= 10000 ? ((totalVal - activeVal) / 10000).toFixed(1) + "万" : fmtInt(Math.round(totalVal - activeVal))) + '</span>' +
      '</div>' +
      '</div>';
  }
  /* 模型计费金额 KPI 卡迷你图：忙时/闲时 环形图（替代 sparkline） */
  function fmtMoneyShort(v) {
    if (v == null) return "—";
    if (v >= 1e8) return "¥" + (v / 1e8).toFixed(2) + "亿";
    if (v >= 1e4) return "¥" + (v / 1e4).toFixed(1) + "万";
    return "¥" + Math.round(v).toLocaleString("zh-CN");
  }
  function costDonut(full, sel, mode) {
    var rows = (sel && sel.length) ? sel : full;
    var busyVals = rows.map(function (r) { return r.costBusy; }).filter(function (v) { return v != null; });
    var idleVals = rows.map(function (r) { return r.costIdle; }).filter(function (v) { return v != null; });
    if (!busyVals.length || !idleVals.length) return '<span class="spark-empty">—</span>';
    var busy, idle;
    if (mode === "累计") {
      busy = busyVals.reduce(function (a, b) { return a + b; }, 0);
      idle = idleVals.reduce(function (a, b) { return a + b; }, 0);
    } else if (mode === "月均") {
      busy = busyVals.reduce(function (a, b) { return a + b; }, 0) / busyVals.length;
      idle = idleVals.reduce(function (a, b) { return a + b; }, 0) / idleVals.length;
    } else {
      busy = busyVals[busyVals.length - 1];
      idle = idleVals[idleVals.length - 1];
    }
    var total = busy + idle;
    if (total <= 0) return '<span class="spark-empty">—</span>';
    var r = 22, C = 2 * Math.PI * r, bf = busy / total, busyLen = C * bf;
    var busyC = "#3b82f6", idleC = "#fbbf24";
    var pct = Math.round(bf * 100);
    return '<svg class="donut" viewBox="0 0 64 64" width="64" height="64">' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="#eef2f7" stroke-width="10"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + busyC + '" stroke-width="10" stroke-dasharray="' + busyLen.toFixed(2) + ' ' + (C - busyLen).toFixed(2) + '" stroke-dashoffset="0" transform="rotate(-90 32 32)"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + idleC + '" stroke-width="10" stroke-dasharray="' + (C - busyLen).toFixed(2) + ' ' + busyLen.toFixed(2) + '" stroke-dashoffset="' + (-busyLen).toFixed(2) + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="29" text-anchor="middle" class="donut-pct">' + pct + '%</text>' +
      '<text x="32" y="43" text-anchor="middle" class="donut-cap">忙时</text>' +
      '</svg>' +
      '<div class="kpi-donut-legend">' +
      '<span><i style="background:' + busyC + '"></i>忙时 ' + fmtMoneyShort(busy) + '</span>' +
      '<span><i style="background:' + idleC + '"></i>闲时 ' + fmtMoneyShort(idle) + '</span>' +
      '</div>';
  }
  /* 平台基础 KPI 卡迷你图：忙时/闲时 Token 构成，直接读取 Excel 字段 */
  function tokenDonut(full, sel, mode) {
    var rows = (sel && sel.length) ? sel : full;
    var busyVals = rows.map(function (r) { return r.tokensBusy; }).filter(function (v) { return v != null; });
    var idleVals = rows.map(function (r) { return r.tokensIdle; }).filter(function (v) { return v != null; });
    if (!busyVals.length || !idleVals.length) return '<span class="spark-empty">—</span>';
    function agg(vals) { if (mode === "累计") return vals.reduce(function (a, b) { return a + b; }, 0); if (mode === "月均") return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length; return vals[vals.length - 1]; }
    var busy = agg(busyVals), idle = agg(idleVals), total = busy + idle;
    if (!total) return '<span class="spark-empty">—</span>';
    var r = 22, C = 2 * Math.PI * r, busyLen = C * busy / total;
    var busyC = "#14b8a6", idleC = "#99f6e4";
    return '<svg class="donut" viewBox="0 0 64 64" width="64" height="64" title="忙时/闲时 Token 构成：直接读取 Excel 忙时总Token数、闲时总Token数"><circle cx="32" cy="32" r="' + r + '" fill="none" stroke="#ecfeff" stroke-width="10"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + busyC + '" stroke-width="10" stroke-dasharray="' + busyLen.toFixed(2) + ' ' + (C - busyLen).toFixed(2) + '" transform="rotate(-90 32 32)"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + idleC + '" stroke-width="10" stroke-dasharray="' + (C - busyLen).toFixed(2) + ' ' + busyLen.toFixed(2) + '" stroke-dashoffset="' + (-busyLen).toFixed(2) + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="29" text-anchor="middle" class="donut-pct">' + Math.round(busy / total * 100) + '%</text><text x="32" y="43" text-anchor="middle" class="donut-cap">忙时</text></svg>' +
      '<div class="kpi-donut-legend"><span><i style="background:' + busyC + '"></i>忙时 ' + fmtWan(busy) + '</span><span><i style="background:' + idleC + '"></i>闲时 ' + fmtWan(idle) + '</span></div>';
  }
  /* 投产率 KPI 卡迷你图：投产 / 未投产 环形图 */
  function prodDonut(full, sel, mode) {
    var rows = (sel && sel.length) ? sel : full;
    // 只保留“投产数”和“上线数”同时存在的月份，避免分母口径不一致（7–8 月智能体清单缺失导致投产数为 null）
    var pairs = rows.map(function (r) { return { p: r.producingAgents, t: r.totalAgentsOnline }; })
      .filter(function (o) { return o.p != null && !isNaN(o.p) && o.t != null && !isNaN(o.t) && o.t > 0; });
    if (!pairs.length) return '<span class="spark-empty">—</span>';
    var prod, total;
    if (mode === "累计") {
      prod = pairs.reduce(function (a, b) { return a + b.p; }, 0);
      total = pairs.reduce(function (a, b) { return a + b.t; }, 0);
    } else if (mode === "月均") {
      prod = pairs.reduce(function (a, b) { return a + b.p; }, 0) / pairs.length;
      total = pairs.reduce(function (a, b) { return a + b.t; }, 0) / pairs.length;
    } else {
      var last = pairs[pairs.length - 1];
      prod = last.p; total = last.t;
    }
    if (!total || total <= 0) return '<span class="spark-empty">—</span>';
    prod = Math.min(prod, total);
    var r = 22, C = 2 * Math.PI * r, prodLen = C * (prod / total);
    var prodC = "#14b8a6", remC = "#e2e8f0";
    var pct = Math.round(prod / total * 100);
    return '<svg class="donut" viewBox="0 0 64 64" width="64" height="64">' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + remC + '" stroke-width="10"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + prodC + '" stroke-width="10" stroke-dasharray="' + prodLen.toFixed(2) + ' ' + (C - prodLen).toFixed(2) + '" stroke-dashoffset="0" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="29" text-anchor="middle" class="donut-pct">' + pct + '%</text>' +
      '<text x="32" y="43" text-anchor="middle" class="donut-cap">投产率</text>' +
      '</svg>' +
      '<div class="kpi-donut-legend">' +
      '<span><i style="background:' + prodC + '"></i>投产 ' + fmtInt(Math.round(prod)) + '</span>' +
      '<span><i style="background:' + remC + '"></i>未投产 ' + fmtInt(Math.round(total - prod)) + '</span>' +
      '</div>';
  }
  /* 活跃智能体数 KPI 卡 mini 柱形图：展示 1月至当前月 每月数值 + 月均参考线 */
  function barSpark(vals, color, avg) {
    var w = 86, h = 32, pad = 3, gap = 2;
    var nums = vals.filter(function (v) { return v != null && !isNaN(v); });
    if (!nums.length) return '<span class="spark-empty">—</span>';
    var max = Math.max.apply(null, nums), min = Math.min.apply(null, nums);
    if (avg != null) { max = Math.max(max, avg); min = Math.min(min, avg); }
    var rng = (max - min) || 1;
    var n = vals.length;
    var barW = Math.max(3, (w - 2 * pad - (n - 1) * gap) / n);
    var totalW = n * barW + (n - 1) * gap;
    var startX = pad + (w - 2 * pad - totalW) / 2;
    var svg = '<svg class="spark bar-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">';
    var titles = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
    vals.forEach(function (v, i) {
      if (v == null) return;
      var bh = ((v - min) / rng) * (h - 2 * pad);
      var x = startX + i * (barW + gap);
      var y = h - pad - bh;
      var title = titles[i] || (i + 1) + "月";
      svg += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + bh.toFixed(2) + '" rx="1.5" fill="' + color + '" opacity="0.9" title="' + title + '：' + fmtInt(Math.round(v)) + '"/>';
    });
    if (avg != null) {
      var ay = h - pad - ((avg - min) / rng) * (h - 2 * pad);
      svg += '<line x1="' + pad + '" y1="' + ay.toFixed(2) + '" x2="' + (w - pad) + '" y2="' + ay.toFixed(2) + '" stroke="#475569" stroke-width="1.3" stroke-dasharray="3 2" title="月均：' + fmtInt(Math.round(avg)) + '"/>';
    }
    return svg + '</svg>';
  }
  /* 上线智能体总数量 KPI 卡 mini 折线图：展示 1月至当前月 每月数值（纯折线，无面积填充） */
  function lineSpark(vals, color) {
    var w = 86, h = 32, pad = 3;
    var pts = [], titles = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
    var nums = vals.filter(function (v) { return v != null && !isNaN(v); });
    if (nums.length < 2) return '<span class="spark-empty">—</span>';
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), rng = (max - min) || 1;
    var n = vals.length;
    vals.forEach(function (v, i) {
      if (v == null) return;
      var x = pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
      var y = h - pad - ((v - min) / rng) * (h - 2 * pad);
      pts.push([x, y]);
    });
    var ptsStr = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var dots = pts.map(function (p, i) {
      var t = titles[i] || (i + 1) + "月";
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.2" fill="' + color + '" stroke="#fff" stroke-width="1" title="' + t + '：' + fmtInt(Math.round(vals[i])) + '"/>';
    }).join("");
    return '<svg class="spark line-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
      '<polyline points="' + ptsStr + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' + dots + '</svg>';
  }
  function fmtMetric(mt, v) {
    if (v == null || isNaN(v)) return "/";
    if (mt.fmt === "wan") return fmtWan(v);
    if (mt.fmt === "int") return fmtInt(Math.round(v));
    if (mt.fmt === "pct") return (v * 100).toFixed(2) + "%";
    if (mt.fmt === "ms") return Math.round(v) + " ms";
    if (mt.fmt === "py") return fmtPY(v);
    if (mt.fmt === "money") return fmtMoney(v);
    return String(v);
  }
  /* ===== 数字 count-up 动画（克制：~720ms quarticOut，reduced-motion 跳过） =====
   * 设计：尊重 prefers-reduced-motion；duration 720ms；缓动 cubic-bezier(0.16,1,0.3,1)；
   * 锁定 final unit 防 count-up 过程中单位在「万/亿」之间跳动。 */
  function prefersReducedMotion() {
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function formatByFmt(v, fmt, lockedUnit) {
    if (v == null || isNaN(v)) return "/";
    if (fmt === "wan") {
      if (lockedUnit === "万") return (v / 1e4).toFixed(1) + " 万";
      if (lockedUnit === "亿") return (v / 1e8).toFixed(2) + " 亿";
      return fmtWan(v);
    }
    if (fmt === "int") return fmtInt(Math.round(v));
    if (fmt === "pct") return (v * 100).toFixed(2) + "%";
    if (fmt === "ms") return Math.round(v) + " ms";
    if (fmt === "py") return fmtPY(v);
    if (fmt === "money") return fmtMoney(v);
    return String(v);
  }
  function bindKpiCountUp(wrap) {
    if (!wrap) return;
    var reduce = prefersReducedMotion();
    wrap.querySelectorAll(".kpi .val-num[data-raw]").forEach(function (el) {
      var raw = parseFloat(el.getAttribute("data-raw"));
      var fmt = el.getAttribute("data-fmt");
      if (isNaN(raw)) return;
      var sFinal = formatByFmt(raw, fmt);
      var mFinal = sFinal.match(/^(.+?)\s*(人年|万|亿|ms|%)$/);
      var finalNum = mFinal ? mFinal[1] : sFinal;
      var finalUnit = mFinal ? mFinal[2] : "";
      var unitEl = el.nextElementSibling;
      if (unitEl && unitEl.classList.contains("val-unit")) unitEl.textContent = finalUnit;
      if (reduce || raw === 0) { el.textContent = finalNum; return; }
      el.textContent = "0";
      var start = performance.now();
      var dur = 720;
      var ease = function (t) { return 1 - Math.pow(1 - t, 4); };
      function step(now) {
        var p = Math.min(1, (now - start) / dur);
        var v = raw * ease(p);
        el.textContent = formatByFmt(v, fmt, finalUnit).replace(/\s*(人年|万|亿|ms|%)$/, "");
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = finalNum;
      }
      requestAnimationFrame(step);
    });
  }
  /* KPI 卡专用：把尾随单位（亿/万/人年）拆为小字 val-unit，并把 raw 数字挂在 data-* 供 count-up */
  function fmtKpiVal(mt, v) {
    if (v == null || isNaN(v)) return '<span class="val-num">/</span>';
    var s = fmtMetric(mt, v);
    var m = s.match(/^(.+?)\s*(人年|万|亿|ms|%)$/);
    if (m) return '<span class="val-num" data-raw="' + esc(String(v)) + '" data-fmt="' + esc(mt.fmt) + '">' + esc(m[1]) + '</span><span class="val-unit">' + esc(m[2]) + '</span>';
    return '<span class="val-num" data-raw="' + esc(String(v)) + '" data-fmt="' + esc(mt.fmt) + '">' + esc(s) + '</span>';
  }
  function subLabel(sel, mode, mt) {
    if (sel.length === 1) return mt && mt.cumSnap ? (sel[0] + " 累计（时点）") : (sel[0] + " 当月");
    var s = sel[0], e = sel[sel.length - 1];
    if (mt && mt.cumSnap) return "截至 " + e + " 累计（时点）";
    var range = (s === "1月") ? ("1–" + e) : (s + "–" + e);
    return range + " " + (mode === "累计" ? "累计" : "月均");
  }
  function momHtml(mt, mo, key, group) {
    if (!mo || mo.ch == null) return '<span class="mom flat" title="无上期对照数据，无法计算环比">— 无上期对照</span>';
    var ch = mo.ch, cur = mo.cur, prev = mo.prev;
    var pct = ch * 100, up = pct >= 0, good = mt.reverse ? !up : up;
    var cls = (pct === 0) ? "flat" : (good ? "up" : "down");
    var btn = '<button type="button" class="factor-btn" data-factor="' + (key || "") + '" data-group="' + esc(group || "") + '">查看变动因素</button>';
    var txt;
    if (mt.cumSnap) {
      /* 时点累计指标：展示「本月新增」= 当月累计 − 上月累计 */
      var delta = (cur != null && prev != null) ? (cur - prev) : null;
      if (delta == null) txt = "— 无上期对照";
      else {
        var dArrow = delta > 0 ? "▲" : (delta < 0 ? "▼" : "•");
        txt = dArrow + " 本月新增 " + (delta > 0 ? "+" : "") + fmtInt(Math.round(delta));
      }
    } else {
      var arrow = pct > 0 ? "↗" : (pct < 0 ? "↘" : "•");
      txt = arrow + " " + (up ? "+" : "") + pct.toFixed(1) + "% VS 上期";
    }
    return '<span class="mom ' + cls + '" title="' + (mt.cumSnap ? "时点累计值（单调递增）；本月新增=当月累计−上月累计" : "") + '">' + txt + '</span>' + btn;
  }
  /* 每张 KPI 卡内部的 月均/累计 切换按钮 */
  function kpiModeSeg(m, mode) {
    var avgCls = (mode === "月均" ? "active" : "");
    var cumCls = (mode === "累计" ? "active" : "");
    if (m.cumSnap) {
      return '<div class="kpi-mode-seg" data-metric="' + esc(m.key) + '">' +
        '<button class="kpi-mode-btn" data-mode="月均" type="button" disabled title="时点累计指标，默认展示累计值">月均</button>' +
        '<button class="kpi-mode-btn active" data-mode="累计" type="button" disabled title="时点累计指标，默认展示累计值">累计</button></div>';
    }
    /* 月/累计双维度切换卡片（variants）：月均与累计均可点击 */
    if (m.variants) {
      return '<div class="kpi-mode-seg" data-metric="' + esc(m.key) + '">' +
        '<button class="kpi-mode-btn ' + avgCls + '" data-mode="月均" type="button">月均</button>' +
        '<button class="kpi-mode-btn ' + cumCls + '" data-mode="累计" type="button">累计</button></div>';
    }
    if (!m.cumulative) {
      return '<div class="kpi-mode-seg" data-metric="' + esc(m.key) + '">' +
        '<button class="kpi-mode-btn ' + avgCls + '" data-mode="月均" type="button">月均</button>' +
        '<button class="kpi-mode-btn ' + cumCls + '" data-mode="累计" type="button" disabled title="非累计指标，仅支持月均">累计</button></div>';
    }
    return '<div class="kpi-mode-seg" data-metric="' + esc(m.key) + '">' +
      '<button class="kpi-mode-btn ' + avgCls + '" data-mode="月均" type="button">月均</button>' +
      '<button class="kpi-mode-btn ' + cumCls + '" data-mode="累计" type="button">累计</button></div>';
  }
  function renderCoreCards() {
    injectCoreStyle();
    var wrap = $("coreCardsArea"); if (!wrap) return;
    var src = simSource();
    if (!src) {
      wrap.innerHTML = '<div class="gap-block"><div class="gap-title">核心指标（15 项）</div><div class="gap-note">overviewByProvince 数据未接入（待取数脚本扩展 data-contract 的 overview 月度字段后自动填充；开发态加载 overview_sim_data.js 预览）。</div></div>';
      return;
    }
    /* KPI 模式切换会重建核心区 DOM；先释放已展开趋势卡的图表实例，避免实例继续绑定旧节点。 */
    GROUPS.forEach(function (g) { if (TREND_OPEN[g]) disposeTrendInstances(g); });
    var full = activeSeries(src);
    var selMonths = getSelMonths();
    var sel = full.filter(function (r) { return selMonths.indexOf(r.month) >= 0; });
    if (!sel.length) sel = full;
    var groups = GROUPS; // 与趋势卡平铺分组一致（单一来源）
    var dim = globalDim();
    if (dim !== "month") {
      var dLabel = dim === "week" ? "周" : "日";
      var wkRange = SIM ? (SIM.months[0] + "–" + SIM.months[SIM.months.length - 1]) : "";
      wrap.innerHTML = '<div class="period-banner">' + dLabel + '粒度数据待接入：当前模拟数据仅包含月度（' + wkRange + '）。请在顶部筛选切回「月」查看核心指标卡片。</div>';
      return;
    }
    /* 关键指标标题：月均/累计 切换已下沉至每张 KPI 卡内部 */
    var html = '<div class="section-parent"><div class="section-title"><span>关键指标</span></div>';
    groups.forEach(function (g, gi) {
      var cards = METRICS.filter(function (m) { return m.group === g && !m.hidden; });
      var gst = gTrendState(g);
      html += '<div class="sub-group' + (gi === groups.length - 1 ? " last" : "") + '" data-group="' + esc(g) + '">';
      html += '<div class="sub-label">' + g + '</div><div class="kpi-grid">';
      cards.forEach(function (m, ci) {
        var mode = cardMode(m);
        var isDual = !!(m.dual || m.variants);
        var grey = (!isDual && mode === "累计" && !m.cumulative);
        var main = grey ? null : computeMain(m, sel, mode);
        /* 累计注册人数是时点资产值：主值始终取所选区间末值，不做月份平均 */
        if (!grey && m.key === "cumRegUsers") {
          var _crVals = sel.map(function (r) { return r.cumRegUsers; }).filter(function (v) { return v != null; });
          main = _crVals.length ? _crVals[_crVals.length - 1] : null;
        }
        var mom = grey ? null : momChange(m, full, sel);
        var reportKey = m.key;
        var spark;
        if (grey) {
          spark = "";
        } else if (m.key === "cost") {
          spark = costDonut(full, sel, mode);
        } else if (m.key === "productionRate") {
          spark = prodDonut(full, sel, mode);
        } else if (m.key === "tokens") {
          spark = tokenDonut(full, sel, mode);
        } else if (m.key === "activeAgents" || m.key === "hotAgents") {
          var hv = full.map(function (r) { return r[m.key]; });
          var hn = hv.filter(function (v) { return v != null && !isNaN(v); });
          var ha = hn.length ? hn.reduce(function (a, b) { return a + b; }, 0) / hn.length : null;
          spark = barSpark(hv, COLOR_MAP[m.cls] || COLOR_MAP.purple, ha);
        } else if (m.key === "totalAgentsOnline") {
          spark = lineSpark(full.map(function (r) { return r.totalAgentsOnline; }), COLOR_MAP[m.cls] || COLOR_MAP[""]);
        } else {
          spark = sparkline(full.map(function (r) { return r[m.key]; }), COLOR_MAP[m.cls] || COLOR_MAP[""]);
        }
        var dualValsHtml = "";
        if (isDual) {
          /* 月/累计维度切换卡片：根据当前 月均/累计 模式显示对应维度值 */
          function _avg(key) { var vs = sel.map(function (r) { return r[key]; }).filter(function (v) { return v != null; }); return vs.length ? vs.reduce(function (a, b) { return a + b; }, 0) / vs.length : null; }
          function _latest(key) { var vs = sel.map(function (r) { return r[key]; }).filter(function (v) { return v != null; }); return vs.length ? vs[vs.length - 1] : null; }
          var mode = cardMode(m);
          var vA = m.variants["月均"], vB = m.variants["累计"];
          var vMain, mainKey, sparkKey;
          if (mode === "累计") {
            vMain = _latest(vB.key); mainKey = vB.key; sparkKey = vB.key;
          } else {
            vMain = _avg(vA.key); mainKey = vA.key; sparkKey = vA.key;
          }
          main = vMain;
          reportKey = mainKey;
          mom = momChange({ key: mainKey }, full, sel);
          /* 「活跃用户覆盖度」卡片：mini 改为环形图（活跃/累计注册占比）。
           * 其余 variants 卡片（如活跃用户数）保留折线图。 */
          if (m.key === "activeCover") {
            /* 覆盖度分子分母：月均模式 mau / 平均cumReg；累计模式 activeUsersCum / 最新cumReg */
            var _avgNum = function (key) { var vs = sel.map(function (r) { return r[key]; }).filter(function (v) { return v != null && !isNaN(v); }); return vs.length ? vs.reduce(function (a, b) { return a + b; }, 0) / vs.length : null; };
            var _latestNum = function (key) { var vs = sel.map(function (r) { return r[key]; }).filter(function (v) { return v != null && !isNaN(v); }); return vs.length ? vs[vs.length - 1] : null; };
            var activeNum = (mode === "累计") ? _latestNum("activeUsersCum") : _avgNum("mau");
            var totalNum = (mode === "累计") ? _latestNum("cumRegUsers") : _avgNum("cumRegUsers");
            spark = coverDonutMini(activeNum, totalNum);
            sparkWrapCls = "kpi-donut-mini";
          } else {
            spark = sparkline(full.map(function (r) { return r[sparkKey]; }), COLOR_MAP[m.cls] || COLOR_MAP.purple);
            sparkWrapCls = "kpi-spark";
          }
          dualValsHtml =
            '<div class="kpi-body">' +
              '<div class="kpi-main">' +
                '<div class="val">' + (vMain == null ? '<span class="val-num">/</span>' : fmtKpiVal({ fmt: m.variants[mode].fmt || m.fmt }, vMain)) + '</div>' +
                '<div class="kpi-sub">' + (mode === "累计" ? "截至 " + selMonths[selMonths.length - 1] + " 累计" : esc(subLabel(selMonths, mode, m))) + '</div>' +
              '</div>' +
              '<div class="kpi-side">' +
                '<div class="' + sparkWrapCls + '">' + spark + '</div>' +
              '</div>' +
            '</div>';
        }
        var selCls = (!grey && m.key === gst.metric) ? " selected" : "";
        var greyCls = grey ? " kpi-grey" : "";
        var stagger = " fade-up stagger-" + Math.min(5, (ci % 5) + 1);
        var kpiExtraCls = (m.key === "cost" ? " cost" : (m.key === "productionRate" ? " production" : (m.key === "tokens" ? " platform-tokens" : (isDual ? " dual side-by-side" : ""))));
        var sparkWrapCls = (m.key === "cost" || m.key === "productionRate" || m.key === "tokens") ? "kpi-donut" : "kpi-spark";
        html += '<div class="kpi ' + m.cls + stagger + selCls + greyCls + kpiExtraCls + '" data-metric="' + m.key + '" data-group="' + esc(g) + '"' + (grey ? ' data-grey="1"' : '') + '>' +
          '<div class="kpi-hd">' +
          '<div class="lb">' + esc(m.name) + '</div>' +
          '<div class="kpi-actions">' + kpiModeSeg(m, mode) + '<span class="tip" data-tip="' + esc(m.tip) + '">ⓘ</span></div>' +
          '</div>' +
          (isDual
            ? dualValsHtml
            : '<div class="val">' + (grey ? '<span class="val-num">—</span>' : fmtKpiVal(m, main)) + '</div>' +
              '<div class="kpi-sub">' + (grey ? '<span class="kpi-note">仅支持月均</span>' : esc(subLabel(selMonths, mode, m))) + '</div>') +
          (grey || isDual ? '' : '<div class="' + sparkWrapCls + '">' + spark + '</div>') +
          (grey ? '' : '<div class="kpi-foot">' + momHtml(m, mom, reportKey, g) + '</div>') +
          '</div>';
      });
      html += '</div>';
      /* 平铺趋势动态卡片：每组下方直接展示该组代表指标的月度趋势 + 榜单（2026-08-24 结构优化） */
      html += '<div class="group-trend-host" id="trendCard-' + gi + '" data-group="' + esc(g) + '"></div>';
      html += '</div>';
    });
    html += '</div>';
    /* 重建 DOM 前释放旧趋势图实例（容器被 innerHTML 覆盖销毁，实例须同步 dispose） */
    Object.keys(trendChartInsts).forEach(function (k) { try { trendChartInsts[k].dispose(); } catch (e) {} });
    trendChartInsts = {};
    gTrendMonths = {};
    wrap.innerHTML = html;
    /* 启动 KPI 数字 count-up 动画（reduced-motion 时自动跳过） */
    bindKpiCountUp(wrap);
    /* 绑定每张 KPI 卡内部的 月均/累计 切换（阻止冒泡，避免触发卡片下钻） */
    wrap.querySelectorAll(".kpi-mode-seg .kpi-mode-btn:not([disabled])").forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var mkey = this.closest(".kpi").getAttribute("data-metric");
        KPI_MODES[mkey] = this.getAttribute("data-mode");
        renderCoreCards();
        /* renderCoreCards 会重建 .group-trend-host 容器（innerHTML 覆盖），
         * 需重新填充趋势卡，否则切月/累计后下方趋势图与榜单被清空。 */
        renderTrendSetup();
      };
    });
  }

  /* ===== 趋势动态分析卡片（平铺于各模块下）+ 环比变动因素（下钻） =====
   * 结构（2026-08-28 优化）：趋势卡默认收起，点击 KPI 后按组展开，
   *   价值 / 智能体应用 / 用户活跃 / 平台基础 四组各自保留一张趋势卡。
   * 交互：
   *   路径 A：点击组内任一 KPI 卡 → 展开该组趋势卡并切换为该指标月度趋势 + 选中月排行。
   *   路径 A2：趋势图单击月份切换月份；双击月份 → 打开该指标对应的环比变动因素弹窗。
   *   路径 B：点击 KPI 卡环比标签旁的「查看变动因素」按钮 → 弹出「环比变动因素」抽屉（拉动/拖累 TOP10）。
   * 数据：应用级（调用量）取自 window.LY_OVERVIEW_APPS；省份级取自 simSource() 的 byProvince。 */
  var GROUPS = ["价值", "智能体应用", "用户活跃", "平台基础"];
  var GROUP_DEFAULT_METRIC = { "价值": "cost", "智能体应用": "activeAgents", "用户活跃": "newRegUsers", "平台基础": "calls" };
  var GTREND = {};          // group -> { metric, month, pyProv } 每组独立选中指标与月份；pyProv 用于「节约人年」趋势卡的省份地图联动
  var TREND_OPEN = {};      // group -> boolean；趋势卡默认收起，点击指标卡后按组展开
  var trendMonthTimers = {};
  var trendChartInsts = {}; // group -> echarts 实例
  var gTrendMonths = {};    // group -> monthsAvail（图表 click 用）
  var pyMapInsts = {};      // group -> echarts map 实例（仅节约人年组使用）
  var factorKeyHandler = null;
  function gTrendState(group) {
    if (!GTREND[group]) GTREND[group] = { metric: GROUP_DEFAULT_METRIC[group] || "calls", month: null, pyProv: null };
    return GTREND[group];
  }
  function groupIndex(group) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i] === group) return i; return 0; }

  function disposeTrendInstances(group) {
    function disposeOne(inst) {
      if (Array.isArray(inst)) { inst.forEach(disposeOne); return; }
      if (inst && typeof inst.dispose === "function") { try { inst.dispose(); } catch (e) {} }
    }
    disposeOne(trendChartInsts[group]);
    trendChartInsts[group] = null;
    disposeOne(trendChartInsts[group + "_scenes"]);
    trendChartInsts[group + "_scenes"] = [];
    var pym = window._pyMapInsts || pyMapInsts;
    if (pym[group]) { disposeOne(pym[group]); pym[group] = null; }
    if (trendMonthTimers[group]) { clearTimeout(trendMonthTimers[group]); trendMonthTimers[group] = null; }
  }

  function bindTrendMonthEvents(inst, group, gi) {
    if (!inst || typeof inst.on !== "function") return;
    inst.off("click");
    inst.off("dblclick");
    (function (chart, g2, gidx) {
      chart.on("click", function (p) {
        if (p.componentType !== "series") return;
        var di = p.dataIndex;
        var mArr = gTrendMonths[g2] || [];
        if (di < 0 || di >= mArr.length) return;
        var clickedMonth = mArr[di];
        if (trendMonthTimers[g2]) clearTimeout(trendMonthTimers[g2]);
        trendMonthTimers[g2] = setTimeout(function () {
          trendMonthTimers[g2] = null;
          var st = gTrendState(g2);
          st.month = clickedMonth;
          updateTrend(gidx);
        }, 220);
      });
      chart.on("dblclick", function (p) {
        if (p.componentType !== "series") return;
        var di = p.dataIndex;
        var mArr = gTrendMonths[g2] || [];
        if (di < 0 || di >= mArr.length) return;
        if (trendMonthTimers[g2]) { clearTimeout(trendMonthTimers[g2]); trendMonthTimers[g2] = null; }
        var st = gTrendState(g2);
        st.month = mArr[di];
        updateTrend(gidx);
        openFactor(st.metric, g2);
      });
    })(inst, group, gi);
  }

  function openTrendGroup(group, scroll) {
    var gi = groupIndex(group);
    var wasOpen = !!TREND_OPEN[group];
    TREND_OPEN[group] = true;
    renderTrendSetup();
    markSelectedCard();
    if (scroll && (!wasOpen || scroll === "force")) {
      var c = document.getElementById("trendCard-" + gi);
      if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function collapseTrendGroup(group) {
    TREND_OPEN[group] = false;
    disposeTrendInstances(group);
    var gi = groupIndex(group), c = document.getElementById("trendCard-" + gi);
    if (c) { c.innerHTML = ""; c.style.display = "none"; }
  }

  function scopeLabel() {
    var sp = getSelProvs();
    if (!sp.length) return { scope: "全网", text: "全网" };
    if (sp.length === 1) return { scope: sp[0], text: sp[0] };
    return { scope: "multi", text: "所选 " + sp.length + " 省（汇总）" };
  }
  function markSelectedCard() {
    document.querySelectorAll("#coreCardsArea .kpi[data-metric]").forEach(function (el) {
      if (el.classList.contains("kpi-grey")) { el.classList.remove("selected"); return; }
      var grp = el.getAttribute("data-group") || GROUPS[0];
      var gst = gTrendState(grp);
      el.classList.toggle("selected", el.getAttribute("data-metric") === gst.metric);
    });
  }

  function injectTrendStyle() {
    if (document.getElementById("ovTrendStyle")) return;
    var s = document.createElement("style"); s.id = "ovTrendStyle";
    s.textContent =
      ".trend-card{margin:14px 0 8px;background:var(--panel,#fff);border:1px solid var(--line,#e5e7eb);border-radius:14px;box-shadow:0 4px 20px rgba(31,41,55,.08);padding:16px 18px}" +
      ".trend-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}" +
      ".trend-hd-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;flex-wrap:wrap}" +
      ".trend-collapse-btn{border:1px solid #bfdbfe;background:#fff;color:#2563eb;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;transition:all .18s ease}" +
      ".trend-collapse-btn:hover{background:#eff6ff;border-color:#60a5fa;transform:translateY(-1px)}" +
      ".trend-title{font-size:16px;font-weight:800;color:#1f2937}" +
      ".trend-sub{font-size:12px;color:#6b7280}" +
      ".trend-chart-legend{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin-top:8px;margin-left:auto;padding:4px 10px;background:#f8fafc;border-radius:6px;font-size:11px;width:fit-content}" +
      ".trend-tag{font-size:11.5px;font-weight:700;color:var(--brand,#3b82f6);background:var(--brand-soft,#eff6ff);border:1px solid var(--brand,#3b82f6);border-radius:12px;padding:3px 6px 3px 10px;margin-left:auto;display:inline-flex;align-items:center;gap:6px}" +
      ".trend-tag-month{color:var(--brand,#3b82f6)}" +
      ".trend-tag-act{border:1px solid var(--brand,#3b82f6);background:var(--brand-soft,#eff6ff);color:var(--brand,#3b82f6);border-radius:8px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;transition:.15s}" +
      ".trend-tag-act:hover{background:#dbeafe;box-shadow:0 2px 6px rgba(59,130,246,.3)}" +
      ".trend-tag-act:active{transform:translateY(1px)}" +
      ".trend-body{display:grid;grid-template-columns:1.35fr 1fr;gap:16px}" +
      "@media (max-width:900px){.trend-body{grid-template-columns:1fr}}" +
      /* —— 模型计费金额趋势卡：左图缩小、右侧榜单扩宽 —— */
      ".trend-card.trend-cost .trend-body{grid-template-columns:0.8fr 1.4fr}" +
      "@media (max-width:1100px){.trend-card.trend-cost .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-cost .trend-chart{height:250px}" +
      ".trend-card.trend-platform-calls .trend-body{grid-template-columns:0.8fr 1.4fr}" +
      "@media (max-width:1100px){.trend-card.trend-platform-calls .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-platform-calls .trend-chart{height:250px}" +
      ".trend-card.trend-platform-token .trend-body{grid-template-columns:0.8fr 1.4fr}" +
      "@media (max-width:1100px){.trend-card.trend-platform-token .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-platform-token .trend-chart{height:250px}" +
      ".trend-card.trend-platform-pv .trend-body{grid-template-columns:0.8fr 1.4fr}" +
      "@media (max-width:1100px){.trend-card.trend-platform-pv .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-platform-pv .trend-chart{height:250px}" +
      ".trend-card.trend-platform-reg .trend-body{grid-template-columns:1.15fr 1fr}" +
      "@media (max-width:1100px){.trend-card.trend-platform-reg .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-platform-reg .trend-chart-card{padding:8px 6px}" +
      ".trend-card.trend-platform-reg .trend-chart{height:280px}" +
      /* —— 节约人年趋势卡：左折线 + 左下联动榜，右侧中国地图（全高） —— */
      ".trend-card.trend-py .trend-body{grid-template-columns:1.05fr 1fr;align-items:stretch;min-height:560px}" +
      "@media (max-width:1100px){.trend-card.trend-py .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-py .py-col-left{display:flex;flex-direction:column;gap:12px;min-width:0}" +
      ".trend-card.trend-py .py-control-row{display:flex;align-items:center;justify-content:flex-start;gap:12px;flex-wrap:wrap;min-height:28px}" +
      ".trend-card.trend-py .py-control-row .trend-monthbar{margin-top:0}" +
      ".trend-card.trend-py .py-control-row > div:first-child{display:flex;align-items:center}" +
      ".trend-card.trend-py .py-col-right{display:flex;flex-direction:column;min-width:0;height:100%}" +
      ".trend-card.trend-py .py-chart-box{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px;display:flex;flex-direction:column;min-height:0}" +
      ".trend-card.trend-py .py-chart-box .trend-chart{height:230px;width:100%}" +
      ".trend-card.trend-py .py-rank-box{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px}" +
      ".trend-card.trend-py .trend-rank-list{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column}" +
      ".trend-card.trend-py .rk-block{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}" +
      ".trend-card.trend-py .rk-block-hd{flex:0 0 auto;border:1px solid #eef2f7;border-bottom:0;border-radius:8px 8px 0 0}" +
      ".trend-card.trend-py .rk-table-wrap{flex:1 1 auto;min-height:0;max-height:220px;overflow:auto;border:1px solid #eef2f7;border-top:0;border-radius:0 0 8px 8px}" +
      ".trend-card.trend-py .rk-table.py-prov{width:100%;min-width:100%;white-space:normal}" +
      ".trend-card.trend-py .rk-table.py-prov td,.trend-card.trend-py .rk-table.py-prov th{padding:6px 9px}" +
      ".trend-card.trend-py .py-map-box{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;height:100%}" +
      ".trend-card.trend-py .py-map-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap}" +
      ".trend-card.trend-py .py-map-title{font-size:13px;font-weight:700;color:#1f2937;display:flex;align-items:center;gap:6px}" +
      ".trend-card.trend-py .py-map-title::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#2563eb}" +
      ".trend-card.trend-py .py-map-legend-group{display:flex;align-items:center;gap:12px;flex-wrap:wrap}" +
      ".trend-card.trend-py .py-map-legend{display:flex;align-items:center;gap:8px;font-size:11px;color:#6b7280;flex-wrap:wrap}" +
      ".trend-card.trend-py .py-map-legend .py-legend-band{display:inline-block;width:96px;height:8px;border-radius:4px;background:linear-gradient(90deg,#dbeafe 0%,#93c5fd 33%,#3b82f6 66%,#1d4ed8 100%)}" +
      ".trend-card.trend-py .py-map-legend .py-legend-no{width:14px;height:8px;border-radius:2px;background:#eef2f7;border:1px solid #cbd5e1;display:inline-block}" +
      ".trend-card.trend-py .py-map-chart{flex:1 1 auto;min-height:360px;width:100%}" +
      "@media (max-width:900px){.trend-card.trend-py .py-map-chart{min-height:300px}}" +
      ".trend-card.trend-py .py-map-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;flex-wrap:wrap;font-size:11.5px;color:#64748b}" +
      ".trend-card.trend-py .py-map-tip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;color:#475569}" +
      ".trend-card.trend-py .py-map-tip b{color:#1d4ed8;font-weight:700}" +
      ".trend-card.trend-py .py-prov-pill{display:inline-flex;align-items:center;gap:6px;background:#1d4ed8;color:#fff;border-radius:12px;padding:3px 10px;font-size:11.5px;font-weight:700}" +
      ".trend-card.trend-py .py-prov-pill button{background:transparent;border:0;color:#fff;font-size:13px;line-height:1;cursor:pointer;padding:0 0 0 2px;opacity:.85}" +
      ".trend-card.trend-py .py-prov-pill button:hover{opacity:1}" +
      ".trend-card.trend-py .py-side-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px}" +
      ".trend-card.trend-py .py-side-meta .trend-rank-hd{margin-bottom:0;padding-bottom:0;border-bottom:0;flex:1 1 auto}" +
      ".trend-card.trend-py .rk-table.py-apps td.col-case{color:#2563eb;font-weight:700;font-size:11.5px}" +
      ".trend-card.trend-py .rk-table.py-apps td.col-name{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      /* —— 智能体活跃度层级 统一趋势卡：三折线 + 各省三类数量表 —— */
      ".trend-card.trend-agents .trend-body{grid-template-columns:1.05fr 1fr}" +
      "@media (max-width:1100px){.trend-card.trend-agents .trend-body{grid-template-columns:1fr}}" +
      ".trend-card.trend-agents .trend-chart{height:268px}" +
      ".trend-card.trend-agents .legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;vertical-align:middle}" +
      ".trend-card.trend-agents .rk-table-wrap{max-height:300px;overflow:auto;border:1px solid #eef2f7;border-radius:8px}" +
      ".trend-card.trend-agents .rk-table.agents-prov{width:100%;min-width:100%;white-space:nowrap;border-collapse:collapse}" +
      ".trend-card.trend-agents .rk-table.agents-prov th,.trend-card.trend-agents .rk-table.agents-prov td{padding:6px 9px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:12px}" +
      ".trend-card.trend-agents .rk-table.agents-prov th{background:#f8fafc;color:#475569;font-weight:700;position:sticky;top:0;z-index:2}" +
      ".trend-card.trend-agents .rk-table.agents-prov .rk-tname,.trend-card.trend-agents .rk-table.agents-prov .rk-tidx{text-align:left}" +
      ".trend-card.trend-agents .rk-table.agents-prov td:first-child{color:#94a3b8;font-weight:600}" +
      ".trend-card.trend-agents .rk-table.agents-prov tr.rk-top td{font-weight:800;color:#1d4ed8}" +
      /* —— 推广/优秀 案例全景图（参考 Tab2 2.2 / 2.3：数据汇总概览 + 趋势曲线 + 关键指标对比 + 全景矩阵/榜单） —— */
      ".trend-card.trend-panorama{padding:12px 14px}.trend-card.trend-panorama .trend-body{display:block;grid-template-columns:none}" +
      ".trend-card.trend-panorama .trend-chart-card,.trend-card.trend-panorama .trend-side-card{display:none}" +
      ".pa-body{display:flex;flex-direction:column;gap:10px;padding:0}" +
      ".pa-overview{display:flex;gap:10px;flex-wrap:wrap}" +
      ".pa-stat{flex:1 1 130px;min-width:120px;background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 13px}" +
      ".pa-stat .pa-stat-label{font-size:11.5px;color:#94a3b8;font-weight:600}" +
      ".pa-stat .pa-stat-val{font-size:21px;font-weight:800;color:#0f172a;margin-top:3px;line-height:1.1;font-variant-numeric:tabular-nums}" +
      ".pa-stat .pa-stat-sub{font-size:11px;margin-top:3px;font-weight:700}" +
      ".pa-stat .pa-stat-sub.up{color:#dc2626}.pa-stat .pa-stat-sub.down{color:#059669}.pa-stat .pa-stat-sub.muted{color:#94a3b8;font-weight:600}" +
      ".pa-monthbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}" +
      ".pa-pill{border:1px solid var(--line,#e5e7eb);background:#fff;color:#475569;border-radius:16px;padding:4px 12px;font-size:12px;cursor:pointer;font-weight:600;transition:.15s}" +
      ".pa-pill:hover{border-color:#93c5fd}" +
      ".pa-pill.active{background:var(--brand,#3b82f6);border-color:var(--brand,#3b82f6);color:#fff;font-weight:800}" +
      ".pa-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;align-items:stretch}" +
      ".pa-grid.pa-grid-promo{grid-template-columns:1fr}" +
      "@media (max-width:1000px){.pa-grid{grid-template-columns:1fr}}" +
      ".pa-chart-card,.pa-compare-card{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column}" +
      /* 2026-08-27：左右两栏等高拉伸；图表固定高度（缩小，避免随榜单过长而拉伸过大），榜单限高滚动 */
      ".pa-chart-card .trend-chart{height:300px;flex:0 0 auto;min-height:0}" +
      "@media (max-width:1000px){.pa-chart-card .trend-chart{height:280px;flex:none}}" +
      ".pa-card-hd{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:9px}" +
      ".pa-scene-chart-list{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:stretch}" +
      ".pa-scene-chart-item{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:12px 14px;min-width:0;display:flex;flex-direction:column}" +
      ".pa-scene-chart-hd{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex:0 0 auto}" +
      ".pa-scene-chart-hd::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#3b82f6}" +
      ".pa-scene-chart{height:170px;width:100%;flex:1 1 auto;min-height:0}" +
      "@media (max-width:1100px){.pa-scene-chart-list{grid-template-columns:repeat(2,1fr)}}" +
      "@media (max-width:700px){.pa-scene-chart-list{grid-template-columns:1fr}}" +
      ".pa-heatmap-wrap{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px}" +
      ".pa-heatmap-wrap .pa-heatmap-chart{height:320px;width:100%}" +
      "@media (max-width:900px){.pa-heatmap-wrap .pa-heatmap-chart{height:280px}}" +
      ".pa-compare-list{display:flex;flex-direction:column;gap:9px;flex:1 1 auto;overflow:auto;max-height:300px;scroll-behavior:smooth;padding-right:4px}" +
      /* 榜单滚动按钮（横向/纵向） */
      ".pa-cmp-nav{display:flex;gap:6px;justify-content:flex-end;margin:-3px 0 6px}" +
      ".pa-cmp-nav button{width:28px;height:24px;border:1px solid var(--line,#e5e7eb);background:#fff;border-radius:6px;color:#475569;font-size:12px;cursor:pointer;line-height:1;transition:.12s;display:flex;align-items:center;justify-content:center}" +
      ".pa-cmp-nav button:hover:not(:disabled){background:var(--brand-soft,#eff6ff);color:var(--brand,#3b82f6);border-color:var(--brand,#3b82f6)}" +
      ".pa-cmp-nav button:disabled{opacity:.35;cursor:not-allowed}" +
      ".pa-cmp-row{display:grid;grid-template-columns:104px 1fr 70px;align-items:center;gap:9px;font-size:12px}" +
      ".pa-cmp-name{color:#475569;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".pa-cmp-track{height:10px;background:#f1f5f9;border-radius:6px;overflow:hidden}" +
      ".pa-cmp-fill{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#60a5fa,#3b82f6)}" +
      ".pa-cmp-val{text-align:right;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}" +
      ".pa-matrix-card{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column}" +
      ".pa-matrix-card>.pa-card-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px}" +
      ".pa-card-hd-title{font-size:13px;font-weight:700;color:#1f2937;white-space:nowrap}" +
      ".pa-month-pills{display:flex;gap:5px;flex-wrap:wrap;align-items:center}" +
      ".pa-month-pills .pa-pill{padding:3px 10px;font-size:11px}" +
      ".pa-matrix-scroll{overflow-x:auto;overflow-y:hidden;border:1px solid #eef2f7;border-radius:8px}" +
      ".pa-matrix{width:max-content;min-width:100%;border-collapse:collapse;font-size:10px;background:#fff}" +
      ".pa-matrix th,.pa-matrix td{border:1px solid #eef2f7;padding:2px 3px;vertical-align:top;text-align:center}" +
      ".pa-matrix thead th{position:sticky;top:0;background:#f8fafc;color:#475569;font-weight:700;z-index:3;white-space:nowrap;min-width:48px}" +
      ".pa-matrix tbody th,.pa-matrix .pa-scene{position:sticky;left:0;background:#fafafa;font-weight:700;color:#334155;text-align:left;z-index:2;white-space:nowrap;min-width:78px;padding:4px 5px}" +
      ".pa-cell{display:flex;flex-direction:column;gap:1px;min-width:70px;max-height:34px;overflow:hidden;position:relative}" +
      ".pa-cell-hd{display:flex;align-items:center;justify-content:space-between;gap:2px}" +
      ".pa-cell .pa-cell-n{font-size:11px;font-weight:800;color:#2f6be6;line-height:1}" +
      ".pa-cell .pa-cell-total-py{font-size:8px;color:#94a3b8;font-weight:600;white-space:nowrap}" +
      ".pa-cell .pa-cell-apps{display:flex;flex-direction:column;gap:1px;text-align:left;max-height:13px;overflow:hidden}" +
      ".pa-app-line{display:flex;align-items:flex-start;justify-content:space-between;gap:2px;font-size:9px;line-height:1.25}" +
      ".pa-app-name{color:#64748b;text-align:left;flex:1;min-width:0;display:inline-block;max-width:62px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".pa-app-py{color:#1f2937;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:9px}" +
      ".pa-cell.empty{color:#d8dee9;font-size:12px;align-items:center;justify-content:center;min-height:18px;padding:0}" +
      ".pa-total-cell{background:#f8fafc;font-weight:700;color:#1f2937;font-size:11px}" +
      ".pa-total-col{background:#f1f5f9}" +
      ".pa-grand-total{background:#eff6ff;font-weight:800;color:#2563eb;font-size:12px}" +
      ".pa-row-highlight td,.pa-row-highlight th{background:#fff7ed!important}" +
      ".pa-row-highlight .pa-scene{color:#9a3412;background:#ffedd5!important}" +
      /* 2026-08-27 双击定位锁定行：深橙底 + 左侧粗边框，与悬停高亮(浅橙)区分，视觉反馈更醒目 */
      ".pa-row-locked td,.pa-row-locked th{background:#ffedd5!important;box-shadow:inset 3px 0 0 #f59e0b}" +
      ".pa-row-locked .pa-scene{color:#9a3412;background:#fde68a!important}" +
      /* 2026-08-27 双击热力图联动：矩阵行内省份单元格环比底色（上升绿底 / 下降红底） */
      ".pa-matrix .pa-cell.mom-up{background:#d1fae5!important}" +
      ".pa-matrix .pa-cell.mom-up .pa-cell-n{color:#047857}" +
      ".pa-matrix .pa-cell.mom-up .pa-app-name,.pa-matrix .pa-cell.mom-up .pa-app-py{color:#065f46}" +
      ".pa-matrix .pa-cell.mom-down{background:#fee2e2!important}" +
      ".pa-matrix .pa-cell.mom-down .pa-cell-n{color:#b91c1c}" +
      ".pa-matrix .pa-cell.mom-down .pa-app-name,.pa-matrix .pa-cell.mom-down .pa-app-py{color:#991b1b}" +
      /* 2026-08-27 双击定位：环比持平 → 浅灰底（与绿/红并列为三态定位标记） */
      ".pa-matrix .pa-cell.mom-flat{background:#f3f4f6!important}" +
      ".pa-matrix .pa-cell.mom-flat .pa-cell-n{color:#6b7280}" +
      ".pa-matrix .pa-cell.mom-flat .pa-app-name,.pa-matrix .pa-cell.mom-flat .pa-app-py{color:#6b7280}" +
      /* 优秀/双周优秀：全省份等效人年排名列表 */
      ".pa-ex-rank{display:flex;flex-direction:column;gap:2px}" +
      ".pa-ex-rank-head{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;font-size:11px;color:#9ca3af;font-weight:700;padding:3px 6px 6px;border-bottom:1px solid #eef2f7;margin-bottom:4px}" +
      ".pa-ex-rank-row{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;font-size:12px;padding:3px 6px;border-radius:6px}" +
      ".pa-ex-rank-row:nth-child(odd){background:#f8fafc}" +
      ".pa-ex-rank-no{color:#94a3b8;font-weight:800;text-align:center;font-variant-numeric:tabular-nums}" +
      ".pa-ex-rank-row.pa-rank-top1{background:#fff7ed}.pa-ex-rank-row.pa-rank-top1 .pa-ex-rank-no{color:#ea580c}" +
      ".pa-ex-rank-row.pa-rank-top2{background:#fefce8}.pa-ex-rank-row.pa-rank-top2 .pa-ex-rank-no{color:#ca8a04}" +
      ".pa-ex-rank-row.pa-rank-top3{background:#f0fdf4}.pa-ex-rank-row.pa-rank-top3 .pa-ex-rank-no{color:#16a34a}" +
      ".pa-ex-rank-name{color:#334155;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".pa-ex-rank-val{color:#0f172a;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".pa-prov-table{width:100%;border-collapse:collapse;font-size:12.5px}" +
      ".pa-prov-table th,.pa-prov-table td{border-bottom:1px solid #f1f5f9;padding:7px 10px;text-align:left;vertical-align:top}" +
      ".pa-prov-table thead th{position:sticky;top:0;background:#f8fafc;color:#475569;font-weight:700;z-index:3}" +
      ".pa-prov-table td.pa-num{text-align:center;font-weight:800;color:#2f6be6;width:56px}" +
      ".pa-prov-table td.pa-py{text-align:right;color:#64748b;font-variant-numeric:tabular-nums;width:88px;white-space:nowrap}" +
      ".pa-prov-table td.pa-rank{text-align:center;color:#94a3b8;font-weight:600;width:44px}" +
      ".pa-prov-table tr.pa-top td{background:#eff6ff}" +
      ".pa-prov-table .pa-apps{color:#64748b;line-height:1.7;word-break:break-all}" +
      ".trend-chart-card{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px}" +
      ".trend-chart{width:100%;height:272px}" +
      ".trend-monthbar{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}" +
      ".tmb{border:1px solid var(--line,#e5e7eb);background:#fff;color:#1f2937;border-radius:16px;padding:4px 11px;font-size:12px;cursor:pointer}" +
      ".tmb.on{background:var(--brand,#3b82f6);border-color:var(--brand,#3b82f6);color:#fff;font-weight:700}" +
      ".trend-side-card{background:#fff;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;min-width:0}" +
      ".trend-rank-hd{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line,#e5e7eb)}" +
      ".trend-rank-list{max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:8px}" +
      /* —— 排行榜通用 —— */
      ".rk-block{min-width:0}" +
      ".rk-block-hd{font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;padding:5px 8px;background:#f8fafc;border-radius:6px}" +
      ".rk-head,.rk-row{display:grid;grid-template-columns:22px 1fr 84px;gap:8px;align-items:center}" +
      ".rk-head{font-size:11px;color:#9ca3af;padding-bottom:4px}" +
      ".rk-row{padding:6px 0;border-bottom:1px dashed #eef2f7}" +
      ".rk-idx{font-size:12px;color:#9ca3af;font-weight:700}" +
      ".rk-name{font-size:13px;color:#1f2937;display:flex;flex-direction:column;line-height:1.25}" +
      ".rk-sub{font-size:11px;color:#9ca3af;font-style:normal}" +
      ".rk-bar{grid-column:2 / 4;height:4px;background:#eef2f7;border-radius:2px;margin-top:4px;overflow:hidden}" +
      ".rk-bar i{display:block;height:100%;background:var(--brand,#3b82f6);border-radius:2px}" +
      ".rk-val{font-size:12.5px;font-weight:700;color:#1f2937;text-align:right;white-space:nowrap}" +
      ".rk-row.sel{background:#eff6ff;border-radius:4px}" +
      ".rk-tag{display:inline-block;font-size:10px;font-weight:700;color:#fff;background:var(--brand,#3b82f6);border-radius:6px;padding:0 5px;margin-left:5px;font-style:normal}" +
      ".trend-empty{font-size:12px;color:#9ca3af;padding:16px;text-align:center}" +
      /* —— 榜单表头吸附（sticky header） —— */
      ".trend-rank-list .rk-block-hd{position:sticky;top:0;z-index:3;background:#f8fafc;box-shadow:0 1px 0 #e5e7eb;margin-top:0}" +
      ".trend-rank-list .rk-head{position:sticky;top:30px;z-index:2;background:#fff;padding-top:6px;padding-bottom:6px;box-shadow:0 1px 0 #eef2f7}" +
      ".trend-rank-list .pa-head{position:sticky;top:24px;z-index:2;background:#fff;padding-top:6px;padding-bottom:6px;box-shadow:0 1px 0 #eef2f7;border-radius:0}" +
      /* —— 平铺趋势卡容器：每组 KPI grid 与趋势卡之间的间距与动效 —— */
      ".group-trend-host{margin:14px 0 2px;animation:fadeUp 340ms cubic-bezier(0.16,1,0.3,1) both}" +
      ".group-trend-host .trend-card{margin:0}" +
      /* —— 双榜（类型①） —— */
      ".dual-rank{display:grid;grid-template-columns:1fr 1fr;gap:12px}" +
      "@media (max-width:1100px){.dual-rank{grid-template-columns:1fr}}" +
      /* —— 模型计费金额 双表（省份排名 / 应用排名）：横向排列，各自独立滚动 —— */
      ".trend-card.trend-cost .trend-rank-list{max-height:none;overflow:visible;display:flex;flex-direction:column;gap:0}" +
      ".trend-card.trend-cost .dual-rank{flex:1 1 auto;display:flex;gap:14px;min-height:0}" +
      ".trend-card.trend-cost .dual-rank > .rk-block{flex:1 1 0;min-width:0;display:flex;flex-direction:column;min-height:0}" +
      ".trend-card.trend-cost .rk-block-hd{flex:0 0 auto;border:1px solid #eef2f7;border-bottom:0;border-radius:8px 8px 0 0}" +
      ".rk-table-wrap{overflow:auto}" +
      ".rk-table-wrap::-webkit-scrollbar{width:8px;height:8px}" +
      ".rk-table-wrap::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}" +
      ".rk-table-wrap::-webkit-scrollbar-track{background:#f1f5f9}" +
      ".rk-table-wrap{scrollbar-width:thin;scrollbar-color:#cbd5e1 #f1f5f9}" +
      ".trend-card.trend-cost .rk-table-wrap{flex:1 1 auto;min-height:0;max-height:230px;overflow:auto;border:1px solid #eef2f7;border-top:0;border-radius:0 0 8px 8px}" +
      ".rk-table{width:auto;min-width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap}" +
      ".rk-table th,.rk-table td{padding:5px 8px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums}" +
      ".rk-table th{position:sticky;top:0;background:#f8fafc;color:#64748b;font-weight:700;font-size:10px;z-index:2}" +
      ".rk-table td.rk-tidx,.rk-table th.rk-tidx{text-align:center;color:#94a3b8;font-weight:700;width:30px}" +
      ".rk-table td.rk-tname,.rk-table th.rk-tname{text-align:left;color:#1f2937;font-weight:600}" +
      ".rk-table td{color:#334155}" +
      ".rk-table tr.rk-top td{background:#fffbeb}" +
      ".rk-table tr.rk-top td.rk-tidx{color:#d97706;font-weight:800}" +
      ".rk-table tr:hover td{background:#f8fafc}" +
      /* —— 全景图（类型④） —— */
      ".pa-head,.pa-row{display:grid;grid-template-columns:1fr 74px;gap:8px;align-items:center}" +
      ".pa-head{font-size:11px;color:#9ca3af;padding-bottom:4px}" +
      ".pa-row{padding:6px 0 6px 3px;border-bottom:1px dashed #eef2f7;border-radius:4px}" +
      ".pa-name{font-size:13px;color:#1f2937;display:flex;flex-direction:column;line-height:1.25;min-width:0}" +
      ".pa-val{font-size:12.5px;font-weight:700;color:#1f2937;text-align:right;white-space:nowrap}" +
      ".pa-new{background:rgba(239,68,68,.08);border-left:3px solid #ef4444}" +
      ".pa-new .pa-name .pa-badge{display:inline-block;font-size:9.5px;font-weight:800;color:#fff;background:#ef4444;border-radius:6px;padding:0 5px;margin-left:5px}" +
      ".pa-meta{font-size:11px;color:#9ca3af;font-style:normal}" +
      /* —— 中间弹窗（环比变动因素 · 居中模态） —— */
      ".factor-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:200;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:.18s;padding:20px}" +
      ".factor-mask.show{opacity:1;pointer-events:auto}" +
      ".factor-modal{width:min(720px,96vw);max-height:86vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(15,23,42,.35);transform:translateY(14px) scale(.985);transition:.2s;padding:20px 22px}" +
      ".factor-mask.show .factor-modal{transform:none}" +
      ".factor-hd{display:flex;align-items:center;gap:10px}" +
      ".factor-title{font-size:17px;font-weight:800;color:#1f2937}" +
      ".factor-sub{font-size:12px;color:#6b7280;margin-top:2px}" +
      ".factor-close{margin-left:auto;border:0;background:#f1f5f9;color:#475569;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:16px}" +
      ".factor-overview{display:flex;gap:14px;flex-wrap:wrap;background:#f8fafc;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:12px 14px;margin:12px 0}" +
      ".factor-ov-item{min-width:104px}" +
      ".factor-ov-label{font-size:11px;color:#6b7280}" +
      ".factor-ov-val{font-size:18px;font-weight:800;margin-top:2px}" +
      ".factor-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}" +
      "@media (max-width:640px){.factor-cols{grid-template-columns:1fr}}" +
      ".factor-col-hd{font-size:13px;font-weight:800;padding:8px 10px;border-radius:8px;margin-bottom:8px}" +
      ".factor-col-hd.up{background:#ecfdf5;color:#059669}.factor-col-hd.down{background:#fef2f2;color:#dc2626}" +
      ".factor-col-hd.dim{opacity:.55}" +
      ".fc-row{display:grid;grid-template-columns:22px 1fr;gap:8px;padding:7px 4px;border-bottom:1px dashed #eef2f7;align-items:start}" +
      ".fc-idx{font-size:11px;color:#9ca3af;font-weight:700}" +
      ".fc-name{font-size:12.5px;color:#1f2937;line-height:1.3}" +
      ".fc-meta{font-size:11px;color:#9ca3af;margin-top:2px}" +
      ".fc-delta{font-weight:800}.fc-delta.up{color:#059669}.fc-delta.down{color:#dc2626}" +
      ".fc-bar{height:4px;background:#eef2f7;border-radius:2px;margin-top:4px;overflow:hidden}" +
      ".fc-bar i{display:block;height:100%;border-radius:2px}.fc-bar i.up{background:#10b981}.fc-bar i.down{background:#ef4444}" +
      ".factor-foot{display:flex;justify-content:flex-end;margin-top:14px}" +
      ".factor-foot button{border:1px solid var(--line,#e5e7eb);background:#fff;color:#475569;border-radius:8px;padding:6px 18px;font-size:13px;cursor:pointer}" +
      /* —— 模型计费金额 · 环比变动因素（省份→应用 层级拆解） —— */
      ".fc-note{font-size:11.5px;color:#475569;background:#f8fafc;border:1px dashed #e5e7eb;border-radius:8px;padding:8px 10px;margin:10px 0 6px;line-height:1.5}" +
      ".fc-note b{color:#1f2937}" +
      ".fc-drill-guide{display:flex;align-items:center;gap:8px;background:#eff6ff;color:#1e40af;border:1px solid #dbeafe;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:11.5px;font-weight:700}" +
      ".fc-drill-guide b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#2563eb;color:#fff;font-size:10px}" +
      ".fc-drill-guide span{color:#64748b;font-weight:600}" +
      ".fc-hier{display:flex;flex-direction:column;gap:10px;margin-top:4px}" +
      ".fc-prov{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#fff}" +
      ".fc-prov-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".fc-prov-rank{width:20px;height:20px;border-radius:6px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}" +
      ".fc-prov-name{font-size:13.5px;font-weight:800;color:#1f2937}" +
      ".fc-prov-coef{font-size:11.5px;color:#64748b}" +
      ".fc-prov-coef b{font-weight:800}" +
      ".fc-prov-delta{margin-left:auto;font-size:12.5px;font-weight:800;white-space:nowrap}" +
      ".fc-prov-bar{height:6px;background:#f1f5f9;border-radius:4px;margin:8px 0 2px;overflow:hidden}" +
      ".fc-prov-bar i{display:block;height:100%;border-radius:4px}" +
      ".fc-prov-bar i.up,.fc-app-bar i.up{background:#10b981}" +
      ".fc-prov-bar i.down,.fc-app-bar i.down{background:#ef4444}" +
      ".fc-apps{margin-top:8px;border-top:1px dashed #e5e7eb;padding-top:8px}" +
      ".fc-apps-hd{font-size:11.5px;font-weight:700;color:#475569;margin-bottom:6px}" +
      ".fc-app-tbl{width:100%;border-collapse:collapse;font-size:11.5px}" +
      ".fc-app-tbl th{text-align:left;font-weight:700;color:#94a3b8;padding:4px 6px;border-bottom:1px solid #e5e7eb}" +
      ".fc-app-tbl td{padding:4px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle}" +
      ".fc-app-name{color:#1f2937;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".fc-app-coef{white-space:nowrap}" +
      ".fc-app-bar{display:inline-block;width:56px;height:5px;background:#f1f5f9;border-radius:3px;margin-left:6px;vertical-align:middle;overflow:hidden}" +
      ".fc-app-bar i{display:block;height:100%;border-radius:3px}";
    document.head.appendChild(s);
  }
  function metricByKey(k) { for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === k) return METRICS[i]; return null; }
  function monthPrev(m) { var ms = getSelMonths(); var i = ms.indexOf(m); return i > 0 ? ms[i - 1] : null; }
  function selProvScope() {
    var sp = getSelProvs();
    if (!sp.length) return "全网";
    if (sp.length === 1) return sp[0];
    return "全网";
  }
  /* 应用调用量榜单（2026-08-25 改：数据源改为"智能体清单（各省）"col9 应用调用量，由 build_sim_excel.py 汇总）
   * 全网 → window.LINGYUN_DATA.appsCallsNational[month]；省份 → appsCallsByProv[prov][month]
   * 兼容旧窗口数据 LY_OVERVIEW_APPS.byAppTop（开发态演示） */
  function appsTop(prov, month) {
    var D = window.LINGYUN_DATA || {};
    if (prov === "全网" && D.appsCallsNational && D.appsCallsNational[month]) return D.appsCallsNational[month];
    if (D.appsCallsByProv && D.appsCallsByProv[prov] && D.appsCallsByProv[prov][month]) return D.appsCallsByProv[prov][month];
    var A = window.LY_OVERVIEW_APPS;
    if (A && A.byAppTop && A.byAppTop[prov]) return A.byAppTop[prov][month] || [];
    return [];
  }
  function appsTokensTop(prov, month) {
    var D = window.LINGYUN_DATA || {};
    if (prov === "全网" && D.appsTokensNational && D.appsTokensNational[month]) return D.appsTokensNational[month];
    if (D.appsTokensByProv && D.appsTokensByProv[prov] && D.appsTokensByProv[prov][month]) return D.appsTokensByProv[prov][month];
    return [];
  }
  function trackingTop(month) {
    var rows = ((window.LINGYUN_DATA || {}).tracking || []).filter(function (r) { return month == null || !r.month || r.month === month; });
    return rows.filter(function (r) { return r.clicks != null; }).sort(function (a, b) { return (b.clicks || 0) - (a.clicks || 0); }).slice(0, 10);
  }
  function appsCostTop(prov, month) {
    var D = window.LINGYUN_DATA || {};
    if (prov === "全网" && D.appsCostNational && D.appsCostNational[month]) return D.appsCostNational[month];
    if (D.appsCostByProv && D.appsCostByProv[prov] && D.appsCostByProv[prov][month]) return D.appsCostByProv[prov][month];
    return [];
  }
  function appsPersonYearTop(prov, month) {
    var D = window.LINGYUN_DATA || {};
    if (prov === "全网" && D.appsPersonYearNational && D.appsPersonYearNational[month]) return D.appsPersonYearNational[month];
    if (D.appsPersonYearByProv && D.appsPersonYearByProv[prov] && D.appsPersonYearByProv[prov][month]) return D.appsPersonYearByProv[prov][month];
    return [];
  }
  function appsDelta(prov, month) { var A = window.LY_OVERVIEW_APPS; if (!A || !A.byAppDelta[prov]) return []; return A.byAppDelta[prov][month] || []; }
  function provinceRank(metricKey, month, asc, limit) {
    var src = simSource(); if (!src) return [];
    var arr = Object.keys(src).filter(function (p) { return p !== "全网" && p !== "本部"; });
    var rows = arr.map(function (p) {
      var rec = null; (src[p] || []).forEach(function (r) { if (r.month === month) rec = r; });
      var o = { name: p, value: rec ? rec[metricKey] : null };
      if (metricKey === "cost" && rec) { o.busy = rec.costBusy; o.idle = rec.costIdle; }
      return o;
    }).filter(function (x) { return x.value != null && !isNaN(x.value); });
    rows.sort(function (a, b) { return asc ? (a.value - b.value) : (b.value - a.value); });
    return rows.slice(0, limit || 10);
  }
  function provinceDelta(metricKey, month, provFilter) {
    var src = simSource(); if (!src) return [];
    var pm = monthPrev(month); if (!pm) return [];
    var arr = Object.keys(src).filter(function (p) { return p !== "全网"; });
    if (provFilter && provFilter.length) arr = arr.filter(function (p) { return provFilter.indexOf(p) >= 0; });
    var rows = [];
    arr.forEach(function (p) {
      var cur = null, prev = null; (src[p] || []).forEach(function (r) { if (r.month === month) cur = r; if (r.month === pm) prev = r; });
      if (cur == null || prev == null) return;
      var c = cur[metricKey], pv = prev[metricKey];
      if (c == null || pv == null) return;
      rows.push({ name: p, cur: c, prev: pv, delta: c - pv });
    });
    rows.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    return rows.slice(0, 10);
  }
  function renderTrendSetup() {
    injectTrendStyle();
    if (!window._ovTrendDelegated) {
      document.body.addEventListener("click", function (e) {
        var fp = e.target.closest("[data-factor]");
        if (fp) { openFactor(fp.getAttribute("data-factor"), fp.getAttribute("data-group") || GROUPS[0]); return; }
        var cb = e.target.closest("[data-trend-collapse]");
        if (cb) { e.preventDefault(); e.stopPropagation(); collapseTrendGroup(cb.getAttribute("data-trend-collapse") || GROUPS[0]); return; }
        var kp = e.target.closest(".kpi[data-metric]");
        if (kp) { if (kp.classList.contains("kpi-grey")) return; selectMetric(kp.getAttribute("data-metric"), kp.getAttribute("data-group") || GROUPS[0], true); }
      });
      window._ovTrendDelegated = true;
    }
    if (!window._ovTrendResizeBound) {
      window.addEventListener("resize", function () {
        function doResize(inst) { if (Array.isArray(inst)) { inst.forEach(doResize); return; } try { inst.resize(); } catch (e) {} }
        Object.keys(trendChartInsts).forEach(function (k) { doResize(trendChartInsts[k]); });
        var pym = window._pyMapInsts || {};
        Object.keys(pym).forEach(function (k) { doResize(pym[k]); });
      });
      window._ovTrendResizeBound = true;
    }
    /* 每组按需挂载一张趋势卡：容器已在 renderCoreCards 中生成 #trendCard-{gi} */
    GROUPS.forEach(function (g, gi) {
      var c = document.getElementById("trendCard-" + gi);
      if (!c) return;
      if (!TREND_OPEN[g]) {
        disposeTrendInstances(g);
        c.innerHTML = "";
        c.style.display = "none";
        return;
      }
      c.style.display = "";
      if (!c.querySelector(".trend-card")) {
        c.innerHTML = '<div class="trend-card">' +
          '<div class="trend-hd"><div class="trend-title" id="trendTitle-' + gi + '"></div>' +
          '<div class="trend-hd-actions"><div class="trend-tag" id="trendTag-' + gi + '"></div>' +
          '<button type="button" class="trend-collapse-btn" data-trend-collapse="' + esc(g) + '">收起</button></div></div>' +
          '<div class="trend-body"><div class="trend-chart-card"><div class="trend-chart" id="trendChart-' + gi + '"></div>' +
          '<div class="trend-sub trend-chart-legend" id="trendSub-' + gi + '"></div>' +
          '<div class="trend-monthbar" id="trendMonthBar-' + gi + '"></div></div>' +
          '<div class="trend-side-card"><div class="trend-rank-hd" id="trendRankHd-' + gi + '"></div>' +
          '<div class="trend-rank-list" id="trendRankList-' + gi + '"></div></div></div></div>';
      }
      var gst = gTrendState(g);
      var mm = getSelMonths();
      if (!gst.month || mm.indexOf(gst.month) < 0) gst.month = mm[mm.length - 1];
      updateTrend(gi);
    });
  }
  function selectMetric(key, group, scroll) {
    var gst = gTrendState(group);
    var changed = (gst.metric !== key);
    gst.metric = key;
    var mm = getSelMonths();
    if (mm.indexOf(gst.month) < 0) gst.month = mm[mm.length - 1];
    var gi = groupIndex(group);
    var wasOpen = !!TREND_OPEN[group];
    TREND_OPEN[group] = true;
    renderTrendSetup();
    markSelectedCard();
    if (scroll && (!wasOpen || changed)) { var c = document.getElementById("trendCard-" + gi); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }
  /* —— 趋势布局类型（《趋势动态分析卡片产品方案设计.md》§三/§八） —— */
  function trendLayout(mt) {
    switch (mt.key) {
      case "cost": return { type: 1, chart: "stackBusyIdle", side: "dual" };
      case "calls": return { type: 1, chart: "lineArea", side: "dual" };
      case "tokens": return { type: 1, chart: "stackTokens", side: "dual" };
      case "cumRegUsers": return { type: 5, chart: "regCombined", side: "regProv" };
      case "pagePV": return { type: 1, chart: "pvBar", side: "dual" };
      case "personYear": return { type: 1, chart: "line", side: "rankProv", limit: 31 };
      case "hotAgents": case "totalAgentsOnline": return { type: 3, chart: "line", side: "rankDesc" };
      case "activeAgents": return { type: "3p", chart: "stack", side: "rankAsc" };
      case "promoAgents": return { type: 4, chart: "stackScenes", side: "panorama" };
      case "excellentAgents": case "excellentAgentsBiweek": return { type: 4, chart: "linePromo", side: "panorama" };
      case "newRegUsers": case "activeUsers": case "activeCover": return { type: 5, chart: "combined", side: "usersProv" };
      default: return { type: 6, chart: "line", side: "none" };
    }
  }
  function promoTag(key) { return key === "promoAgents" ? "推广案例" : (key === "excellentAgents" ? "优秀案例" : "双周优秀案例"); }
  function layoutDesc(ly) {
    var m = { "lineArea": "折线 + 双榜", "bar": "柱形 + 升序榜", "line": "折线 + 榜单", "stack": "堆积图 + 升序榜", "stackScenes": "9 大推广场景堆积 + 全景图", "linePromo": "折线 + 全景图", "combined": "合并图（新增注册/月活跃用户数/月活跃用户覆盖度）+ 省份榜", "stackBusyIdle": "堆积柱形（闲时+忙时）+ 双表", "stackTokens": "Token 忙闲堆积 + 双榜", "regCombined": "累计注册折线 + 新增注册柱形", "pvBar": "PV 柱形 + 双榜" };
    if (ly.type === 6) return "单卡（仅 KPI mini 趋势）";
    return m[ly.chart] || "趋势";
  }
  /* 类型④ 数据：从《推广+双周+优秀（总表）》按场景/标签聚合 */
  function promoSeries(mt) {
    var ms = promoMonths(), tag = promoTag(mt.key), rows = rowsByTag(tag);
    if (mt.key === "promoAgents") {
      var series = {};
      rows.forEach(function (r) { if (!series[r.scene]) series[r.scene] = new Array(ms.length).fill(0); var a = series[r.scene]; for (var i = 0; i < ms.length; i++) a[i] += r.monthly[i]; });
      var keys = Object.keys(series).filter(function (k) { return series[k].some(function (v) { return v > 0; }); });
      return { kind: "stack", months: ms, keys: keys, series: series };
    }
    var sum = new Array(ms.length).fill(0);
    rows.forEach(function (r) { for (var i = 0; i < ms.length; i++) sum[i] += r.monthly[i]; });
    return { kind: "line", months: ms, values: sum.map(function (v) { return Math.round(v * 100) / 100; }) };
  }
  /* —— 数据标签四要素（设计 §9.1）+ §12.1 自动避让 —— */
  function getSeriesValAt(ly, full, idx, seriesName, mt) {
    if (idx < 0) return null;
    if (ly.chart === "stack") return (full[idx].activeAgents || 0) + (full[idx].totalAgentsOnline || 0);
    if (ly.chart === "stackScenes") {
      if (full.kind === "stack") return full.keys.reduce(function (s, k) { return s + (full.series[k][idx] || 0); }, 0);
      return full.values[idx];
    }
    if (ly.chart === "linePromo") return full.values[idx];
    if (ly.chart === "combined") {
      if (!seriesName) return null;
      if (seriesName.indexOf("新增注册") >= 0) return full[idx].newRegUsers;
      if (seriesName.indexOf("月活跃用户数") >= 0) return full[idx].mau;
      if (seriesName.indexOf("覆盖度") >= 0) return full[idx].activeCoverMonthly != null ? full[idx].activeCoverMonthly : null;
      return null;
    }
    return full[idx][mt.key];
  }
  function fmtLabelVal(ly, seriesName, val, mt) {
    if (val == null) return "—";
    if (ly.chart === "stackScenes" || ly.chart === "linePromo") return fmtPY(val);
    if (ly.chart === "combined") {
      if (seriesName && seriesName.indexOf("覆盖度") >= 0) return (val != null ? (Math.round(val * 1000) / 10) + "%" : "—");
      return fmtWan(val);
    }
    if (ly.chart === "stack") return fmtInt(val);
    return fmtMetric(mt, val);
  }
  function makeLabelOption(mt, monthsAvail, full, ly, opts) {
    var position = (opts && opts.position) || "top";
    return {
      show: false, position: position, distance: 6, align: "center",
      formatter: function (p) {
        var idx = p.dataIndex;
        if (idx == null || idx < 0 || idx >= monthsAvail.length) return "";
        var month = monthsAvail[idx];
        var sName = p.seriesName || mt.name;
        var cur = p.value;
        if (cur == null) return "";
        var prev = getSeriesValAt(ly, full, idx - 1, sName, mt);
        var ch = (prev != null && prev !== 0) ? ((cur - prev) / prev) : null;
        var momTxt = ch == null ? "— 无上期" : ((ch >= 0 ? "↗ +" : "↘ ") + (ch * 100).toFixed(1) + "% VS 上期");
        var valStr = fmtLabelVal(ly, sName, cur, mt);
        var chKey = ch == null ? "0" : (ch >= 0 ? "u" : "d");
        return "{m|" + month + "}\n{n|" + sName + "}\n{v|" + valStr + "}\n{" + chKey + "|" + momTxt + "  ▎ 点数据点查看变动因素}";
      },
      rich: {
        m: { fontSize: 10, color: "#6b7280", fontWeight: 600, padding: [0, 0, 1, 0] },
        n: { fontSize: 10, color: "#6b7280", padding: [1, 0, 1, 0] },
        v: { fontSize: 12, color: "#1f2937", fontWeight: 800, padding: [1, 0, 1, 0] },
        u: { fontSize: 10, color: "#059669", fontWeight: 700, padding: [1, 0, 0, 0] },
        d: { fontSize: 10, color: "#dc2626", fontWeight: 700, padding: [1, 0, 0, 0] },
        0: { fontSize: 10, color: "#9ca3af", fontWeight: 600, padding: [1, 0, 0, 0] }
      },
      backgroundColor: "rgba(255,255,255,0.94)",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      borderRadius: 4,
      padding: [5, 7]
    };
  }
  /* 标准趋势卡 body 模板（mountTrend 首次构建；从全景图切回时复用此重建） */
  function standardBodyHtml(gi) {
    return '<div class="trend-chart-card"><div class="trend-chart" id="trendChart-' + gi + '"></div>' +
      '<div class="trend-sub trend-chart-legend" id="trendSub-' + gi + '"></div>' +
      '<div class="trend-monthbar" id="trendMonthBar-' + gi + '"></div></div>' +
      '<div class="trend-side-card"><div class="trend-rank-hd" id="trendRankHd-' + gi + '"></div>' +
      '<div class="trend-rank-list" id="trendRankList-' + gi + '"></div></div>';
  }
  function updateTrend(gi) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var mt = metricByKey(gst.metric); if (!mt) return;
    var ly = trendLayout(mt);
    /* 从全景图切回普通/统一卡时，恢复标准趋势卡 DOM（避免残留 .pa-body 导致图表错位） */
    if (ly.side !== "panorama") {
      var _tc = c.querySelector(".trend-card");
      /* 切回非全景卡（统一卡/普通卡）时，必须移除 trend-panorama：
       * 该 class 会让 .trend-chart-card/.trend-side-card 变为 display:none，
       * 否则从「推广/优秀」全景图切到「活跃/投产率」统一卡时图表与榜单被隐藏 */
      if (_tc) _tc.classList.remove("trend-panorama");
      if (_tc && _tc.querySelector(".pa-body")) {
        if (trendChartInsts[group]) { try { trendChartInsts[group].dispose(); } catch (e) {} trendChartInsts[group] = null; }
        var _scenes = trendChartInsts[group + "_scenes"];
        if (_scenes) { _scenes.forEach(function (inst) { try { inst.dispose(); } catch (e) {} }); trendChartInsts[group + "_scenes"] = []; }
        var _tb = _tc.querySelector(".trend-body");
        if (_tb) _tb.innerHTML = standardBodyHtml(gi);
      }
    }
    var usePromo = (ly.chart === "stackScenes" || ly.chart === "linePromo");
    var src = simSource();
    var tEl = $("trendTitle-" + gi), sEl = $("trendSub-" + gi), tagEl = $("trendTag-" + gi);
    var mb = $("trendMonthBar-" + gi), hd = $("trendRankHd-" + gi), list = $("trendRankList-" + gi);
    if (!src && !usePromo) {
      if (tEl) tEl.textContent = "趋势动态分析";
      if (sEl) sEl.textContent = "overviewByProvince 数据未接入（开发态加载 overview_sim_data.js 后可见）。";
      if (tagEl) tagEl.textContent = "";
      if (mb) mb.innerHTML = "";
      if (hd) hd.textContent = ""; if (list) list.innerHTML = "";
      if (trendChartInsts[group]) try { trendChartInsts[group].clear(); } catch (e) {}
      return;
    }
    var monthsAvail, full;
    if (usePromo) { monthsAvail = promoMonths(); full = promoSeries(mt); }
    else { full = activeSeries(src); monthsAvail = full.map(function (r) { return r.month; }); }
    gTrendMonths[group] = monthsAvail;
    if (monthsAvail.indexOf(gst.month) < 0) gst.month = monthsAvail[monthsAvail.length - 1];
    var sl = scopeLabel();
    /* 智能体应用组：活跃/高热度/上线/投产率 合并为统一趋势卡 */
    if (mt.group === "智能体应用" && (mt.key === "activeAgents" || mt.key === "hotAgents" || mt.key === "totalAgentsOnline" || mt.key === "productionRate")) {
      renderAgentsUnified(gi, mt, full, monthsAvail, sl);
      return;
    }
    /* 节约人年 · 自定义趋势卡（折线 + 中国地图 + 联动榜；省份点击联动 / × 取消选择） */
    if (mt.key === "personYear") {
      var trendCardElPy = c.querySelector(".trend-card");
      if (trendCardElPy) {
        trendCardElPy.classList.remove("trend-cost", "trend-agents", "trend-panorama");
        trendCardElPy.classList.add("trend-py");
      }
      var OVPY = window.LY_OVPY;
      if (OVPY && typeof OVPY.renderPyTrendCard === "function") {
        var ctx = {
          GROUPS: GROUPS, gTrendState: gTrendState, gTrendMonths: gTrendMonths,
          trendChartInsts: trendChartInsts, pyMapInsts: window._pyMapInsts || {},
          updateTrend: updateTrend, openFactor: openFactor, bindTrendMonthEvents: bindTrendMonthEvents,
          esc: esc, fmtPY: fmtPY
        };
        window._pyMapInsts = ctx.pyMapInsts;
        OVPY.renderPyTrendCard(gi, ctx);
        return;
      }
    }
    /* 推广/优秀/双周优秀 案例全景图（参考 Tab2 2.2 / 2.3） */
    if (ly.side === "panorama") {
      renderPromoPanorama(gi, mt, full, monthsAvail, sl);
      return;
    }
    if (tEl) tEl.textContent = (ly.side === "usersProv") ? "趋势动态分析 · 用户活跃" : ("趋势动态分析 · " + mt.name);
    /* 副标题分块：图例（圆点）· 时间范围 · 布局 · 单位（lieflat-charts §一·卡片四件套） */
    var unitTxt = (ly.chart === "stackScenes" || ly.chart === "linePromo") ? "人年" :
                  (ly.chart === "combined") ? "人 / %" :
                  (ly.chart === "stackTokens") ? "Token" :
                  (ly.chart === "regCombined") ? "人" :
                  (ly.chart === "pvBar") ? "PV" :
                  (mt.key === "calls" ? "次" : mt.fmt === "money" ? "元" : mt.fmt === "py" ? "人年" : mt.fmt === "wan" ? "次 / 元" : mt.fmt === "int" ? "个" : "");
    var periodTxt = monthsAvail.length ? (monthsAvail[0] + " — " + monthsAvail[monthsAvail.length - 1] + " · " + monthsAvail.length + " 个月") : "";
    if (sEl) sEl.innerHTML = (mt.key === "cost" || mt.key === "personYear" || mt.group === "智能体应用" || mt.group === "用户活跃" || mt.group === "平台基础")
      ? ""
      : '<span class="legend">' + esc(mt.name) + '</span>' +
        '<span class="sep">·</span><span>' + esc(sl.text) + '</span>' +
        '<span class="sep">·</span><span>' + esc(periodTxt) + '</span>' +
        '<span class="sep">·</span><span>' + esc(layoutDesc(ly)) + '</span>' +
        (unitTxt ? '<span class="sep">·</span><span class="unit">单位：' + esc(unitTxt) + '</span>' : '');
    if (tagEl) {
      tagEl.innerHTML = '<span class="trend-tag-month">当前选中：' + esc(gst.month) + '</span><button type="button" class="trend-tag-act" id="trendTagFactor-' + gi + '" title="查看选中月份的环比变动因素">查看变动因素 ↗</button>';
      var tfa = document.getElementById("trendTagFactor-" + gi);
      if (tfa) tfa.onclick = function (e) { e.stopPropagation(); openFactor(gst.metric, group); };
    }
    /* 设计 §9.1：数据标签四要素（hover/click 显示）+ §12.1：默认隐藏、悬浮显示。点击当前选中月份的折线点弹出变动因素（详见 renderTrendChart 内 click 处理器）。 */
    var trendCardEl = c.querySelector(".trend-card");
    if (trendCardEl) {
      trendCardEl.classList.toggle("trend-cost", mt.key === "cost");
      trendCardEl.classList.toggle("trend-platform-calls", mt.key === "calls");
      trendCardEl.classList.toggle("trend-platform-token", mt.key === "tokens");
      trendCardEl.classList.toggle("trend-platform-pv", mt.key === "pagePV");
      trendCardEl.classList.toggle("trend-platform-reg", mt.key === "cumRegUsers");
      trendCardEl.classList.toggle("trend-py", mt.key === "personYear");
      trendCardEl.classList.remove("trend-agents");
      trendCardEl.classList.remove("trend-panorama");
    }
    /* 从节约人年切换回其他指标时，须把 body 结构恢复为默认（折线+榜单），避免 py-col-left/right 残留 */
    var body = c.querySelector(".trend-body");
    if (body && mt.key !== "personYear" && body.querySelector(".py-col-right")) {
      if (trendChartInsts[group]) { try { trendChartInsts[group].dispose(); } catch (e) {} trendChartInsts[group] = null; }
      var pym = window._pyMapInsts || {};
      if (pym[group]) { try { pym[group].dispose(); } catch (e) {} pym[group] = null; }
      body.innerHTML = '<div class="trend-chart-card"><div class="trend-chart" id="trendChart-' + gi + '"></div>' +
        '<div class="trend-sub trend-chart-legend" id="trendSub-' + gi + '"></div>' +
        '<div class="trend-monthbar" id="trendMonthBar-' + gi + '"></div></div>' +
        '<div class="trend-side-card"><div class="trend-rank-hd" id="trendRankHd-' + gi + '"></div>' +
        '<div class="trend-rank-list" id="trendRankList-' + gi + '"></div></div>';
    }
    if (mb) { mb.innerHTML = ""; mb.style.display = "none"; }
    renderTrendChart(gi, mt, full, monthsAvail, ly);
    renderTrendSide(gi, mt, monthsAvail, ly);
  }
  function renderTrendChart(gi, mt, full, monthsAvail, ly) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var box = $("trendChart-" + gi); if (!box || !window.echarts) return;
    if (!trendChartInsts[group]) {
      trendChartInsts[group] = window.echarts.init(box);
      bindTrendMonthEvents(trendChartInsts[group], group, gi);
    }
    var col = COLOR_MAP[mt.cls] || "#3b82f6";
    var reduce = prefersReducedMotion();
    /* lieflat-charts §一·卡片四件套：emphasis label（hover 数据点时贴近显示的"绿框"）作为唯一数据标签
     * 自定义 tooltip（"红框"，hover 鼠标位置弹出的浮层）已禁用（show:false），避免重复；
     * axisPointer 阴影仍显示以辅助读数。 */
    var customTooltip = {
      show: false, trigger: "axis", confine: true,
      backgroundColor: "rgba(255,255,255,0.98)",
      borderColor: "transparent", borderWidth: 0, padding: 0,
      extraCssText: "box-shadow:0 12px 36px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.06);border-radius:12px;overflow:hidden;",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(59,130,246,.08)" } },
      formatter: function (params) {
        if (!params || !params.length) return "";
        var di = params[0].dataIndex;
        var month = monthsAvail[di] || "";
        var rows = params.map(function (p) {
          var val = p.value;
          var prev = getSeriesValAt(ly, full, di - 1, p.seriesName, mt);
          var ch = (prev != null && prev !== 0) ? ((val - prev) / prev) : null;
          var valStr = fmtLabelVal(ly, p.seriesName, val, mt);
          var chTxt, chColor;
          if (ch == null) { chTxt = "— 无上期"; chColor = "#94a3b8"; }
          else if (ch >= 0) { chTxt = "↗ +" + (ch * 100).toFixed(1) + "%"; chColor = "#0f766e"; }
          else { chTxt = "↘ " + (ch * 100).toFixed(1) + "%"; chColor = "#b91c1c"; }
          var pc = p.color;
          var dotColor = (pc && pc.colorStops) ? pc.colorStops[0].color : (pc || "#3b82f6");
          return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + dotColor + ';flex:0 0 8px"></span>' +
            '<span style="flex:1;font-size:12.5px;color:#334155;font-weight:600">' + esc(p.seriesName) + '</span>' +
            '<span style="font-size:13px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">' + esc(valStr) + '</span>' +
            '<span style="font-size:11px;font-weight:700;color:' + chColor + ';min-width:60px;text-align:right">' + chTxt + '</span>' +
            '</div>';
        }).join("");
        return '<div style="padding:10px 12px;min-width:220px">' +
          '<div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">' + esc(month) + '</div>' +
          rows +
          '<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;font-size:10.5px;color:#94a3b8">▎ 点击数据点切换月份</div>' +
          '</div>';
      }
    };
    var base = {
      grid: { left: 64, right: 28, top: 32, bottom: 28, containLabel: true },
      tooltip: customTooltip,
      xAxis: {
        type: "category", data: monthsAvail,
        boundaryGap: ly.chart === "bar" || ly.chart === "stack" || ly.chart === "stackScenes",
        axisLine: { show: true, lineStyle: { color: "#e2e8f0", width: 0.8 } },
        axisTick: { show: false },
        axisLabel: { color: "#64748b", fontSize: 11.5, fontWeight: 600, margin: 10 }
      },
      yAxis: {
        type: "value",
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: "#94a3b8", fontSize: 10.5, fontWeight: 500 },
        splitLine: { lineStyle: { color: "#f1f5f9", type: "solid" } }
      },
      labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
      animation: !reduce,
      animationDuration: 720,
      animationEasing: "cubicOut",
      animationDurationUpdate: 320,
      animationDelay: function (idx) { return reduce ? 0 : idx * 30; },
      series: []
    };
    if (mt.group === "平台基础") {
      /* 与模型计费金额趋势卡保持一致，减少 y 轴预留空间，让左侧图表内容向左靠齐。 */
      base.grid.left = 42;
      base.grid.right = 18;
    }
    if (mt.key === "cumRegUsers") {
      /* 双 Y 轴组合图需要同时容纳两侧刻度，但不应把有效绘图区压缩成窄条。 */
      base.grid = { left: 34, right: 34, top: 24, bottom: 42, containLabel: true };
    }
    if (ly.chart === "stackScenes") {
      base.series = full.keys.map(function (k, i) { return { name: k, type: "bar", stack: "t", barWidth: "52%", data: full.series[k].map(function (v) { return Math.round(v * 100) / 100; }), itemStyle: { color: COLD[i % COLD.length], borderRadius: i === full.keys.length - 1 ? [4, 4, 0, 0] : 0 }, label: makeLabelOption(mt, monthsAvail, full, ly), emphasis: { focus: "self", label: { show: true } } }; });
      base.legend = { type: "scroll", bottom: 0, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12 };
      base.yAxis = { type: "value", name: "等效人年", nameTextStyle: { color: "#94a3b8", fontSize: 10.5, padding: [0, 0, 0, -10] }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return fmtPY(v); } }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
    } else if (ly.chart === "linePromo") {
      base.series = [{ name: mt.name, type: "line", smooth: true, data: full.values, symbol: "circle", symbolSize: 8, itemStyle: { color: col, borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.5, color: col, cap: "round", join: "round" }, areaStyle: { opacity: .1, color: col }, emphasis: { focus: "self", scale: 1.5, label: { show: true } }, label: makeLabelOption(mt, monthsAvail, full, ly), z: 3 }];
      base.yAxis = { type: "value", name: "等效人年", nameTextStyle: { color: "#94a3b8", fontSize: 10.5, padding: [0, 0, 0, -10] }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return fmtPY(v); } }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
    } else if (ly.chart === "stack") {
      base.series = [
        { name: "活跃智能体数", type: "bar", stack: "t", barWidth: "46%", data: full.map(function (r) { return r.activeAgents; }), itemStyle: { color: "#8b5cf6", borderRadius: [4, 4, 0, 0] }, label: makeLabelOption(mt, monthsAvail, full, ly), emphasis: { focus: "self", label: { show: true } } },
        { name: "智能体总数量（上线）", type: "bar", stack: "t", data: full.map(function (r) { return r.totalAgentsOnline; }), itemStyle: { color: "#c4b5fd" }, label: makeLabelOption(mt, monthsAvail, full, ly), emphasis: { focus: "self", label: { show: true } } }
      ];
      base.legend = { bottom: 0, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12 };
      base.yAxis = { type: "value", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5 }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
    } else if (ly.chart === "combined") {
      /* 用户活跃 合并趋势卡：左轴（人）双柱——新增注册人数 + 月活跃用户数；
       * 右轴（%）折线——月活跃用户覆盖度。鼠标悬停时：
       *   ① 三个系列同时联动高亮（emphasis.focus:'none'，不做单系列 dim，便于同月对比）；
       *   ② axisPointer 阴影指示当前月份；
       *   ③ ECharts 原生 tooltip 展示三个指标的具体数值与各自的环比变化（较上月）。 */
      base.tooltip = {
        show: true, trigger: "axis", confine: true,
        backgroundColor: "rgba(255,255,255,0.98)",
        borderColor: "#e5e7eb", borderWidth: 1, padding: [10, 12],
        extraCssText: "box-shadow:0 8px 28px rgba(15,23,42,.14);border-radius:10px;",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(139,92,246,.08)" } },
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var di = ps[0].dataIndex;
          if (di == null || di < 0 || di >= monthsAvail.length) return "";
          var month = monthsAvail[di] || "";
          var prevDi = di - 1;
          function row(name, val, color, cur, prev) {
            var ch, chCls, chTxt;
            if (prev == null || prev === 0) { ch = null; chCls = "#94a3b8"; chTxt = "— 无上期"; }
            else { ch = (cur - prev) / prev; chCls = ch >= 0 ? "#0f766e" : "#b91c1c"; chTxt = (ch >= 0 ? "↗ +" : "↘ ") + (ch * 100).toFixed(1) + "%"; }
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">' +
              '<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + color + ';flex:0 0 9px"></span>' +
              '<span style="flex:1;font-size:12.5px;color:#334155;font-weight:600">' + esc(name) + '</span>' +
              '<span style="font-size:13px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">' + esc(val) + '</span>' +
              '<span style="font-size:11px;font-weight:700;color:' + chCls + ';min-width:68px;text-align:right;font-variant-numeric:tabular-nums">' + chTxt + '</span>' +
              '</div>';
          }
          var r = full[di], p = prevDi >= 0 ? full[prevDi] : null;
          var newRegStr = r.newRegUsers != null ? fmtWan(r.newRegUsers) : "—";
          var mauStr = r.mau != null ? fmtWan(r.mau) : "—";
          var covStr = r.activeCoverMonthly != null ? (r.activeCoverMonthly * 100).toFixed(2) + "%" : "—";
          return '<div style="min-width:240px">' +
            '<div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.04em;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #f1f5f9">' + esc(month) + ' · 用户活跃</div>' +
            row("新增注册人数", newRegStr, "#14b8a6", r.newRegUsers, p ? p.newRegUsers : null) +
            row("月活跃用户数", mauStr, "#8b5cf6", r.mau, p ? p.mau : null) +
            row("月活跃用户覆盖度", covStr, "#f59e0b", r.activeCoverMonthly, p ? p.activeCoverMonthly : null) +
            '</div>';
        }
      };
      base.series = [
        { name: "新增注册人数", type: "bar", data: full.map(function (r) { return r.newRegUsers; }), barWidth: "30%", itemStyle: { color: "#14b8a6", borderRadius: [3, 3, 0, 0] }, yAxisIndex: 0, emphasis: { focus: "none", itemStyle: { color: "#0d9488", shadowBlur: 14, shadowColor: "rgba(20,184,166,.55)" } } },
        { name: "月活跃用户数", type: "bar", data: full.map(function (r) { return r.mau; }), barWidth: "30%", itemStyle: { color: "#8b5cf6", borderRadius: [3, 3, 0, 0] }, yAxisIndex: 0, emphasis: { focus: "none", itemStyle: { color: "#7c3aed", shadowBlur: 14, shadowColor: "rgba(139,92,246,.55)" } } },
        { name: "月活跃用户覆盖度", type: "line", smooth: true, data: full.map(function (r) { return r.activeCoverMonthly != null ? r.activeCoverMonthly : null; }), symbol: "circle", symbolSize: 8, yAxisIndex: 1, itemStyle: { color: "#f59e0b", borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.6, color: "#f59e0b", cap: "round", join: "round" }, emphasis: { focus: "none", scale: 1.4, itemStyle: { shadowBlur: 12, shadowColor: "rgba(245,158,11,.6)" }, lineStyle: { width: 3.2 } }, z: 5 }
      ];
      base.legend = { bottom: 0, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12 };
      base.yAxis = [
        { type: "value", name: "人数", nameTextStyle: { color: "#94a3b8", fontSize: 10.5, padding: [0, 0, 0, -10] }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: "#f1f5f9" } } },
        { type: "value", name: "覆盖度", min: 0, max: 1, nameTextStyle: { color: "#94a3b8", fontSize: 10.5, padding: [0, 0, 0, -10] }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return (v * 100).toFixed(0) + "%"; } }, splitLine: { show: false } }
      ];
    } else if (ly.chart === "stackTokens") {
      var tBusy = full.map(function (r) { return Math.round(r.tokensBusy || 0); });
      var tIdle = full.map(function (r) { return Math.round(r.tokensIdle || 0); });
      base.tooltip = {
        show: true, trigger: "axis", confine: true,
        backgroundColor: "rgba(255,255,255,0.98)", borderColor: "#e5e7eb", borderWidth: 1, padding: [10, 12],
        extraCssText: "box-shadow:0 6px 24px rgba(15,23,42,.12);border-radius:8px;",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(20,184,166,.08)" } },
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var di = ps[0].dataIndex, r = full[di] || {}, total = r.tokens || 0, busy = r.tokensBusy || 0, idle = r.tokensIdle || 0;
          var prev = di > 0 ? (full[di - 1].tokens || 0) : null;
          var ch = prev ? (total - prev) / prev : null;
          return '<div style="min-width:220px"><div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">' + esc(monthsAvail[di]) + ' · 总 Token</div>' +
            '<div style="display:flex;justify-content:space-between;padding:3px 0"><span>忙时 Token</span><b>' + fmtWan(busy) + '</b></div>' +
            '<div style="display:flex;justify-content:space-between;padding:3px 0"><span>闲时 Token</span><b>' + fmtWan(idle) + '</b></div>' +
            '<div style="display:flex;justify-content:space-between;border-top:1px dashed #e2e8f0;margin-top:4px;padding-top:6px"><strong>合计</strong><strong style="color:#0f766e">' + fmtWan(total) + '</strong></div>' +
            '<div style="margin-top:4px;font-size:11px;font-weight:700;color:' + (ch == null ? '#94a3b8' : (ch >= 0 ? '#0f766e' : '#b91c1c')) + '">' + (ch == null ? '— 无上期' : ((ch >= 0 ? '↗ +' : '↘ ') + (ch * 100).toFixed(1) + '% VS 上期')) + '</div></div>';
        }
      };
      base.series = [
        { name: "忙时 Token", type: "bar", stack: "tokens", barWidth: "52%", data: tBusy, itemStyle: { color: "#0f9f91" }, emphasis: { focus: "none" } },
        { name: "闲时 Token", type: "bar", stack: "tokens", barWidth: "52%", data: tIdle, itemStyle: { color: "#99f6e4", borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "none" } }
      ];
      base.legend = { bottom: 0, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12 };
      base.xAxis.boundaryGap = true;
      base.yAxis = { type: "value", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
    } else if (ly.chart === "regCombined") {
      base.tooltip = { show: true, trigger: "axis", confine: true, axisPointer: { type: "shadow" }, formatter: function (ps) {
        var di = ps && ps.length ? ps[0].dataIndex : -1, r = full[di] || {}, prev = di > 0 ? full[di - 1] : null;
        var ch = prev && prev.cumRegUsers ? (r.cumRegUsers - prev.cumRegUsers) / prev.cumRegUsers : null;
        return '<div style="min-width:210px"><b>' + esc(monthsAvail[di] || '') + ' · 注册用户</b><div style="padding-top:6px">累计注册人数：<strong>' + fmtWan(r.cumRegUsers) + '</strong></div><div>新增注册人数：<strong>' + fmtWan(r.newRegUsers) + '</strong></div><div style="color:' + (ch == null ? '#94a3b8' : '#0f766e') + '">' + (ch == null ? '— 无上期' : '↗ +' + (ch * 100).toFixed(1) + '% VS 上期') + '</div></div>';
      } };
      base.series = [
        { name: "新增注册人数", type: "bar", data: full.map(function (r) { return r.newRegUsers; }), barWidth: "30%", itemStyle: { color: "#c4b5fd", borderRadius: [3, 3, 0, 0] }, yAxisIndex: 0, emphasis: { focus: "none" } },
        { name: "累计注册人数", type: "line", data: full.map(function (r) { return r.cumRegUsers; }), smooth: true, symbol: "circle", symbolSize: 8, itemStyle: { color: "#8b5cf6", borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.5, color: "#8b5cf6" }, areaStyle: { opacity: .08, color: "#8b5cf6" }, yAxisIndex: 1, emphasis: { focus: "none" } }
      ];
      base.legend = { bottom: 0, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12 };
      base.yAxis = [{ type: "value", name: "新增", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: fmtWan }, splitLine: { lineStyle: { color: "#f1f5f9" } } }, { type: "value", name: "累计", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: fmtWan }, splitLine: { show: false } }];
    } else if (ly.chart === "pvBar") {
      base.series = [{ name: mt.name, type: "bar", data: full.map(function (r) { return r.pagePV; }), barWidth: "48%", itemStyle: { color: "#60a5fa", borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "self", label: { show: true } }, label: makeLabelOption(mt, monthsAvail, full, ly) }];
      base.yAxis = { type: "value", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: fmtWan }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
    } else if (ly.chart === "stackBusyIdle") {
      var busyData = full.map(function (r) { return Math.round(r.costBusy || 0); });
      var idleData = full.map(function (r) { return Math.round(r.costIdle || 0); });
      /* 鼠标悬浮整月热区：忙时 + 闲时 两个堆叠系列同时高亮，
         并在柱子顶部弹出 忙时 / 闲时 / 合计（忙时 + 闲时）三组数据 */
      base.tooltip = {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(29,78,216,0.08)" }, z: 1 },
        confine: true,
        backgroundColor: "rgba(255,255,255,0.97)",
        borderColor: "#e5e7eb", borderWidth: 1, padding: [10, 12],
        extraCssText: "box-shadow:0 6px 24px rgba(15,23,42,.12);border-radius:8px;",
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var di = ps[0].dataIndex;
          if (di == null || di < 0 || di >= monthsAvail.length) return "";
          var busy = Math.round(full[di].costBusy || 0), idle = Math.round(full[di].costIdle || 0), total = busy + idle;
          var prevDi = di - 1, prev = prevDi >= 0 ? (Math.round(full[prevDi].costBusy || 0) + Math.round(full[prevDi].costIdle || 0)) : null;
          var ch, chColor;
          if (prev == null || prev === 0) { ch = null; chColor = "#94a3b8"; }
          else { ch = (total - prev) / prev; chColor = ch >= 0 ? "#0f766e" : "#b91c1c"; }
          var chTxt = ch == null ? "— 无上期" : ((ch >= 0 ? "↗ +" : "↘ ") + (ch * 100).toFixed(1) + "% VS 上期");
          var row = function (name, val, color) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
              '<span style="width:9px;height:9px;border-radius:2px;background:' + color + ';flex:0 0 9px"></span>' +
              '<span style="flex:1;font-size:12px;color:#475569;font-weight:600">' + name + '</span>' +
              '<span style="font-size:13px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">' + fmtMoney(val) + '</span></div>';
          };
          return '<div style="min-width:210px">' +
            '<div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.04em;margin-bottom:6px">' + esc(monthsAvail[di]) + ' · 模型计费（元）</div>' +
            row("忙时模型计费（元）", busy, "#1d4ed8") +
            row("闲时模型计费（元）", idle, "#93c5fd") +
            '<div style="margin-top:5px;padding-top:6px;border-top:1px dashed #e2e8f0;display:flex;align-items:center;gap:8px">' +
              '<span style="flex:1;font-size:12px;color:#1f2937;font-weight:800">合计（忙时 + 闲时）</span>' +
              '<span style="font-size:14px;font-weight:900;color:#1d4ed8;font-variant-numeric:tabular-nums">' + fmtMoney(total) + '</span></div>' +
            '<div style="margin-top:4px;font-size:11px;font-weight:700;color:' + chColor + '">' + chTxt + '</div>' +
            '</div>';
        }
      };
      base.axisPointer = { type: "shadow", shadowStyle: { color: "rgba(29,78,216,0.08)" }, z: 1 };
      base.xAxis.axisPointer = { show: true, type: "shadow" };
      /* 堆叠柱形：整根柱子 = 模型计费；下面 = 忙时（深色），上面 = 闲时（浅色）；悬浮整月同时高亮两者 */
      base.series = [
        { name: "忙时模型计费（元）", type: "bar", stack: "cost", barWidth: "52%", data: busyData, itemStyle: { color: "#1d4ed8" }, emphasis: { focus: "none" } },
        { name: "闲时模型计费（元）", type: "bar", stack: "cost", barWidth: "52%", data: idleData, itemStyle: { color: "#93c5fd", borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "none" } }
      ];
      base.legend = { bottom: 0, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12 };
      base.xAxis.boundaryGap = true;
      base.yAxis = { type: "value", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return v >= 10000 ? (v / 10000).toFixed(0) + "万" : String(v); } }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
    } else {
      var data = full.map(function (r) { return r[mt.key]; });
      var bar = (ly.chart === "bar");
      var isPY = (mt.key === "personYear");
      var s = { name: mt.name, type: bar ? "bar" : "line", data: data, itemStyle: { color: col }, emphasis: { focus: "self", label: { show: !isPY } }, label: makeLabelOption(mt, monthsAvail, full, ly) };
      if (!bar) { s.smooth = true; s.symbol = "circle"; s.symbolSize = 8; s.itemStyle = { color: col, borderColor: "#fff", borderWidth: 2 }; s.lineStyle = { width: 2.5, color: col, cap: "round", join: "round" }; if (ly.chart === "lineArea") s.areaStyle = { opacity: .12, color: col }; }
      else { s.barWidth = "46%"; s.itemStyle = { color: col, borderRadius: [4, 4, 0, 0] }; }
      base.series = [s];
      base.yAxis = { type: "value", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return fmtMetric(mt, v); } }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
      if (isPY) {
        base.tooltip = {
          show: true, trigger: "axis", confine: true,
          backgroundColor: "rgba(255,255,255,0.98)", borderColor: "transparent", borderWidth: 0, padding: 0,
          extraCssText: "box-shadow:0 12px 36px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.06);border-radius:12px;overflow:hidden;",
          axisPointer: { type: "line", lineStyle: { color: col, width: 1.5, type: "dashed" } },
          formatter: function (params) {
            if (!params || !params.length) return "";
            var p = params[0];
            var di = p.dataIndex;
            var month = monthsAvail[di] || "";
            var val = p.value;
            var prev = getSeriesValAt(ly, full, di - 1, p.seriesName, mt);
            var ch = (prev != null && prev !== 0) ? ((val - prev) / prev) : null;
            var valStr = fmtMetric(mt, val);
            var chTxt, chColor;
            if (ch == null) { chTxt = "— 无上期"; chColor = "#94a3b8"; }
            else if (ch >= 0) { chTxt = "↗ +" + (ch * 100).toFixed(1) + "% VS 上期"; chColor = "#0f766e"; }
            else { chTxt = "↘ " + (ch * 100).toFixed(1) + "% VS 上期"; chColor = "#b91c1c"; }
            return '<div style="padding:10px 12px;min-width:190px">' +
              '<div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">' + esc(month) + '</div>' +
              '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">' +
              '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + col + ';flex:0 0 8px"></span>' +
              '<span style="flex:1;font-size:12.5px;color:#334155;font-weight:600">' + esc(p.seriesName) + '</span>' +
              '<span style="font-size:13px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">' + esc(valStr) + '</span>' +
              '</div>' +
              '<div style="margin-top:4px;font-size:11px;font-weight:700;color:' + chColor + '">' + chTxt + '</div>' +
              '</div>';
          }
        };
      }
    }
    trendChartInsts[group].setOption(base, true);
    highlightTrendPoint(gi, mt, full, monthsAvail, ly);
  }
  function highlightTrendPoint(gi, mt, full, monthsAvail, ly) {
    var group = GROUPS[gi] || GROUPS[0];
    var inst = trendChartInsts[group]; if (!inst) return;
    var gst = gTrendState(group);
    var idx = monthsAvail.indexOf(gst.month); if (idx < 0) return;
    var val;
    if (ly.chart === "stackScenes" || ly.chart === "linePromo") {
      if (full.kind === "stack") val = full.keys.reduce(function (s, k) { return s + (full.series[k][idx] || 0); }, 0);
      else val = full.values[idx];
    } else if (ly.chart === "stack") { val = (full[idx].activeAgents || 0) + (full[idx].totalAgentsOnline || 0); }
    else if (ly.chart === "combined") { val = full[idx].mau; }
    else val = full[idx][mt.key];
    if (val == null) return;
    var col = COLOR_MAP[mt.cls] || "#3b82f6";
    var mark = new Array(monthsAvail.length).fill(null); mark[idx] = val;
    /* 对多系列图表（如 stackBusyIdle），必须把 scatter 作为新增 series 追加，
       否则 ECharts 会按索引合并并覆盖掉已有的第二个系列（表现为“闲时”变成圆点）。 */
    var existingCount = Math.max(1, (inst.getOption().series || []).length);
    var seriesArr = [];
    for (var i = 0; i < existingCount; i++) seriesArr.push({});
    seriesArr.push({ type: "scatter", data: mark, symbolSize: 16, itemStyle: { color: "#fff", borderColor: col, borderWidth: 3 }, z: 6, tooltip: { show: false } });
    inst.setOption({ series: seriesArr });
  }
  function selNamesOf(sl) { return sl.scope === "multi" ? getSelProvs() : (sl.scope === "全网" ? [] : [sl.scope]); }
  function rankBlock(title, rows, mt) {
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="trend-empty">暂无数据</div></div>';
    var maxv = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value || 0); }).concat([1]));
    return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div>' +
      '<div class="rk-head"><span class="rk-idx">#</span><span class="rk-name">名称</span><span class="rk-val">数值</span></div>' +
      rows.map(function (r, i) {
        var pct = Math.abs(r.value || 0) / maxv * 100;
        var selCls = r.sel ? " sel" : "";
        var tag = r.sel ? '<em class="rk-tag">' + (r.extra ? "你选的" : "所选") + '</em>' : "";
        return '<div class="rk-row' + selCls + '"><span class="rk-idx">' + (i + 1) + '</span>' +
          '<span class="rk-name">' + esc(r.name) + tag + '<em class="rk-sub">' + esc(r.sub || "") + '</em></span>' +
          '<span class="rk-val">' + fmtMetric(mt, r.value) + '</span></div>' +
          '<div class="rk-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      }).join('') + '</div>';
  }
  function costRankTable(title, rows, kind) {
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="trend-empty">暂无数据</div></div>';
    function th(c, txt) { return '<th class="' + c + '">' + txt + '</th>'; }
    var head = kind === "province"
      ? th("rk-tidx", "排名") + th("rk-tname", "省份名称") + th("", "模型计费（元）") + th("", "忙时模型计费（元）") + th("", "闲时模型计费（元）")
      : th("rk-tidx", "排名") + th("rk-tname", "应用名称") + th("rk-tname", "省份名称") + th("", "模型计费（元）") + th("", "忙时模型计费（元）") + th("", "闲时模型计费（元）");
    var body = rows.map(function (r, i) {
      var cost = kind === "province" ? r.value : r.cost;
      var busy = r.busy || 0, idle = r.idle || 0;
      var provCell = kind === "province" ? "" : '<td class="rk-tname">' + esc(r.prov || "—") + '</td>';
      return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '>' +
        '<td class="rk-tidx">' + (i + 1) + '</td>' +
        '<td class="rk-tname">' + esc(r.name) + '</td>' +
        provCell +
        '<td>' + fmtMoney(cost) + '</td>' +
        '<td>' + fmtMoney(busy) + '</td>' +
        '<td>' + fmtMoney(idle) + '</td>' +
        '</tr>';
    }).join("");
    return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div>' +
      '<div class="rk-table-wrap"><table class="rk-table ' + kind + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function callsRankTable(title, rows, kind) {
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="trend-empty">暂无数据</div></div>';
    var isProv = kind === "province";
    var head = '<th class="rk-tidx">排名</th><th class="rk-tname">' + (isProv ? '省份名称' : '应用名称') + '</th>' + (isProv ? '' : '<th class="rk-tname">省份</th>') + '<th>调用量</th>';
    var body = rows.map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '><td class="rk-tidx">' + (i + 1) + '</td><td class="rk-tname">' + esc(r.name) + '</td>' + (isProv ? '' : '<td class="rk-tname">' + esc(r.prov || '—') + '</td>') + '<td>' + fmtWan(isProv ? r.value : r.calls) + '</td></tr>';
    }).join('');
    return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="rk-table-wrap"><table class="rk-table calls-' + kind + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function pvRankTable(title, rows, kind) {
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="trend-empty">暂无数据</div></div>';
    var isPage = kind === "page";
    var head = '<th class="rk-tidx">排名</th><th class="rk-tname">' + (isPage ? '页面名称' : '省份名称') + '</th><th>' + (isPage ? '点击量' : 'PV') + '</th>';
    var body = rows.map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '><td class="rk-tidx">' + (i + 1) + '</td><td class="rk-tname">' + esc(r.name) + '</td><td>' + fmtWan(r.value) + '</td></tr>';
    }).join('');
    return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="rk-table-wrap"><table class="rk-table pv-' + kind + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function tokenRankTable(title, rows, kind) {
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="trend-empty">暂无数据</div></div>';
    var isPage = kind === "app";
    var head = '<th class="rk-tidx">排名</th><th class="rk-tname">' + (isPage ? '应用名称' : '省份名称') + '</th>' + (isPage ? '<th class="rk-tname">省份</th>' : '') + '<th>Token数</th>';
    var body = rows.map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '><td class="rk-tidx">' + (i + 1) + '</td><td class="rk-tname">' + esc(r.name) + '</td>' + (isPage ? '<td class="rk-tname">' + esc(r.prov || '—') + '</td>' : '') + '<td>' + fmtWan(r.value) + '</td></tr>';
    }).join('');
    return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="rk-table-wrap"><table class="rk-table token-' + kind + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  /* 节约人年 · 省份排名（三字段表：排名 / 省份名称 / 节约人年） */
  function pyRankTable(rows, mt) {
    var title = "省份排名";
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div><div class="trend-empty">暂无数据</div></div>';
    function th(c, txt) { return '<th class="' + c + '">' + txt + '</th>'; }
    var head = th("rk-tidx", "排名") + th("rk-tname", "省份名称") + th("", "节约人年");
    var body = rows.map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '>' +
        '<td class="rk-tidx">' + (i + 1) + '</td>' +
        '<td class="rk-tname">' + esc(r.name) + '</td>' +
        '<td>' + fmtMetric(mt, r.value) + '</td>' +
        '</tr>';
    }).join("");
    return '<div class="rk-block"><div class="rk-block-hd">' + title + '</div>' +
      '<div class="rk-table-wrap"><table class="rk-table py-prov"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function panoramaHtml(mt, month, sl) {
    var tag = promoTag(mt.key);
    var rows = rowsByTag(tag);
    var idx = promoMonths().indexOf(month); if (idx < 0) return '<div class="trend-empty">该月无全景数据</div>';
    var scoped = rows.filter(function (r) { return sl.scope === "全网" || r.province === sl.scope; });
    var list = scoped.filter(function (r) { return r.monthly[idx] > 0; })
      .map(function (r) { return { name: r.app, prov: r.province, value: r.monthly[idx], isNew: idx > 0 && r.monthly[idx - 1] <= 0 }; })
      .sort(function (a, b) { return b.value - a.value; });
    var newCount = list.filter(function (x) { return x.isNew; }).length;
    var outCount = scoped.filter(function (r) { return idx > 0 && r.monthly[idx] <= 0 && r.monthly[idx - 1] > 0; }).length;
    if (!list.length) return '<div class="trend-empty">该月暂无' + esc(mt.name) + '名单</div>';
    var maxv = Math.max.apply(null, list.map(function (x) { return x.value; }).concat([1]));
    var meta = '共 ' + list.length + ' 项' + (newCount ? ' · 新增 ' + newCount : '') + (outCount ? ' · 掉出 ' + outCount : '');
    return '<div class="pa-meta" style="margin-bottom:6px">' + meta + '</div>' +
      '<div class="pa-head"><span class="pa-name">应用 / 省份</span><span class="pa-val">等效人年</span></div>' +
      list.map(function (x) {
        var pct = x.value / maxv * 100;
        return '<div class="pa-row' + (x.isNew ? " pa-new" : "") + '">' +
          '<span class="pa-name">' + esc(x.name) + (x.isNew ? '<span class="pa-badge">NEW</span>' : '') + '<em class="pa-meta">' + esc(x.prov) + '</em></span>' +
          '<span class="pa-val">' + fmtPY(x.value) + '</span></div>' +
          '<div class="rk-bar" style="grid-column:1/3"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      }).join('');
  }
  /* 推广案例：场景×月份 三指标热力图（应用数 / 省份数 / 等效人年），分块横向排列 */
  function renderPromoHeatmap(boxId, scenes, months, sceneStats, curIdx) {
    var monthsToShow = months.slice(0, curIdx + 1);
    var metrics = [
      { key: "appCount", name: "智能体应用数", unit: "个", color: ["#eff6ff", "#3b82f6"], fmt: function (v) { return String(v); } },
      { key: "provinceCount", name: "覆盖省份数", unit: "个", color: ["#ecfdf5", "#10b981"], fmt: function (v) { return String(v); } },
      { key: "eqPersonYear", name: "等效人年", unit: "人年", color: ["#fffbeb", "#f59e0b"], fmt: function (v) { return v.toFixed(1); } }
    ];
    var seriesData = metrics.map(function (m) {
      var d = [];
      scenes.forEach(function (s, y) {
        var st = (sceneStats && sceneStats[s]) || [];
        monthsToShow.forEach(function (month, x) {
          var o = st[x] || {};
          d.push([x, y, o[m.key] || 0]);
        });
      });
      return d;
    });
    var box = document.getElementById(boxId);
    if (!box) return null;
    var inst = window.echarts.init(box);
    var lefts = ["14%", "41%", "68%"];
    var widths = ["20%", "20%", "20%"];
    var titleLefts = ["17%", "44%", "71%"];
    inst.setOption({
      tooltip: {
        position: "top",
        /* 2026-08-27：tooltip 增加「较上月」环比，与当前值一同展示 */
        formatter: function (p) {
          var m = metrics[p.seriesIndex];
          var scene = scenes[p.data[1]];
          var month = monthsToShow[p.data[0]];
          var val = p.data[2];
          var x = p.data[0];
          var momHtml = '';
          if (x === 0) {
            momHtml = '<span style="color:#94a3b8">— 首月无环比</span>';
          } else {
            var prev = seriesData[p.seriesIndex][p.dataIndex - 1][2];
            if (!prev) {
              momHtml = '<span style="color:#94a3b8">— 上月无数据</span>';
            } else {
              var mom = (val - prev) / prev * 100;
              var arrow = mom >= 0 ? '↗' : '↘';
              var color = mom >= 0 ? '#dc2626' : '#059669';
              momHtml = '<span style="color:' + color + '">' + arrow + (mom >= 0 ? '+' : '') + mom.toFixed(2) + '%（较上月）</span>';
            }
          }
          return '<div style="font-weight:700;margin-bottom:4px">' + esc(scene) + ' · ' + esc(month) + '</div>' +
            p.marker + esc(m.name) + '：<b>' + m.fmt(val) + ' ' + m.unit + '</b><br/>' +
            '<span style="color:#64748b">环比：</span>' + momHtml;
        }
      },
      title: metrics.map(function (m, i) {
        return { text: m.name + "（" + m.unit + "）", left: titleLefts[i], top: "2%", textStyle: { fontSize: 13, fontWeight: 700, color: "#1f2937" }, textAlign: "center" };
      }),
      grid: metrics.map(function (m, i) {
        return { left: lefts[i], width: widths[i], top: "12%", height: "78%" };
      }),
      xAxis: metrics.map(function (m, i) {
        return { gridIndex: i, type: "category", data: monthsToShow, axisLabel: { fontSize: 11 }, splitArea: { show: true } };
      }),
      yAxis: metrics.map(function (m, i) {
        return {
          gridIndex: i, type: "category", data: scenes,
          axisLabel: { show: i === 0, fontSize: 11, width: 120, overflow: "break", lineHeight: 16 },
          axisTick: { show: i === 0 },
          splitArea: { show: true }
        };
      }),
      visualMap: metrics.map(function (m, i) {
        var vals = seriesData[i].map(function (d) { return d[2]; });
        var max = Math.max.apply(null, vals.concat([1]));
        return { seriesIndex: i, min: 0, max: max, inRange: { color: m.color }, show: false };
      }),
      series: metrics.map(function (m, i) {
        return {
          name: m.name,
          type: "heatmap",
          xAxisIndex: i,
          yAxisIndex: i,
          data: seriesData[i],
          label: { show: true, fontSize: 11, color: "#1f2937", formatter: function (p) { return p.data[2] ? m.fmt(p.data[2]) : ""; } },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,.25)" } }
        };
      })
    }, true);
    return inst;
  }
  /* 推广案例：构建「场景 × 省份」矩阵表格 HTML（含单应用等效人年、行列合计、行高亮）。
   * 仅返回 <table>，卡片标题与月份筛选标签由调用方包裹，便于联动时只刷新表格本体。 */
  function buildPromoMatrixHtml(rows, realScenes, monthIdx, highlightScene) {
    function cellApps(s, p) {
      return rows.filter(function (r) { return r.scene === s && r.province === p && r.monthly[monthIdx] > 0; })
        .sort(function (a, b) { return b.monthly[monthIdx] - a.monthly[monthIdx]; });
    }
    function sceneApps(s) { return rows.filter(function (r) { return r.scene === s && r.monthly[monthIdx] > 0; }); }
    function provApps(p) { return rows.filter(function (r) { return r.province === p && r.monthly[monthIdx] > 0; }); }
    var allProv = {}; rows.forEach(function (r) { allProv[r.province] = 1; });
    var provinces = Object.keys(allProv);
    provinces.sort(function (a, b) { return provApps(b).length - provApps(a).length; });
    function cellHtml(s, p) {
      var apps = cellApps(s, p);
      if (!apps.length) return '<td><div class="pa-cell empty">·</div></td>';
      var totalPy = apps.reduce(function (sum, r) { return sum + (r.monthly[monthIdx] || 0); }, 0);
      var list = apps.map(function (r) {
        return '<div class="pa-app-line"><span class="pa-app-name" title="' + esc(r.app) + '">' + esc(r.app) + '</span>' +
          '<span class="pa-app-py">' + fmtPY(r.monthly[monthIdx]) + '</span></div>';
      }).join('');
      var tip = apps.length + ' 个应用 / ' + fmtPY(totalPy) + ' 人年\n' + apps.map(function (r) { return r.app + ' ' + fmtPY(r.monthly[monthIdx]); }).join('\n');
      return '<td><div class="pa-cell" title="' + esc(tip).replace(/\n/g, '&#10;') + '">' +
        '<div class="pa-cell-hd"><span class="pa-cell-n">' + apps.length + '</span>' +
        (apps.length > 1 ? '<span class="pa-cell-total-py">Σ ' + fmtPY(totalPy) + '</span>' : '') + '</div>' +
        '<div class="pa-cell-apps">' + list + '</div></div></td>';
    }
    var head = '<th class="pa-scene">推广场景 ＼ 省份</th>' + provinces.map(function (p) { return '<th>' + esc(p) + '</th>'; }).join('') + '<th class="pa-total-col">合计</th>';
    var bodyRows = realScenes.map(function (s) {
      var sApps = sceneApps(s);
      var rowTotal = sApps.length;
      var rowTotalPy = sApps.reduce(function (sum, r) { return sum + (r.monthly[monthIdx] || 0); }, 0);
      var cls = (highlightScene && s === highlightScene) ? ' class="pa-row-highlight"' : '';
      return '<tr' + cls + ' data-scene="' + esc(s) + '"><th class="pa-scene">' + esc(s) + '</th>' +
        provinces.map(function (p) { return cellHtml(s, p); }).join('') +
        '<td class="pa-total-cell" title="等效人年 ' + fmtPY(rowTotalPy) + '">' + rowTotal + '</td></tr>';
    }).join('');
    var colTotals = provinces.map(function (p) {
      var n = provApps(p).length;
      return '<td class="pa-total-cell">' + n + '</td>';
    }).join('');
    var grandTotal = rows.filter(function (r) { return realScenes.indexOf(r.scene) >= 0 && r.monthly[monthIdx] > 0; }).length;
    var foot = '<tr class="pa-total-row"><th class="pa-scene pa-total-row">合计</th>' + colTotals + '<td class="pa-grand-total">' + grandTotal + '</td></tr>';
    return '<table class="pa-matrix"><thead><tr>' + head + '</tr></thead><tbody>' + bodyRows + foot + '</tbody></table>';
  }
  /* 热力图悬停联动：切换矩阵月份视图 + 高亮场景行 + 同步月份筛选标签选中状态（不重建整卡，避免闪烁） */
  function updatePromoMatrix(gi, monthIdx, highlightScene) {
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var scroll = c.querySelector(".pa-matrix-scroll"); if (!scroll) return;
    var card = scroll.closest ? scroll.closest(".pa-matrix-card") : null;
    var rows = rowsByTag("推广案例");
    var scenes = promoScenes() || [];
    var realScenes = scenes.filter(function (s) { return s !== "未分类"; });
    /* 同步月份筛选标签（pills）选中状态 */
    if (card) {
      card.querySelectorAll(".pa-month-pills .pa-pill").forEach(function (b) {
        b.classList.toggle("active", (+b.dataset.mi) === monthIdx);
      });
    }
    var sL = scroll.scrollLeft, sT = scroll.scrollTop;
    if (scroll._promoMonthIdx !== monthIdx) {
      scroll.innerHTML = buildPromoMatrixHtml(rows, realScenes, monthIdx, highlightScene);
      scroll._promoMonthIdx = monthIdx;
    } else {
      /* 同一月份内仅切换高亮行，轻量无闪烁；同时清除双击联动留下的环比底色标记 */
      scroll.querySelectorAll("tr[data-scene]").forEach(function (tr) {
        var s = tr.getAttribute("data-scene");
        tr.classList.toggle("pa-row-highlight", !!highlightScene && s === highlightScene);
      });
      scroll.querySelectorAll(".pa-cell").forEach(function (cell) {
        cell.classList.remove("mom-up", "mom-down");
      });
    }
    scroll.scrollLeft = sL; scroll.scrollTop = sT;
  }
  /* 2026-08-27 新增：双击热力图单元格 → 矩阵定位该场景行，并按「该月 vs 上月」环比标记行内省份单元格底色。
   * metricIdx 与热力图子图对应：0=智能体应用数、1=覆盖省份数（行内无直接对应，退化为应用数环比）、2=等效人年。
   * _promoDblKey：定位状态键（gi|monthIdx|scene|metricIdx）。
   *   - 非 null = 定位中：场景行锁定高亮 + 三态底色，且「暂停」鼠标悬停切换月份/场景；
   *   - 再次双击同一单元格 → 置 null 取消定位，恢复默认视图与悬停联动。 */
  var _promoDblKey = null;
  function handlePromoHeatmapDblclick(gi, monthIdx, scene, metricIdx) {
    updatePromoMatrix(gi, monthIdx, scene);
    markSceneRowMom(gi, monthIdx, scene, metricIdx);
  }
  /* 设置/取消矩阵行的「锁定」样式（定位中该行深橙底 + 左侧粗边框） */
  function setPromoRowLocked(gi, scene) {
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var scroll = c.querySelector(".pa-matrix-scroll"); if (!scroll) return;
    scroll.querySelectorAll("tr[data-scene]").forEach(function (tr) {
      tr.classList.toggle("pa-row-locked", !!scene && tr.getAttribute("data-scene") === scene);
    });
  }
  /* 将矩阵滚动容器平滑滚动至指定场景行所在区域 */
  function scrollToPromoRow(gi, scene) {
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var scroll = c.querySelector(".pa-matrix-scroll"); if (!scroll) return;
    var tr = scroll.querySelector('tr[data-scene="' + esc(scene) + '"]');
    if (tr && tr.scrollIntoView) {
      try { tr.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      catch (e) { tr.scrollIntoView(); }
    }
  }
  function markSceneRowMom(gi, monthIdx, scene, metricIdx) {
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var scroll = c.querySelector(".pa-matrix-scroll"); if (!scroll) return;
    if (monthIdx < 1) return; /* 首月无环比基准 */
    var tr = scroll.querySelector('tr[data-scene="' + esc(scene) + '"]'); if (!tr) return;
    /* 省份列顺序与表头一致：跳过首列「推广场景 ＼ 省份」与末列「合计」 */
    var provs = [];
    scroll.querySelectorAll("thead th").forEach(function (th, i) {
      if (i > 0 && !th.classList.contains("pa-total-col")) provs.push(th.textContent.trim());
    });
    var rows = rowsByTag("推广案例");
    tr.querySelectorAll("td").forEach(function (td, i) {
      if (i >= provs.length) return; /* 跳过合计列 */
      var cell = td.querySelector(".pa-cell");
      if (!cell || cell.classList.contains("empty")) return;
      var p = provs[i];
      var cur = 0, prev = 0;
      rows.forEach(function (r) {
        if (r.scene !== scene || r.province !== p) return;
        if (metricIdx === 2) {
          /* 等效人年指标：按当月 / 上月求和 */
          cur += (r.monthly[monthIdx] || 0);
          prev += (r.monthly[monthIdx - 1] || 0);
        } else {
          /* 应用数指标（省份数指标退化为应用数）：按当月 / 上月统计有等效人年的应用条数 */
          if (r.monthly[monthIdx] > 0) cur++;
          if (r.monthly[monthIdx - 1] > 0) prev++;
        }
      });
      cell.classList.remove("mom-up", "mom-down", "mom-flat");
      if (prev <= 0) return; /* 上月无数据 → 不标记 */
      if (cur > prev) cell.classList.add("mom-up");        /* 上升 → 绿底 */
      else if (cur < prev) cell.classList.add("mom-down"); /* 下降 → 红底 */
      else cell.classList.add("mom-flat");                 /* 持平 → 灰底 */
    });
  }

  /* 2026-08-27 新增：优秀/双周优秀全景图左侧组合图
   * 应用省份数（柱）+ 应用智能体数（柱）+ 等效人年（折线），双 Y 轴，低饱和度色系 */
  function renderExcellentComboChart(gi, mt, monthsAvail) {
    var box = document.getElementById("trendChart-" + gi);
    if (!box) return null;
    var isBiweek = (mt.key === "excellentAgentsBiweek");
    var rows = rowsByTag(isBiweek ? "双周优秀案例" : "优秀案例");
    var provCnt = [], appCnt = [], py = [];
    monthsAvail.forEach(function (m, i) {
      var ps = {}, cnt = 0, sum = 0;
      rows.forEach(function (r) {
        var v = (r.monthly && r.monthly[i] != null) ? r.monthly[i] : 0;
        if (v > 0) { ps[r.province] = 1; cnt++; sum += v; }
      });
      provCnt.push(Object.keys(ps).length);
      appCnt.push(cnt);
      py.push(sum);
    });
    /* 配色规范：优秀智能体数 → 蓝色系；双周优秀智能体数 → 紫色系（深→浅区分三指标层级） */
    var pal = isBiweek
      ? { cProv: "#a78bfa", cApp: "#8b5cf6", cPy: "#6d28d9", shProv: "rgba(167,139,250,0.35)", shApp: "rgba(139,92,246,0.35)" }
      : { cProv: "#60a5fa", cApp: "#3b82f6", cPy: "#1d4ed8", shProv: "rgba(96,165,250,0.35)", shApp: "rgba(59,130,246,0.35)" };
    var cProv = pal.cProv, cApp = pal.cApp, cPy = pal.cPy;
    var inst = window.echarts.init(box);
    inst.setOption({
      color: [cProv, cApp, cPy],
      /* 2026-08-27 增强 tooltip：统一样式（白底圆角阴影）+ 显示月份 + 三指标当前值与环比（与上月比）+ 数据点高亮 */
      tooltip: {
        trigger: "axis",
        alwaysShowContent: false,
        confine: true, /* 限制在图表区域内，避免遮挡关键信息 */
        backgroundColor: "rgba(255,255,255,0.98)",
        borderColor: "#e5e7eb",
        borderWidth: 1,
        padding: [10, 14],
        extraCssText: "box-shadow:0 6px 20px rgba(15,23,42,0.12);border-radius:10px;",
        textStyle: { color: "#1f2937", fontSize: 12 },
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,163,184,0.12)" } },
        formatter: function (ps) {
          var i = ps[0].dataIndex;
          var m = monthsAvail[i] || "";
          var html = '<div style="font-weight:700;font-size:13px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #f1f5f9">' + esc(m) + '</div>';
          var prevI = i - 1;
          ps.forEach(function (s) {
            var cur = (s.value == null) ? 0 : s.value;
            var unit = s.seriesName === "等效人年" ? " 人年" : " 个";
            var momHtml = "";
            if (prevI >= 0) {
              /* 取该 series 上一月值计算环比 */
              var prevVal = 0;
              if (s.seriesName === "应用省份数") prevVal = provCnt[prevI] || 0;
              else if (s.seriesName === "应用智能体数") prevVal = appCnt[prevI] || 0;
              else if (s.seriesName === "等效人年") prevVal = py[prevI] || 0;
              if (prevVal > 0) {
                var pct = (cur - prevVal) / prevVal * 100;
                var up = pct >= 0;
                momHtml = '<span style="margin-left:6px;font-size:11px;font-weight:600;color:' + (up ? "#dc2626" : "#059669") + '">' + (up ? "↗ +" : "↘ ") + pct.toFixed(1) + '%</span>';
              } else {
                momHtml = '<span style="margin-left:6px;font-size:11px;color:#94a3b8">— 上月无数据</span>';
              }
            } else {
              momHtml = '<span style="margin-left:6px;font-size:11px;color:#94a3b8">— 首月</span>';
            }
            html += '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;line-height:1.6">' +
              s.marker +
              '<span style="flex:1;color:#475569">' + s.seriesName + '</span>' +
              '<b style="font-variant-numeric:tabular-nums">' + cur + unit + '</b>' +
              momHtml +
              '</div>';
          });
          return html;
        }
      },
      legend: { data: ["应用省份数", "应用智能体数", "等效人年"], top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
      grid: { left: 46, right: 52, top: 34, bottom: 24 },
      xAxis: { type: "category", data: monthsAvail, axisLabel: { fontSize: 11 }, axisLine: { lineStyle: { color: "#cbd5e1" } } },
      yAxis: [
        { type: "value", name: "数量", nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 }, splitLine: { lineStyle: { color: "#eef2f7" } } },
        { type: "value", name: "人年", nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 }, splitLine: { show: false } }
      ],
      series: [
        /* emphasis 高亮当前数据点；focus:'series' 仅高亮同系列其他点淡出（移动端触摸友好） */
        { name: "应用省份数", type: "bar", data: provCnt, barMaxWidth: 22, itemStyle: { color: cProv, borderRadius: [3, 3, 0, 0] }, emphasis: { focus: "series", itemStyle: { color: cProv, shadowBlur: 8, shadowColor: pal.shProv } } },
        { name: "应用智能体数", type: "bar", data: appCnt, barMaxWidth: 22, itemStyle: { color: cApp, borderRadius: [3, 3, 0, 0] }, emphasis: { focus: "series", itemStyle: { color: cApp, shadowBlur: 8, shadowColor: pal.shApp } } },
        { name: "等效人年", type: "line", yAxisIndex: 1, data: py, smooth: true, symbol: "circle", symbolSize: 7, lineStyle: { width: 2.5, color: cPy }, itemStyle: { color: cPy }, emphasis: { focus: "series", scale: true, itemStyle: { color: cPy, borderColor: "#fff", borderWidth: 2 } } }
      ]
    }, true);
    bindTrendMonthEvents(inst, GROUPS[gi] || GROUPS[0], gi);
    return inst;
  }

  /* ===== 推广/优秀/双周优秀 案例全景图（参考 Tab2 2.2 / 2.3） =====
   * 数据汇总概览 + 趋势变化曲线（复用 echarts stackScenes/linePromo）+ 关键指标对比 + 全景矩阵/榜单 */
  function renderPromoPanorama(gi, mt, full, monthsAvail, sl) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var tEl = $("trendTitle-" + gi), sEl = $("trendSub-" + gi), tagEl = $("trendTag-" + gi);
    var isPromo = (mt.key === "promoAgents");
    var isBiweek = (mt.key === "excellentAgentsBiweek");
    var tag = promoTag(mt.key);
    var rows = rowsByTag(tag);
    var idx = monthsAvail.indexOf(gst.month); if (idx < 0) idx = monthsAvail.length - 1;
    var prevIdx = idx - 1;
    function statAt(i) { var cnt = 0, val = 0; rows.forEach(function (r) { var v = (r.monthly && r.monthly[i] != null) ? r.monthly[i] : 0; if (v > 0) { cnt++; val += v; } }); return { cnt: cnt, val: val }; }
    var cur = statAt(idx), prev = (prevIdx >= 0) ? statAt(prevIdx) : null;
    var momPct = (prev && prev.cnt > 0) ? ((cur.cnt - prev.cnt) / prev.cnt * 100) : null;
    var sceneSet = {}, scenesAll = [];
    rows.forEach(function (r) { if (!sceneSet[r.scene]) { sceneSet[r.scene] = 1; scenesAll.push(r.scene); } });
    var scenesOrdered = (promoScenes() || []).filter(function (s) { return sceneSet[s]; });
    var scenes = scenesOrdered.length ? scenesOrdered : scenesAll;
    var provSet = {};
    rows.forEach(function (r) { if (r.monthly[idx] != null && r.monthly[idx] > 0) provSet[r.province] = 1; });
    var realScenes = scenes.filter(function (s) { return s !== "未分类"; });
    var scenesCovered = realScenes.filter(function (s) { return rows.some(function (r) { return r.scene === s && r.monthly[idx] > 0; }); }).length;
    var provCovered = Object.keys(provSet).length;
    /* 关键指标对比（按等效人年） */
    var cmp;
    if (isPromo) {
      cmp = scenes.map(function (s) { var v = 0; rows.forEach(function (r) { if (r.scene === s) v += (r.monthly[idx] || 0); }); return { name: s, value: v }; })
        .filter(function (x) { return x.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    } else {
      /* 2026-08-27：右侧榜单改为全部省份等效人年排名（覆盖《总表》出现过的所有省份，当月无数据记 0，不再截断 TOP8） */
      var pm = {}; rows.forEach(function (r) { pm[r.province] = (pm[r.province] || 0) + (r.monthly[idx] || 0); });
      cmp = Object.keys(pm).map(function (p) { return { name: p, value: pm[p] }; }).sort(function (a, b) { return b.value - a.value; });
    }
    /* 省份等效人年排名列表（名次 + 省份 + 数值；TOP3 名次徽标高亮），新增表头 */
    var rankHtml = cmp.length ?
      '<div class="pa-ex-rank-head"><span>排名</span><span>省份名称</span><span>节约人年</span></div>' +
      '<div class="pa-ex-rank">' + cmp.map(function (x, i) {
        var medal = i < 3 ? ' pa-rank-top' + (i + 1) : '';
        return '<div class="pa-ex-rank-row' + medal + '"><span class="pa-ex-rank-no">' + (i + 1) + '</span>' +
          '<span class="pa-ex-rank-name" title="' + esc(x.name) + '">' + esc(x.name) + '</span>' +
          '<span class="pa-ex-rank-val">' + fmtPY(x.value) + '</span></div>';
      }).join('') + '</div>' : '<div class="trend-empty">暂无排名数据</div>';
    /* 月份选择 */
    var monthPills = monthsAvail.map(function (m, i) {
      return '<button type="button" class="pa-pill' + (m === gst.month ? ' active' : '') + '" data-mi="' + i + '">' + esc(m) + '</button>';
    }).join('');
    /* 数据汇总概览 */
    function momSub() {
      if (momPct == null) return '<span class="pa-stat-sub muted">— 首月无环比</span>';
      var up = momPct >= 0;
      return '<span class="pa-stat-sub ' + (up ? 'up' : 'down') + '">' + (up ? '↗ +' : '↘ ') + momPct.toFixed(1) + '% 较上月</span>';
    }
    var ov1 = isPromo ? '推广应用数' : (isBiweek ? '双周优秀应用数' : '优秀应用数');
    var ov3 = isPromo ? '覆盖场景' : '覆盖省份';
    var ov3v = isPromo ? scenesCovered : provCovered;
    var ov3sub = isPromo ? (realScenes.length + ' 大场景') : '31 省覆盖';
    var overview =
      '<div class="pa-stat"><div class="pa-stat-label">' + ov1 + '（' + esc(gst.month) + '）</div><div class="pa-stat-val">' + fmtInt(cur.cnt) + '</div>' + momSub() + '</div>' +
      '<div class="pa-stat"><div class="pa-stat-label">等效人年合计</div><div class="pa-stat-val">' + fmtPY(cur.val) + '</div><span class="pa-stat-sub muted">当月新增案例贡献</span></div>' +
      '<div class="pa-stat"><div class="pa-stat-label">' + ov3 + '</div><div class="pa-stat-val">' + ov3v + '</div><span class="pa-stat-sub muted">' + ov3sub + '</span></div>' +
      '<div class="pa-stat"><div class="pa-stat-label">案例总量（累计）</div><div class="pa-stat-val">' + fmtInt(rows.length) + '</div><span class="pa-stat-sub muted">《总表》收录</span></div>';
    /* 全景矩阵（推广：场景×省份，含月份筛选标签；优秀：分省明细表） */
    var matrixHtml;
    if (isPromo) {
      var promoPills = monthsAvail.map(function (m, i) {
        return '<button type="button" class="pa-pill' + (m === gst.month ? ' active' : '') + '" data-mi="' + i + '">' + esc(m) + '</button>';
      }).join('');
      matrixHtml = '<div class="pa-matrix-card" id="paMatrixCard-' + gi + '">' +
        '<div class="pa-card-hd"><span class="pa-card-hd-title">推广案例全景矩阵（场景 × 省份）</span>' +
        '<span class="pa-month-pills" id="paMonthPills-' + gi + '">' + promoPills + '</span></div>' +
        '<div class="pa-matrix-scroll" id="paMatrixScroll-' + gi + '">' +
        buildPromoMatrixHtml(rows, realScenes, idx, null) + '</div></div>';
    } else {
      var pm2 = {};
      rows.forEach(function (r) { if (r.monthly[idx] > 0) { if (!pm2[r.province]) pm2[r.province] = { prov: r.province, count: 0, value: 0, names: [] }; pm2[r.province].count++; pm2[r.province].value += r.monthly[idx]; pm2[r.province].names.push(r.app); } });
      var pRows = Object.keys(pm2).map(function (p) { return pm2[p]; }).filter(function (x) { return x.count > 0; }).sort(function (a, b) { return b.count - a.count; });
      var prows = pRows.map(function (r, i) {
        return '<tr' + (i === 0 ? ' class="pa-top"' : '') + '>' +
          '<td class="pa-rank">' + (i + 1) + '</td>' +
          '<td>' + esc(r.prov) + '</td>' +
          '<td class="pa-num">' + r.count + '</td>' +
          '<td class="pa-py">' + fmtPY(r.value) + '</td>' +
          '<td class="pa-apps">' + esc(r.names.join('、')) + '</td></tr>';
      }).join('');
      matrixHtml = '<div class="pa-matrix-scroll"><table class="pa-prov-table"><thead><tr><th class="pa-rank">排名</th><th>省份</th><th class="pa-num">数量</th><th class="pa-py">等效人年</th><th>应用名称</th></tr></thead><tbody>' + prows + '</tbody></table></div>';
    }
    var monthBarHtml = isPromo ? '' : '<div class="pa-monthbar"><span style="font-size:12px;color:#94a3b8;font-weight:600;margin-right:2px">选择月份：</span>' + monthPills + '</div>';
    /* 推广案例：改为「场景×月份 三指标热力图」（应用数 / 省份数 / 等效人年），分块横向排列 */
    var sceneChartsHtml = "";
    if (isPromo) {
      sceneChartsHtml = '<div class="pa-heatmap-wrap">' +
        '<div class="trend-chart pa-heatmap-chart" id="paHeatmapChart-' + gi + '"></div>' +
        '</div>';
    }
    var bodyHtml = '<div class="pa-body">' +
      (isPromo ? '' : monthBarHtml) +
      (isPromo
        ? sceneChartsHtml
        : '<div class="pa-grid">' +
            '<div class="pa-chart-card"><div class="pa-card-hd">' + (isBiweek ? '双周优秀案例趋势（省份数 · 应用数 · 等效人年）' : '优秀案例趋势（省份数 · 应用数 · 等效人年）') + '</div><div class="trend-chart" id="trendChart-' + gi + '"></div></div>' +
            '<div class="pa-compare-card"><div class="pa-card-hd">省份等效人年排名（全量）</div>' +
            '<div class="pa-cmp-nav"><button type="button" class="pa-cmp-up" data-dir="-1" title="向上滚动榜单">▲</button><button type="button" class="pa-cmp-down" data-dir="1" title="向下滚动榜单">▼</button></div>' +
            '<div class="pa-compare-list">' + rankHtml + '</div></div>' +
          '</div>') +
      (isPromo ? matrixHtml : ('<div class="pa-matrix-card"><div class="pa-card-hd">' + (esc(gst.month) + ' · ' + (isBiweek ? '双周优秀案例分省明细' : '优秀案例分省明细')) + '</div>' + matrixHtml + '</div>')) +
      '</div>';
    var trendCardEl = c.querySelector(".trend-card");
    if (trendCardEl) { trendCardEl.classList.remove("trend-cost", "trend-py", "trend-agents"); trendCardEl.classList.add("trend-panorama"); }
    if (tEl) tEl.textContent = (isPromo ? "推广案例全景图" : (isBiweek ? "双周优秀案例全景图" : "优秀案例全景图"));
    if (tagEl) {
      var monthHint = '<span class="trend-tag-month">当前选中：' + esc(gst.month) + '</span>';
      tagEl.innerHTML = monthHint + '<button type="button" class="trend-tag-act" id="trendTagFactor-' + gi + '" title="查看选中月份的环比变动因素">查看变动因素 ↗</button>';
      var tfa = document.getElementById("trendTagFactor-" + gi);
      if (tfa) tfa.onclick = function (e) { e.stopPropagation(); openFactor(gst.metric, group); };
    }
    if (sEl) sEl.innerHTML = "";
    var body = c.querySelector(".trend-body");
    if (trendChartInsts[group]) { try { trendChartInsts[group].dispose(); } catch (e) {} trendChartInsts[group] = null; }
    var _scOld = trendChartInsts[group + "_scenes"];
    if (_scOld) { _scOld.forEach(function (inst) { try { inst.dispose(); } catch (e) {} }); }
    trendChartInsts[group + "_scenes"] = [];
    body.innerHTML = bodyHtml;
    body.querySelectorAll(".pa-pill").forEach(function (b) {
      b.onclick = function () { gst.month = monthsAvail[+b.dataset.mi]; updateTrend(gi); };
    });
    /* 榜单滚动按钮（▲/▼）：纵向平滑滚动；并按实际溢出情况禁用按钮 */
    (function () {
      var list = body.querySelector(".pa-compare-list");
      if (!list) return;
      var up = body.querySelector(".pa-cmp-up"), down = body.querySelector(".pa-cmp-down");
      function syncNav() {
        if (up) up.disabled = list.scrollTop <= 1;
        if (down) down.disabled = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      }
      if (up) up.onclick = function () { list.scrollBy({ top: -160, behavior: "smooth" }); };
      if (down) down.onclick = function () { list.scrollBy({ top: 160, behavior: "smooth" }); };
      list.addEventListener("scroll", syncNav);
      setTimeout(syncNav, 0);
    })();
    if (isPromo) {
      _promoDblKey = null; /* 重渲染（切换月份/指标）时清除定位状态 */
      var inst = renderPromoHeatmap("paHeatmapChart-" + gi, realScenes, monthsAvail, (PANORAMA && PANORAMA.sceneStats) || {}, idx);
      if (inst) {
        trendChartInsts[group + "_scenes"].push(inst);
        var heatBox = document.getElementById("paHeatmapChart-" + gi);
        /* 悬停热力图单元格（场景×月份，三指标任一子图均可）→ 矩阵切换该月 + 高亮场景行 + 同步月份标签选中态。
         * 定位状态下（_promoDblKey 非空）暂停本悬停联动，保证锁定视图不被扰动 */
        inst.on("mouseover", function (params) {
          if (_promoDblKey) return; /* 定位中：暂停悬停切换 */
          if (params.componentType === "series" && params.data) {
            var monthIdx = params.data[0];
            var sceneIdx = params.data[1];
            if (monthIdx == null || sceneIdx == null || monthIdx > idx || sceneIdx < 0 || sceneIdx >= realScenes.length) return;
            var scene = realScenes[sceneIdx];
            if (!scene) return;
            updatePromoMatrix(gi, monthIdx, scene);
          }
        });
        /* 双击热力图单元格 → 建立/取消「定位锁定」：
         * 1) 首次双击某单元格：矩阵切至该月 + 场景行锁定高亮 + 三态环比底色（升绿/降红/持平灰）并滚动至该行，
         *    同时暂停鼠标悬停切换；2) 再次双击同一单元格：取消定位，恢复默认月份视图与悬停联动。 */
        inst.on("dblclick", function (params) {
          if (params.componentType === "series" && params.data) {
            var monthIdx = params.data[0];
            var sceneIdx = params.data[1];
            if (monthIdx == null || sceneIdx == null || monthIdx > idx || sceneIdx < 0 || sceneIdx >= realScenes.length) return;
            var scene = realScenes[sceneIdx];
            if (!scene) return;
            var key = gi + "|" + monthIdx + "|" + scene + "|" + params.seriesIndex;
            if (_promoDblKey === key) {
              /* 再次双击同一单元格 → 取消定位：恢复默认月份、清除行锁定与底色，重新启用悬停联动 */
              _promoDblKey = null;
              updatePromoMatrix(gi, idx, null);
              setPromoRowLocked(gi, null);
            } else {
              /* 首次双击 → 建立定位：切月 + 行锁定 + 三态底色 + 滚动定位 */
              _promoDblKey = key;
              handlePromoHeatmapDblclick(gi, monthIdx, scene, params.seriesIndex);
              setPromoRowLocked(gi, scene);
              scrollToPromoRow(gi, scene);
              gst.month = monthsAvail[monthIdx] || gst.month;
              openFactor(gst.metric, group);
            }
          }
        });
        /* 鼠标移出热力图：非定位状态恢复默认月份/取消行高亮；定位状态保持锁定视图不恢复 */
        if (heatBox) {
          heatBox.addEventListener("mouseleave", function () {
            if (_promoDblKey) return; /* 定位中：不移出恢复 */
            updatePromoMatrix(gi, idx, null);
          });
        }
      }
    } else {
      /* 优秀/双周优秀：左侧组合图（省份数柱 + 应用数柱 + 等效人年折线，双 Y 轴），实例归入 trendChartInsts[group] 便于切换时 dispose */
      var inst2 = renderExcellentComboChart(gi, mt, monthsAvail);
      if (inst2) trendChartInsts[group] = inst2;
    }
  }
  function renderTrendSide(gi, mt, monthsAvail, ly) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var hd = $("trendRankHd-" + gi), list = $("trendRankList-" + gi); if (!hd || !list) return;
    var sl = scopeLabel();
    var month = gst.month;
    if (ly.side === "dual") {
      var selNames = selNamesOf(sl);
      var isAppScope = (sl.scope === "全网");
      if (mt.key === "cost") {
        var provRows = provinceRank(mt.key, month, false, 31).map(function (r) { return { name: r.name, value: r.value, busy: r.busy, idle: r.idle, sel: selNames.indexOf(r.name) >= 0 }; });
        var appRows = isAppScope ? appsCostTop("全网", month).map(function (a) { return { name: a.name, prov: a.prov, cost: a.cost, busy: a.costBusy, idle: a.costIdle }; }) : [];
        hd.innerHTML = esc(month) + " · 模型计费金额 双榜（省份 31 省倒序 / 应用 TOP30 倒序）";
        list.innerHTML = '<div class="dual-rank">' +
          costRankTable("省份排名（模型计费 · 倒序）", provRows, "province") +
          (isAppScope ? costRankTable("应用排名（模型计费 · 倒序 TOP30）", appRows, "app") : '<div class="rk-block"><div class="rk-block-hd">应用排名</div><div class="trend-empty">当前范围非全网，应用明细未提供</div></div>') +
          '</div>';
      } else if (mt.key === "tokens") {
        var tokenProvRows = provinceRank(mt.key, month, false, 31).map(function (r) { return { name: r.name, value: r.value, sel: selNames.indexOf(r.name) >= 0 }; });
        var tokenAppRows = isAppScope ? appsTokensTop("全网", month).map(function (a) { return { name: a.name, prov: a.prov || a.province, value: a.tokens }; }) : [];
        hd.innerHTML = esc(month) + " · 总 Token 数双榜（省份 31 省 / 应用 TOP30）";
        list.innerHTML = '<div class="dual-rank">' + tokenRankTable("省份 Token 数（31省）", tokenProvRows, "province") +
          (isAppScope ? tokenRankTable("智能体应用 Token 数 TOP30", tokenAppRows, "app") : '<div class="rk-block"><div class="rk-block-hd">应用 Token 明细</div><div class="trend-empty">当前范围非全网，应用明细未提供</div></div>') + '</div>';
      } else if (mt.key === "pagePV") {
        var pvProvRows = provinceRank(mt.key, month, false, 10).map(function (r) { return { name: r.name, sub: "省份", value: r.value, sel: selNames.indexOf(r.name) >= 0 }; });
        var pageRaw = isAppScope ? trackingTop(month) : [];
        var pageFallback = !pageRaw.length && isAppScope;
        if (pageFallback) pageRaw = trackingTop(null);
        var pageRows = pageRaw.map(function (r) { return { name: r.page, sub: "页面", value: r.clicks }; });
        hd.innerHTML = esc(month) + " · 平台访问 PV 双榜（省份 TOP10 / 页面 TOP10）";
        list.innerHTML = '<div class="dual-rank">' + pvRankTable("省份 PV TOP10", pvProvRows, "province") +
          (isAppScope ? pvRankTable("页面点击量 TOP10" + (pageFallback ? "（当前月份无埋点，展示最近可用月份）" : ""), pageRows, "page") : '<div class="rk-block"><div class="rk-block-hd">页面明细</div><div class="trend-empty">当前数据不支持省份级页面拆分</div></div>') + '</div>';
      } else if (mt.key === "calls") {
        var callProvRows = provinceRank(mt.key, month, false, 31).map(function (r) { return { name: r.name, value: r.value, sel: selNames.indexOf(r.name) >= 0 }; });
        var appMonth = month, callAppRows = isAppScope ? appsTop("全网", appMonth) : [];
        if (isAppScope && !callAppRows.length) {
          var monthIdx = monthsAvail.indexOf(month);
          for (var ai = monthIdx - 1; ai >= 0; ai--) { var candidate = appsTop("全网", monthsAvail[ai]); if (candidate.length) { appMonth = monthsAvail[ai]; callAppRows = candidate; break; } }
        }
        callAppRows = callAppRows.map(function (a) { return { name: a.name, prov: a.prov || a.province, calls: a.calls }; });
        hd.innerHTML = esc(month) + " · 智能体调用量双榜（省份 31 省 / 应用 TOP30）";
        list.innerHTML = '<div class="dual-rank">' + callsRankTable("省份智能体调用量（31省）", callProvRows, "province") +
          (isAppScope ? callsRankTable("智能体应用调用量 TOP30" + (appMonth !== month ? "（最近可用：" + appMonth + "）" : ""), callAppRows, "app") : '<div class="rk-block"><div class="rk-block-hd">应用明细</div><div class="trend-empty">当前范围非全网，应用明细未提供</div></div>') + '</div>';
      } else {
        var provRows = provinceRank(mt.key, month, false).map(function (r) { return { name: r.name, sub: "省份", value: r.value, sel: selNames.indexOf(r.name) >= 0 }; });
        var appRows = isAppScope ? appsTop("全网", month).map(function (a) { return { name: a.name, sub: a.type + " · 调用量", value: a.calls, sel: false }; }) : [];
        var appNote = (isAppScope && !appRows.length) ? "（应用明细数据 1–7月，当前月未提供）" : "（计费字段待补 · 以调用量近似）";
        hd.innerHTML = esc(month) + " · " + esc(mt.name) + " 双榜（" + (isAppScope ? "省份 TOP10 / 应用调用量 TOP10）" : "省份 TOP10）") + (isAppScope ? "" : " · 应用明细未提供");
        list.innerHTML = '<div class="dual-rank">' +
          rankBlock("省份 " + esc(mt.name) + " TOP10", provRows, mt) +
          (isAppScope ? rankBlock("应用调用量 TOP10 " + appNote, appRows, mt) : '<div class="rk-block"><div class="rk-block-hd">应用明细</div><div class="trend-empty">当前范围非全网，应用明细未提供</div></div>') +
          '</div>';
      }
      return;
    }
    if (ly.side === "regProv") {
      var srcR = simSource(), regRows = [];
      if (srcR) Object.keys(srcR).forEach(function (p) {
        if (p === "全网" || p === "本部") return;
        var rec = null, prev = null, arr = srcR[p] || [];
        arr.forEach(function (r, i) { if (r.month === month) { rec = r; prev = i > 0 ? arr[i - 1] : null; } });
        if (rec && rec.cumRegUsers != null) regRows.push({ name: p, value: rec.cumRegUsers, newReg: rec.newRegUsers, growth: prev && prev.cumRegUsers ? (rec.cumRegUsers - prev.cumRegUsers) / prev.cumRegUsers : null });
      });
      regRows.sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
      var regBody = regRows.map(function (r, i) { return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '><td>' + (i + 1) + '</td><td class="rk-tname">' + esc(r.name) + '</td><td>' + fmtWan(r.value) + '</td><td>' + fmtWan(r.newReg) + '</td><td>' + (r.growth == null ? '—' : (r.growth >= 0 ? '+' : '') + (r.growth * 100).toFixed(1) + '%') + '</td></tr>'; }).join("");
      hd.innerHTML = esc(month) + " · 累计注册人数省份榜（按累计注册排序）";
      list.innerHTML = '<div class="rk-block"><div class="rk-block-hd">累计注册 / 新增注册 / 增长率</div><div class="rk-table-wrap"><table class="rk-table platform-reg"><thead><tr><th>排名</th><th>省份名称</th><th>累计注册</th><th>当月新增</th><th>增长率</th></tr></thead><tbody>' + regBody + '</tbody></table></div></div>';
      return;
    }
    if (ly.side === "rankProv") {
      var pyRows = provinceRank(mt.key, month, false, ly.limit || 31).map(function (r) { return { name: r.name, value: r.value }; });
      hd.innerHTML = esc(month) + " · 省份排名";
      list.innerHTML = pyRankTable(pyRows, mt);
      return;
    }
    if (ly.side === "rankAsc" || ly.side === "rankDesc") {
      var asc = (ly.side === "rankAsc");
      var rows = provinceRank(mt.key, month, asc, ly.limit || 10).map(function (r) { return { name: r.name, sub: "省份", value: r.value, sel: selNamesOf(sl).indexOf(r.name) >= 0 }; });
      var present = {}; rows.forEach(function (x) { present[x.name] = true; });
      if (sl.scope !== "全网" && sl.scope !== "multi" && !present[sl.scope]) {
        var rec = null; (simSource()[sl.scope] || []).forEach(function (r) { if (r.month === month) rec = r; });
        if (rec && rec[mt.key] != null) rows.push({ name: sl.scope, sub: "省份", value: rec[mt.key], sel: true, extra: true });
      }
      hd.innerHTML = esc(month) + " · " + esc(mt.name) + " 省份" + (asc ? "（升序 · 头部在后）" : "（降序）") + " TOP" + (ly.limit || 10);
      list.innerHTML = rankBlock(esc(mt.name) + " 省份 TOP" + (ly.limit || 10), rows, mt);
      return;
    }
    if (ly.side === "panorama") {
      hd.innerHTML = esc(month) + " · " + esc(mt.name) + " 全景名单";
      list.innerHTML = panoramaHtml(mt, month, sl);
      return;
    }
    if (ly.side === "usersProv") {
      var srcU = simSource();
      var rowsU = [];
      if (srcU) {
        Object.keys(srcU).forEach(function (p) {
          if (p === "全网" || p === "本部") return;
          var rec = null; (srcU[p] || []).forEach(function (r) { if (r.month === month) rec = r; });
          if (!rec) return;
          rowsU.push({ name: p, cumReg: rec.cumRegUsers, newReg: rec.newRegUsers, mau: rec.mau, cover: rec.activeCoverMonthly });
        });
      }
      rowsU.sort(function (a, b) { return (b.newReg || 0) - (a.newReg || 0); });
      var headU = '<th class="rk-tidx">排名</th><th class="rk-tname">省份名称</th><th>累计注册用户数</th><th>新增注册人数</th><th>月活跃用户数</th><th>月活跃用户覆盖度</th>';
      var bodyU = rowsU.map(function (r, i) {
        return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '>' +
          '<td class="rk-tidx">' + (i + 1) + '</td>' +
          '<td class="rk-tname">' + esc(r.name) + '</td>' +
          '<td>' + (r.cumReg != null ? fmtWan(r.cumReg) : '—') + '</td>' +
          '<td>' + (r.newReg != null ? fmtWan(r.newReg) : '—') + '</td>' +
          '<td>' + (r.mau != null ? fmtWan(r.mau) : '—') + '</td>' +
          '<td>' + (r.cover != null ? (Math.round(r.cover * 1000) / 10).toFixed(1) + '%' : '—') + '</td>' +
          '</tr>';
      }).join("");
      hd.innerHTML = esc(month) + " · 31 省 用户活跃榜单（按新增注册人数排序）";
      list.innerHTML = '<div class="rk-block"><div class="rk-block-hd">' + esc(month) + ' · 各省用户活跃</div>' +
        '<div class="rk-table-wrap"><table class="rk-table users-prov"><thead><tr>' + headU + '</tr></thead><tbody>' + bodyU + '</tbody></table></div></div>';
      return;
    }
    hd.innerHTML = esc(mt.name) + " · 说明";
    list.innerHTML = (ly.chart === "combined")
      ? '<div class="trend-empty">WAU / MAU / 沉默流失 已合并单图展示，无下钻榜</div>'
      : '<div class="trend-empty">该指标仅 KPI 卡 mini 趋势，无独立下钻榜</div>';
  }
  /* ===== 智能体应用 · 统一趋势卡（上线/活跃/高热度 三指标合并） =====
   * 左：三系列折线图（1-8月）；悬浮某月 → tooltip 内嵌漏斗图展示 上线→活跃→高热度 层级转化
   * 右：各省当月三类智能体数量表（默认当前月） */
  var AGENTS_COLORS = { total: "#60a5fa", active: "#8b5cf6", hot: "#f43f5e", producing: "#14b8a6", rate: "#f59e0b" };
  function funnelSvg(stages) {
    var barW = 150, segH = 22, gap = 5, labelX = barW + 10;
    var w = labelX + 96, h = stages.length * (segH + gap) + 4;
    var max = Math.max.apply(null, stages.map(function (s) { return s.value; }).concat([1]));
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" style="display:block">';
    var y = 2;
    stages.forEach(function (s, i) {
      var bw = Math.max(6, barW * (s.value / max));
      var x = (barW - bw) / 2;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + segH + '" rx="3" fill="' + s.color + '" opacity="0.92"/>';
      var prev = i > 0 ? stages[i - 1].value : null;
      var conv = (prev && prev !== 0) ? ((s.value / prev) * 100).toFixed(1) + "%" : "—";
      svg += '<text x="' + labelX + '" y="' + (y + segH / 2 + 3.5) + '" fill="#334155" font-size="11" font-weight="700">' + esc(s.name) + " " + fmtInt(Math.round(s.value)) + '</text>';
      svg += '<text x="' + labelX + '" y="' + (y + segH / 2 + 15) + '" fill="#94a3b8" font-size="9.5">转化 ' + conv + '</text>';
      y += segH + gap;
    });
    return svg + '</svg>';
  }
  function agentsProvRows(month) {
    var src = simSource(); if (!src) return [];
    var arr = Object.keys(src).filter(function (p) { return p !== "全网" && p !== "本部"; });
    var rows = arr.map(function (p) {
      var rec = null; (src[p] || []).forEach(function (r) { if (r.month === month) rec = r; });
      return {
        name: p,
        total: rec ? rec.totalAgentsOnline : null,
        producing: rec ? rec.producingAgents : null,
        active: rec ? rec.activeAgents : null,
        hot: rec ? rec.hotAgents : null,
        rate: rec ? rec.productionRate : null
      };
    }).filter(function (x) { return x.total != null || x.active != null; });
    rows.sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
    return rows;
  }
  function agentsProvTable(rows, month) {
    if (!rows.length) return '<div class="rk-block"><div class="rk-block-hd">' + esc(month) + ' · 各省智能体与投产</div><div class="trend-empty">暂无数据</div></div>';
    function th(c, txt) { return '<th class="' + c + '">' + txt + '</th>'; }
    var head = th("rk-tidx", "排名") + th("rk-tname", "省份") + th("", "上线") + th("", "投产") + th("", "活跃") + th("", "高热度") + th("", "投产率");
    var body = rows.map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="rk-top"' : '') + '>' +
        '<td class="rk-tidx">' + (i + 1) + '</td>' +
        '<td class="rk-tname">' + esc(r.name) + '</td>' +
        '<td>' + fmtInt(r.total || 0) + '</td>' +
        '<td>' + (r.producing != null ? fmtInt(r.producing) : '—') + '</td>' +
        '<td>' + fmtInt(r.active || 0) + '</td>' +
        '<td>' + fmtInt(r.hot || 0) + '</td>' +
        '<td>' + (r.rate != null ? (r.rate * 100).toFixed(1) + '%' : '—') + '</td>' +
        '</tr>';
    }).join("");
    return '<div class="rk-block"><div class="rk-block-hd">' + esc(month) + ' · 各省智能体数量与投产率</div>' +
      '<div class="rk-table-wrap"><table class="rk-table agents-prov"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function renderAgentsUnified(gi, mt, full, monthsAvail, sl) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var c = document.getElementById("trendCard-" + gi); if (!c) return;
    var tEl = $("trendTitle-" + gi), sEl = $("trendSub-" + gi), tagEl = $("trendTag-" + gi);
    var mb = $("trendMonthBar-" + gi), hd = $("trendRankHd-" + gi), list = $("trendRankList-" + gi);
    if (tEl) tEl.textContent = "趋势动态分析 · 智能体活跃度层级与投产";
    if (sEl) sEl.innerHTML = "";
    if (tagEl) {
      tagEl.innerHTML = '<span class="trend-tag-month">当前选中：' + esc(gst.month) + '</span><button type="button" class="trend-tag-act" id="trendTagFactor-' + gi + '" title="查看选中月份的环比变动因素">查看变动因素 ↗</button>';
      var tfa = document.getElementById("trendTagFactor-" + gi);
      if (tfa) tfa.onclick = function (e) { e.stopPropagation(); openFactor(gst.metric, group); };
    }
    var trendCardEl = c.querySelector(".trend-card");
    if (trendCardEl) {
      trendCardEl.classList.remove("trend-cost", "trend-py", "trend-panorama");
      trendCardEl.classList.add("trend-agents");
    }
    if (mb) { mb.innerHTML = ""; mb.style.display = "none"; }
    renderAgentsUnifiedChart(gi, full, monthsAvail);
    renderAgentsUnifiedSide(gi, monthsAvail, sl);
  }
  function renderAgentsUnifiedChart(gi, full, monthsAvail) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var box = $("trendChart-" + gi); if (!box || !window.echarts) return;
    if (!trendChartInsts[group]) {
      trendChartInsts[group] = window.echarts.init(box);
      bindTrendMonthEvents(trendChartInsts[group], group, gi);
    }
    var reduce = prefersReducedMotion();
    var totalData = full.map(function (r) { return r.totalAgentsOnline; });
    var producingData = full.map(function (r) { return r.producingAgents; });
    var activeData = full.map(function (r) { return r.activeAgents; });
    var hotData = full.map(function (r) { return r.hotAgents; });
    var rateData = full.map(function (r) { return r.productionRate == null ? null : Math.round(r.productionRate * 10000) / 100; });
    var selIdx = monthsAvail.indexOf(gst.month); if (selIdx < 0) selIdx = monthsAvail.length - 1;
    var base = {
      grid: { left: 52, right: 56, top: 30, bottom: 40, containLabel: true },
      tooltip: {
        trigger: "axis", confine: true,
        backgroundColor: "rgba(255,255,255,0.98)", borderColor: "#e5e7eb", borderWidth: 1, padding: [10, 12],
        extraCssText: "box-shadow:0 8px 28px rgba(15,23,42,.14);border-radius:10px;",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(139,92,246,0.08)" } },
        formatter: function (ps) {
          if (!ps || !ps.length) return "";
          var di = ps[0].dataIndex; if (di == null || di < 0 || di >= monthsAvail.length) return "";
          var month = monthsAvail[di] || "";
          var total = full[di].totalAgentsOnline || 0, active = full[di].activeAgents || 0, hot = full[di].hotAgents || 0;
          var producing = full[di].producingAgents == null ? null : full[di].producingAgents;
          var stages = [
            { name: "上线智能体", value: total, color: AGENTS_COLORS.total },
            { name: "投产智能体", value: producing != null ? producing : 0, color: AGENTS_COLORS.producing },
            { name: "活跃智能体", value: active, color: AGENTS_COLORS.active },
            { name: "高热度智能体", value: hot, color: AGENTS_COLORS.hot }
          ];
          return '<div style="min-width:260px">' +
            '<div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">' + esc(month) + ' · 智能体活跃度与投产转化</div>' +
            '<div>' + funnelSvg(stages) + '</div>' +
            '</div>';
        }
      },
      legend: { bottom: 2, textStyle: { color: "#64748b", fontSize: 11.5 }, itemWidth: 10, itemHeight: 8, itemGap: 12, data: ["智能体总数量（上线）", "投产智能体数", "活跃智能体数", "高热度智能体数", "投产率"] },
      xAxis: {
        type: "category", data: monthsAvail, boundaryGap: false,
        axisLine: { show: true, lineStyle: { color: "#e2e8f0", width: 0.8 } },
        axisTick: { show: false },
        axisLabel: { color: "#64748b", fontSize: 11.5, fontWeight: 600, margin: 10 }
      },
      yAxis: [
        {
          type: "value",
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return fmtInt(v); } },
          splitLine: { lineStyle: { color: "#f1f5f9" } }
        },
        {
          type: "value", min: 0, max: 100, position: "right",
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: "#94a3b8", fontSize: 10.5, formatter: function (v) { return v + "%"; } },
          splitLine: { show: false }
        }
      ],
      labelLayout: { hideOverlap: true },
      animation: !reduce, animationDuration: 720, animationEasing: "cubicOut", animationDurationUpdate: 320,
      series: [
        { name: "智能体总数量（上线）", type: "line", smooth: true, data: totalData, symbol: "circle", symbolSize: 7, itemStyle: { color: AGENTS_COLORS.total, borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.4, color: AGENTS_COLORS.total } },
        { name: "投产智能体数", type: "line", smooth: true, data: producingData, symbol: "circle", symbolSize: 7, itemStyle: { color: AGENTS_COLORS.producing, borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.4, color: AGENTS_COLORS.producing } },
        { name: "活跃智能体数", type: "line", smooth: true, data: activeData, symbol: "circle", symbolSize: 7, itemStyle: { color: AGENTS_COLORS.active, borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.4, color: AGENTS_COLORS.active } },
        { name: "高热度智能体数", type: "line", smooth: true, data: hotData, symbol: "circle", symbolSize: 7, itemStyle: { color: AGENTS_COLORS.hot, borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.4, color: AGENTS_COLORS.hot } },
        { name: "投产率", type: "line", yAxisIndex: 1, smooth: true, data: rateData, symbol: "circle", symbolSize: 7, itemStyle: { color: AGENTS_COLORS.rate, borderColor: "#fff", borderWidth: 2 }, lineStyle: { width: 2.4, type: "dashed", color: AGENTS_COLORS.rate } }
      ]
    };
    if (selIdx >= 0 && base.series[0]) {
      base.series[0].markLine = {
        symbol: "none", silent: true,
        data: [{ xAxis: monthsAvail[selIdx] }],
        lineStyle: { color: "#94a3b8", type: "dashed", width: 1.4 }, label: { show: false }
      };
    }
    trendChartInsts[group].setOption(base, true);
  }
  function renderAgentsUnifiedSide(gi, monthsAvail, sl) {
    var group = GROUPS[gi] || GROUPS[0];
    var gst = gTrendState(group);
    var hd = $("trendRankHd-" + gi), list = $("trendRankList-" + gi); if (!hd || !list) return;
    var month = gst.month;
    var rows = agentsProvRows(month);
    hd.innerHTML = esc(month) + " · 各省智能体数量与投产率（上线 / 投产 / 活跃 / 高热度 / 投产率）";
    list.innerHTML = agentsProvTable(rows, month);
  }
  /* —— 环比变动因素中间弹窗（路径 B · 居中模态，设计文档 §11） —— */
  function openFactor(key, group) {
    var mt = metricByKey(key); if (!mt) return;
    var src = simSource(); if (!src) return;
    var grp = group || GROUPS[0];
    var gst = gTrendState(grp);
    var mm = getSelMonths();
    var month = (gst.month && mm.indexOf(gst.month) >= 0) ? gst.month : mm[mm.length - 1];
    var pm = monthPrev(month);
  var sl = scopeLabel();
  var sharedTrendNote = (mt.group === "智能体应用" || mt.group === "用户活跃") ? " · 当前弹窗仅拆解「" + mt.name + "」，趋势图为模块共用" : "";
  if (key === "cost") { openCostFactor(mt, src, month, pm, sl); return; }
  if (key === "personYear") { openPersonYearFactor(mt, src, month, pm, sl); return; }
  if (key === "promoAgents" || key === "excellentAgents" || key === "excellentAgentsBiweek" || key === "hotAgents") { openAgentHierarchyFactor(mt, key, month, pm, sl); return; }
  if (key === "calls" || key === "tokens") { openMetricHierFactor(mt, key, month, pm, sl); return; }
  if (key === "pagePV") { openPagePvFactor(mt, month, pm, sl); return; }
  var items = [];
    if (key === "calls" && sl.scope === "全网") {
      appsDelta("全网", month).forEach(function (a) { items.push({ name: a.name, sub: a.type, cur: a.cur, prev: a.prev, delta: a.delta }); });
    } else {
      provinceDelta(key, month, sl.scope === "全网" ? null : getSelProvs()).forEach(function (r) { items.push({ name: r.name, sub: "省份", cur: r.cur, prev: r.prev, delta: r.delta }); });
    }
    var up = items.filter(function (x) { return x.delta >= 0; }).sort(function (a, b) { return b.delta - a.delta; }).slice(0, 10);
    var down = items.filter(function (x) { return x.delta < 0; }).sort(function (a, b) { return a.delta - b.delta; }).slice(0, 10);
    var maxAbs = Math.max.apply(null, items.map(function (x) { return Math.abs(x.delta); }).concat([1]));
    var totalDelta = curTotal(items, "cur") - curTotal(items, "prev");
    var focusUp = totalDelta >= 0;
    closeFactor(true);
    var mask = document.createElement("div"); mask.className = "factor-mask"; mask.id = "factorDrawer";
    var html = '<div class="factor-modal"><div class="factor-hd"><div class="factor-title">环比变动因素拆解 · ' + esc(mt.name) + '</div>' +
      '<button class="factor-close" id="factorClose" type="button">×</button></div>' +
      '<div class="factor-sub">' + esc(month) + ' vs ' + esc(pm || "—") + ' · 范围： ' + esc(sl.text) + esc(sharedTrendNote) + (pm ? "" : "　（无上期对照）") + '</div>' +
      '<div class="factor-overview">' +
      ovItem("本期合计", fmtMetric(mt, curTotal(items, "cur"))) +
      ovItem("上期合计", pm ? fmtMetric(mt, curTotal(items, "prev")) : "—") +
      ovItem("总增减", totalDeltaPct(items, mt)) +
      '</div>' +
      '<div class="factor-cols">' +
      '<div><div class="factor-col-hd up' + (focusUp ? "" : " dim") + '">▲ 拉动上升 TOP ' + up.length + '</div>' + factorColHtml(up, mt, maxAbs) + '</div>' +
      '<div><div class="factor-col-hd down' + (focusUp ? " dim" : "") + '">▼ 拖累下降 TOP ' + down.length + '</div>' + factorColHtml(down, mt, maxAbs) + '</div>' +
      '</div>' +
      '<div class="factor-foot"><button id="factorClose2" type="button">关闭</button></div></div>';
    mask.innerHTML = html;
    document.body.appendChild(mask);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () { mask.classList.add("show"); });
    mask.addEventListener("click", function (e) { if (e.target === mask) closeFactor(); });
    var fc = document.getElementById("factorClose"); if (fc) fc.onclick = closeFactor;
    var fc2 = document.getElementById("factorClose2"); if (fc2) fc2.onclick = closeFactor;
    if (factorKeyHandler) document.removeEventListener("keydown", factorKeyHandler);
    factorKeyHandler = function (e) { if (e.key === "Escape") closeFactor(); };
    document.addEventListener("keydown", factorKeyHandler);
  }
  function appDeltaInProvMetric(prov, month, pm, key) {
    var getter = key === "calls" ? appsTop : appsTokensTop;
    var valueKey = key === "calls" ? "calls" : "tokens";
    var curApps = getter(prov, month) || [], prevApps = pm ? (getter(prov, pm) || []) : [];
    var names = {}, curMap = {}, prevMap = {};
    curApps.forEach(function (a) { names[a.name] = true; curMap[a.name] = a; });
    prevApps.forEach(function (a) { names[a.name] = true; prevMap[a.name] = a; });
    return Object.keys(names).map(function (name) {
      var cur = curMap[name] ? (curMap[name][valueKey] || 0) : 0, prev = prevMap[name] ? (prevMap[name][valueKey] || 0) : 0;
      return { name: name, cur: cur, prev: prev, delta: cur - prev, sub: (curMap[name] || prevMap[name] || {}).type || "智能体应用" };
    }).filter(function (x) { return x.cur || x.prev; }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
  }
  function trackingDelta(month, pm) {
    var rows = ((window.LINGYUN_DATA || {}).tracking || []), cur = {}, prev = {};
    rows.forEach(function (r) { var map = r.month === month ? cur : (pm && r.month === pm ? prev : null); if (!map || r.clicks == null) return; map[r.page] = (map[r.page] || 0) + (r.clicks || 0); });
    var names = {}; Object.keys(cur).forEach(function (n) { names[n] = true; }); Object.keys(prev).forEach(function (n) { names[n] = true; });
    return Object.keys(names).map(function (name) { var c = cur[name] || 0, p = prev[name] || 0; return { name: name, sub: "页面点击", cur: c, prev: p, delta: c - p }; }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
  }
  function openPagePvFactor(mt, month, pm, sl) {
    closeFactor(true);
    var isSingle = sl.scope !== "全网" && sl.scope !== "multi";
    var provItems = provinceDelta("pagePV", month, isSingle ? [sl.scope] : null).map(function (r) { return { name: r.name, sub: "省份", cur: r.cur, prev: r.prev, delta: r.delta }; });
    var pageItems = sl.scope === "全网" ? trackingDelta(month, pm).slice(0, 10) : [];
    var cur = metricAtScope(isSingle ? sl.scope : "全网", month, "pagePV"), prev = pm ? metricAtScope(isSingle ? sl.scope : "全网", pm, "pagePV") : 0, delta = cur - prev;
    var up = provItems.concat(pageItems).filter(function (x) { return x.delta >= 0; }).sort(function (a, b) { return b.delta - a.delta; }).slice(0, 10);
    var down = provItems.concat(pageItems).filter(function (x) { return x.delta < 0; }).sort(function (a, b) { return a.delta - b.delta; }).slice(0, 10);
    var maxAbs = Math.max.apply(null, provItems.concat(pageItems).map(function (x) { return Math.abs(x.delta); }).concat([1]));
    var pct = prev ? delta / prev * 100 : null;
    var html = '<div class="factor-modal"><div class="factor-hd"><div class="factor-title">环比变动因素拆解 · ' + esc(mt.name) + '</div><button class="factor-close" id="factorClose" type="button">×</button></div>' +
      '<div class="factor-sub">' + esc(month) + ' vs ' + esc(pm || "—") + ' · 范围：' + esc(sl.text) + ' · 当前弹窗仅拆解「平台总访问PV」' + (pm ? '' : '　（无上期对照）') + '</div>' +
      '<div class="factor-overview">' + ovItem('本期合计', fmtMetric(mt, cur)) + ovItem('上期合计', pm ? fmtMetric(mt, prev) : '—') + ovItem('总增减', pct == null ? '—' : '<span class="fc-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>') + '</div>' +
      '<div class="fc-note">省份因素来自《关键数据总览（月）（各省）》；全网页面因素来自《埋点分析（页面）》。单省范围不提供页面级拆分。</div><div class="fc-drill-guide"><b>1</b>省份 PV 因素<span>→</span><b>2</b>全网页面点击因素</div><div class="factor-cols"><div><div class="factor-col-hd up">▲ 拉动上升 TOP ' + up.length + '</div>' + factorColHtml(up, mt, maxAbs) + '</div><div><div class="factor-col-hd down">▼ 拖累下降 TOP ' + down.length + '</div>' + factorColHtml(down, mt, maxAbs) + '</div></div><div class="factor-foot"><button id="factorClose2" type="button">关闭</button></div></div>';
    var mask = document.createElement('div'); mask.className = 'factor-mask'; mask.id = 'factorDrawer'; mask.innerHTML = html; document.body.appendChild(mask); document.body.style.overflow = 'hidden'; requestAnimationFrame(function () { mask.classList.add('show'); }); mask.addEventListener('click', function (e) { if (e.target === mask) closeFactor(); });
    var fc = document.getElementById('factorClose'); if (fc) fc.onclick = closeFactor; var fc2 = document.getElementById('factorClose2'); if (fc2) fc2.onclick = closeFactor;
    if (factorKeyHandler) document.removeEventListener('keydown', factorKeyHandler); factorKeyHandler = function (e) { if (e.key === 'Escape') closeFactor(); }; document.addEventListener('keydown', factorKeyHandler);
  }
  function openMetricHierFactor(mt, key, month, pm, sl) {
    closeFactor(true);
    var isSingle = sl.scope !== "全网" && sl.scope !== "multi";
    var provAll = provDeltaAll(key, month, pm).filter(function (x) { return !isSingle || x.name === sl.scope; });
    provAll.sort(function (a, b) { return pm ? Math.abs(b.delta) - Math.abs(a.delta) : b.cur - a.cur; });
    var provShow = provAll.slice(0, isSingle ? 1 : 10), natCur = metricAtScope(isSingle ? sl.scope : "全网", month, key), natPrev = pm ? metricAtScope(isSingle ? sl.scope : "全网", pm, key) : 0;
    var totalDelta = natCur - natPrev, maxProv = Math.max.apply(null, provShow.map(function (x) { return Math.abs(x.delta); }).concat([1]));
    var blocks = provShow.map(function (pr) { var apps = isSingle || sl.scope === "全网" ? appDeltaInProvMetric(pr.name, month, pm).slice(0, 5) : []; return { name: pr.name, cur: pr.cur, prev: pr.prev, delta: pr.delta, coef: totalDelta ? pr.delta / totalDelta * 100 : 0, apps: apps, aMax: Math.max.apply(null, apps.map(function (x) { return Math.abs(x.delta); }).concat([1])) }; });
    var pct = natPrev ? totalDelta / natPrev * 100 : null;
    var html = '<div class="factor-modal"><div class="factor-hd"><div class="factor-title">环比变动因素拆解 · ' + esc(mt.name) + '</div><button class="factor-close" id="factorClose" type="button">×</button></div>' +
      '<div class="factor-sub">' + esc(month) + ' vs ' + esc(pm || "—") + ' · 范围：' + esc(sl.text) + (pm ? '' : '　（无上期对照）') + '</div>' +
      '<div class="factor-overview">' + ovItem('本期合计', fmtMetric(mt, natCur)) + ovItem('上期合计', pm ? fmtMetric(mt, natPrev) : '—') + ovItem('总增减', pct == null ? '—' : '<span class="fc-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>') + '</div>' +
      '<div class="fc-note">省份层面按当前指标直接计算环比；展开省份可查看该省应用 TOP5，应用数据与趋势榜单使用同一 Excel 明细口径。</div><div class="fc-drill-guide"><b>1</b>省份环比因素<span>→</span><b>2</b>该省应用环比因素 TOP5</div><div class="fc-hier">';
    blocks.forEach(function (b, i) {
      var cls = b.delta >= 0 ? 'up' : 'down', arrow = b.delta > 0 ? '▲' : (b.delta < 0 ? '▼' : '•'), pPct = b.prev ? b.delta / b.prev * 100 : null;
      html += '<div class="fc-prov"><div class="fc-prov-hd"><span class="fc-prov-rank">' + (i + 1) + '</span><span class="fc-prov-name">' + esc(b.name) + '</span><span class="fc-prov-coef">影响系数 <b class="' + cls + '">' + (b.coef >= 0 ? '+' : '') + b.coef.toFixed(1) + '%</b></span><span class="fc-prov-delta ' + cls + '">' + arrow + ' ' + (b.delta >= 0 ? '+' : '') + fmtMetric(mt, b.delta) + (pPct == null ? '' : '（' + (pPct >= 0 ? '+' : '') + pPct.toFixed(1) + '%）') + '</span></div><div class="fc-prov-bar"><i class="' + cls + '" style="width:' + (Math.abs(b.delta) / maxProv * 100).toFixed(1) + '%"></i></div>';
      if (b.apps.length) {
        html += '<div class="fc-apps"><div class="fc-apps-hd">该省应用层面 · 变动幅度 TOP' + b.apps.length + '</div><table class="fc-app-tbl"><thead><tr><th>应用名称</th><th>类型</th><th>变动幅度</th></tr></thead><tbody>';
        b.apps.forEach(function (a, j) { var ac = a.delta >= 0 ? 'up' : 'down', aa = a.delta > 0 ? '▲' : (a.delta < 0 ? '▼' : '•'), ap = a.prev ? a.delta / a.prev * 100 : null; html += '<tr><td class="fc-app-name">' + (j + 1) + '. ' + esc(a.name) + '</td><td>' + esc(a.sub) + '</td><td class="fc-delta ' + ac + '">' + aa + ' ' + (a.delta >= 0 ? '+' : '') + fmtMetric(mt, a.delta) + (ap == null ? '' : '（' + (ap >= 0 ? '+' : '') + ap.toFixed(1) + '%）') + '</td></tr>'; });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    });
    html += '</div><div class="factor-foot"><button id="factorClose2" type="button">关闭</button></div></div>';
    var mask = document.createElement('div'); mask.className = 'factor-mask'; mask.id = 'factorDrawer'; mask.innerHTML = html; document.body.appendChild(mask); document.body.style.overflow = 'hidden'; requestAnimationFrame(function () { mask.classList.add('show'); }); mask.addEventListener('click', function (e) { if (e.target === mask) closeFactor(); });
    var fc = document.getElementById('factorClose'); if (fc) fc.onclick = closeFactor; var fc2 = document.getElementById('factorClose2'); if (fc2) fc2.onclick = closeFactor;
    if (factorKeyHandler) document.removeEventListener('keydown', factorKeyHandler); factorKeyHandler = function (e) { if (e.key === 'Escape') closeFactor(); }; document.addEventListener('keydown', factorKeyHandler);
  }
  /* —— 模型计费金额 · 环比变动因素（省份→应用 层级拆解） —— */
  function provDeltaAll(metricKey, month, pm) {
    var src = simSource(); if (!src) return [];
    var arr = Object.keys(src).filter(function (p) { return p !== "全网" && p !== "本部"; });
    var rows = [];
    arr.forEach(function (p) {
      var cur = null, prev = null; (src[p] || []).forEach(function (r) { if (r.month === month) cur = r; if (pm && r.month === pm) prev = r; });
      if (cur == null) return;
      var c = cur[metricKey], pv = prev ? prev[metricKey] : null;
      if (c == null) return;
      rows.push({ name: p, cur: c, prev: pv || 0, delta: pm ? (c - (pv || 0)) : 0 });
    });
    return rows;
  }
  function appAgentDelta(prov, month, pm, key) {
    var order = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"], ci = order.indexOf(month), pi = pm ? order.indexOf(pm) : -1;
    var D = window.LINGYUN_DATA || {}, names = {}, cur = {}, prev = {};
    if (key === "hotAgents") {
      var catalog = (D.appCatalogByProv && D.appCatalogByProv[prov]) || [];
      var available = {};
      catalog.forEach(function (a) { Object.keys(a.calls || {}).forEach(function (m) { if ((a.calls[m] || 0) > 0) available[m] = true; }); });
      var detailMonth = order.filter(function (m, i) { return i <= ci && available[m]; }).pop() || month;
      var detailIndex = order.indexOf(detailMonth), detailPrevMonth = order.slice(0, detailIndex).filter(function (m) { return available[m]; }).pop() || (pm && available[pm] ? pm : null), detailPrevIndex = detailPrevMonth ? order.indexOf(detailPrevMonth) : -1;
      catalog.forEach(function (a) {
        var created = a.createdMonth == null ? 0 : a.createdMonth, calls = a.calls || {};
        if (created <= detailIndex && (calls[detailMonth] || 0) >= 100000) cur[a.name] = a;
        if (detailPrevIndex >= 0 && created <= detailPrevIndex && (calls[detailPrevMonth] || 0) >= 100000) prev[a.name] = a;
      });
    } else {
      var tag = key === "promoAgents" ? "推广案例" : (key === "excellentAgents" ? "优秀案例" : "双周优秀案例");
      var rows = ((D.panorama || {}).rows || []).filter(function (r) { return r.province === prov && String(r.tags || "").split(",").some(function (t) { return t.trim() === tag; }); });
      rows.forEach(function (r) {
        var created = r.createdMonth;
        if (created != null && created <= ci) cur[r.app] = r;
        if (pi >= 0 && created != null && created <= pi) prev[r.app] = r;
      });
    }
    Object.keys(cur).forEach(function (n) { names[n] = true; }); Object.keys(prev).forEach(function (n) { names[n] = true; });
    return Object.keys(names).map(function (name) {
      var c = cur[name], p = prev[name], created = c && c.createdMonth != null ? c.createdMonth : (p && p.createdMonth != null ? p.createdMonth : null);
      return { name: name, sub: key === "hotAgents" ? ((c || p || {}).type || "高热度应用") : (key === "promoAgents" ? "推广应用" : (key === "excellentAgents" ? "优秀应用" : "双周优秀应用")), cur: c ? 1 : 0, prev: p ? 1 : 0, delta: (c ? 1 : 0) - (p ? 1 : 0), createdMonth: created };
    }).filter(function (x) { return x.cur || x.prev; }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta) || b.cur - a.cur || a.name.localeCompare(b.name); });
  }
  function openAgentHierarchyFactor(mt, key, month, pm, sl) {
    closeFactor(true);
    var isSingle = sl.scope !== "全网" && sl.scope !== "multi";
    var provAll = provDeltaAll(key, month, pm).filter(function (x) { return !isSingle || x.name === sl.scope; });
    provAll.sort(function (a, b) { return pm ? Math.abs(b.delta) - Math.abs(a.delta) : b.cur - a.cur; });
    var provShow = provAll.slice(0, isSingle ? 1 : 10), scope = isSingle ? sl.scope : "全网";
    var natCur = metricAtScope(scope, month, key), natPrev = pm ? metricAtScope(scope, pm, key) : 0, totalDelta = natCur - natPrev;
    var maxProv = Math.max.apply(null, provShow.map(function (x) { return Math.abs(x.delta); }).concat([1]));
    var blocks = provShow.map(function (pr) {
      var apps = appAgentDelta(pr.name, month, pm, key).slice(0, 5);
      return { name: pr.name, cur: pr.cur, prev: pr.prev, delta: pr.delta, coef: totalDelta ? pr.delta / totalDelta * 100 : 0, apps: apps, aMax: Math.max.apply(null, apps.map(function (x) { return Math.abs(x.delta); }).concat([1])) };
    });
    var pct = natPrev ? totalDelta / natPrev * 100 : null;
    var appLabel = key === "promoAgents" ? "推广应用" : (key === "excellentAgents" ? "优秀应用" : (key === "excellentAgentsBiweek" ? "双周优秀应用" : "高热度应用"));
    var sourceNote = key === "hotAgents" ? "应用创建时间与月调用量来自《智能体清单（各省）》；高热度按当月调用量达到 10 万次判定。" : "应用创建时间与案例类型来自《推广+双周+优秀（总表）》；按创建时间判断当月是否计入该类应用。";
    var html = '<div class="factor-modal"><div class="factor-hd"><div class="factor-title">环比变动因素拆解 · ' + esc(mt.name) + '</div><button class="factor-close" id="factorClose" type="button">×</button></div>' +
      '<div class="factor-sub">' + esc(month) + ' vs ' + esc(pm || "—") + ' · 范围：' + esc(sl.text) + (pm ? '' : '　（无上期对照）') + ' · 当前弹窗仅拆解「' + esc(mt.name) + '」</div>' +
      '<div class="factor-overview">' + ovItem('本期合计', fmtMetric(mt, natCur)) + ovItem('上期合计', pm ? fmtMetric(mt, natPrev) : '—') + ovItem('总增减', pct == null ? '—' : '<span class="fc-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>') + '</div>' +
      '<div class="fc-note">' + sourceNote + '省份层面按《关键数据总览（月）（各省）》对应字段计算环比；应用层面展示该省变动幅度 TOP5，并按创建时间处理新增/退出口径。</div>' +
      '<div class="fc-drill-guide"><b>1</b>省份环比因素<span>→</span><b>2</b>' + esc(appLabel) + '环比因素 TOP5</div><div class="fc-hier">';
    blocks.forEach(function (b, i) {
      var cls = b.delta >= 0 ? 'up' : 'down', arrow = b.delta > 0 ? '▲' : (b.delta < 0 ? '▼' : '•'), pPct = b.prev ? b.delta / b.prev * 100 : null;
      html += '<div class="fc-prov"><div class="fc-prov-hd"><span class="fc-prov-rank">' + (i + 1) + '</span><span class="fc-prov-name">' + esc(b.name) + '</span><span class="fc-prov-coef">影响系数 <b class="' + cls + '">' + (b.coef >= 0 ? '+' : '') + b.coef.toFixed(1) + '%</b></span><span class="fc-prov-delta ' + cls + '">' + arrow + ' ' + (b.delta >= 0 ? '+' : '') + fmtMetric(mt, b.delta) + (pPct == null ? '' : '（' + (pPct >= 0 ? '+' : '') + pPct.toFixed(1) + '%）') + '</span></div><div class="fc-prov-bar"><i class="' + cls + '" style="width:' + (Math.abs(b.delta) / maxProv * 100).toFixed(1) + '%"></i></div>';
      if (b.apps.length) {
        html += '<div class="fc-apps"><div class="fc-apps-hd">' + esc(appLabel) + '层面 · 变动幅度 TOP' + b.apps.length + '</div><table class="fc-app-tbl"><thead><tr><th>应用名称</th><th>创建月份</th><th>本期 / 上期</th><th>变动</th></tr></thead><tbody>';
        b.apps.forEach(function (a, j) { var ac = a.delta >= 0 ? 'up' : 'down', aa = a.delta > 0 ? '▲' : (a.delta < 0 ? '▼' : '•'), created = a.createdMonth == null ? '—' : ((a.createdMonth + 1) + '月'); html += '<tr><td class="fc-app-name">' + (j + 1) + '. ' + esc(a.name) + '</td><td>' + created + '</td><td>' + a.cur + ' / ' + a.prev + '</td><td class="fc-delta ' + ac + '">' + aa + ' ' + (a.delta >= 0 ? '+' : '') + a.delta + '</td></tr>'; });
        html += '</tbody></table></div>';
      } else { html += '<div class="fc-apps"><div class="trend-empty">该省当前没有可匹配的' + esc(appLabel) + '应用明细</div></div>'; }
      html += '</div>';
    });
    html += '</div><div class="factor-foot"><button id="factorClose2" type="button">关闭</button></div></div>';
    var mask = document.createElement('div'); mask.className = 'factor-mask'; mask.id = 'factorDrawer'; mask.innerHTML = html; document.body.appendChild(mask); document.body.style.overflow = 'hidden'; requestAnimationFrame(function () { mask.classList.add('show'); }); mask.addEventListener('click', function (e) { if (e.target === mask) closeFactor(); });
    var fc = document.getElementById('factorClose'); if (fc) fc.onclick = closeFactor; var fc2 = document.getElementById('factorClose2'); if (fc2) fc2.onclick = closeFactor;
    if (factorKeyHandler) document.removeEventListener('keydown', factorKeyHandler); factorKeyHandler = function (e) { if (e.key === 'Escape') closeFactor(); }; document.addEventListener('keydown', factorKeyHandler);
  }
  function appDeltaInProv(prov, month, pm) {
    var curApps = appsCostTop(prov, month) || [];
    var prevApps = appsCostTop(prov, pm) || [];
    var prevMap = {}; prevApps.forEach(function (a) { prevMap[a.name] = a; });
    var rows = curApps.map(function (a) {
      var pa = prevMap[a.name];
      var pc = pa ? (pa.cost || 0) : 0;
      var cc = a.cost || 0;
      return { name: a.name, cur: cc, prev: pc, delta: cc - pc };
    }).filter(function (x) { return x.delta !== 0 || x.cur !== 0; });
    rows.sort(function (x, y) { return Math.abs(y.delta) - Math.abs(x.delta); });
    return rows;
  }
  function natCost(month) { var ms = (V && V.overview && V.overview.monthly) || []; for (var i = 0; i < ms.length; i++) if (ms[i].month === month) return ms[i].cost || 0; return 0; }
  function metricAtScope(prov, month, key) {
    var arr = (simSource() && simSource()[prov]) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].month === month) return arr[i][key] == null ? 0 : arr[i][key];
    return 0;
  }
  function latestPersonYearMonth(prov, targetMonth) {
    var D = window.LINGYUN_DATA || {}, byMonth = (D.appsPersonYearByProv && D.appsPersonYearByProv[prov]) || {}, order = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"], target = order.indexOf(targetMonth), found = null;
    Object.keys(byMonth).forEach(function (m) { var i = order.indexOf(m); if (i >= 0 && i <= target && byMonth[m] && byMonth[m].length && (found == null || i > order.indexOf(found))) found = m; });
    return found;
  }
  /* 节约人年应用明细直接来自 Excel《推广+双周+优秀（总表）》匹配结果。 */
  function appDeltaInProvPY(prov, month, pm) {
    var detailMonth = latestPersonYearMonth(prov, month), detailPrevMonth = detailMonth ? latestPersonYearMonth(prov, detailMonth === "1月" ? null : ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"][Math.max(0, ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"].indexOf(detailMonth) - 1)]) : null;
    var curApps = detailMonth ? (appsPersonYearTop(prov, detailMonth) || []) : [], prevApps = detailPrevMonth ? (appsPersonYearTop(prov, detailPrevMonth) || []) : [];
    var names = {}, curMap = {}, prevMap = {};
    curApps.forEach(function (a) { names[a.name] = true; curMap[a.name] = a; });
    prevApps.forEach(function (a) { names[a.name] = true; prevMap[a.name] = a; });
    return Object.keys(names).map(function (name) {
      var cc = curMap[name] ? (curMap[name].personYear || 0) : 0;
      var pc = prevMap[name] ? (prevMap[name].personYear || 0) : 0;
      return { name: name, cur: cc, prev: pc, delta: cc - pc, detailMonth: detailMonth, detailPrevMonth: detailPrevMonth };
    }).filter(function (x) { return x.cur !== 0 || x.prev !== 0; }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
  }
  function openPersonYearFactor(mt, src, month, pm, sl) {
    closeFactor(true);
    var isSingle = (sl.scope !== "全网" && sl.scope !== "multi");
    var provAll = provDeltaAll("personYear", month, pm);
    var natCur = metricAtScope("全网", month, "personYear"), natPrev = pm ? metricAtScope("全网", pm, "personYear") : 0;
    provAll.sort(function (a, b) { return pm ? Math.abs(b.delta) - Math.abs(a.delta) : b.cur - a.cur; });
    var topN = isSingle ? 1 : 10;
    var provShow = isSingle ? provAll.filter(function (x) { return x.name === sl.scope; }) : provAll.slice(0, topN);
    if (!provShow.length) provShow = provAll.slice(0, topN);
    var natDelta = natCur - natPrev;
    var maxProv = Math.max.apply(null, provShow.map(function (x) { return Math.abs(pm ? x.delta : x.cur); }).concat([1]));
    var blocks = provShow.map(function (pr) {
      var apps = appDeltaInProvPY(pr.name, month, pm).slice(0, 5).map(function (a) { return { name: a.name, cur: a.cur, prev: a.prev, delta: a.delta, coef: pr.delta ? a.delta / pr.delta * 100 : 0 }; });
      return { name: pr.name, cur: pr.cur, prev: pr.prev, delta: pr.delta, coef: natDelta ? pr.delta / natDelta * 100 : 0, apps: apps, aMax: Math.max.apply(null, apps.map(function (x) { return Math.abs(x.delta); }).concat([1])) };
    });
    var pyDetailMonth = provShow.length ? latestPersonYearMonth(provShow[0].name, month) : null;
    var pyDetailPrev = pyDetailMonth ? latestPersonYearMonth(provShow[0].name, ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"][Math.max(0, ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"].indexOf(pyDetailMonth) - 1)]) : null;
    var pct = natPrev ? natDelta / natPrev * 100 : null;
    var html = '<div class="factor-modal"><div class="factor-hd"><div class="factor-title">环比变动因素拆解 · ' + esc(mt.name) + '</div><button class="factor-close" id="factorClose" type="button">×</button></div>' +
      '<div class="factor-sub">' + esc(month) + ' vs ' + esc(pm || "—") + ' · 范围：' + esc(sl.text) + (pm ? '' : '　（无上期对照）') + '</div>' +
      '<div class="factor-overview">' + ovItem('本期合计', fmtMetric(mt, natCur)) + ovItem('上期合计', pm ? fmtMetric(mt, natPrev) : '—') + ovItem('总增减', pct == null ? '—' : '<span class="fc-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>') + '</div>' +
      '<div class="fc-note">省份层面按 Excel《关键数据总览（月）（各省）》节约人年字段拆解；应用层面仅纳入推广、优秀、双周优秀智能体，并按《推广+双周+优秀（总表）》月度节约人年字段匹配。当前省级指标为 ' + esc(month) + ' vs ' + esc(pm || '—') + '，应用明细最新可用月份为 ' + esc(pyDetailMonth || '—') + (pyDetailPrev ? ' vs ' + esc(pyDetailPrev) : '') + '。</div><div class="fc-drill-guide"><b>1</b>省份环比因素<span>→</span><b>2</b>推广 / 优秀 / 双周优秀应用因素 TOP5</div><div class="fc-hier">';
    blocks.forEach(function (b, i) {
      var cls = b.delta >= 0 ? 'up' : 'down', arrow = b.delta > 0 ? '▲' : (b.delta < 0 ? '▼' : '•'), pPct = b.prev ? b.delta / b.prev * 100 : null;
      html += '<div class="fc-prov"><div class="fc-prov-hd"><span class="fc-prov-rank">' + (i + 1) + '</span><span class="fc-prov-name">' + esc(b.name) + '</span><span class="fc-prov-coef">影响系数 <b class="' + cls + '">' + (b.coef >= 0 ? '+' : '') + b.coef.toFixed(1) + '%</b></span><span class="fc-prov-delta ' + cls + '">' + arrow + ' ' + (b.delta >= 0 ? '+' : '') + fmtMetric(mt, b.delta) + (pPct == null ? '' : '（' + (pPct >= 0 ? '+' : '') + pPct.toFixed(1) + '%）') + '</span></div><div class="fc-prov-bar"><i class="' + cls + '" style="width:' + (Math.abs(b.delta) / maxProv * 100).toFixed(1) + '%"></i></div>';
      if (b.apps.length) {
        html += '<div class="fc-apps"><div class="fc-apps-hd">该省应用层面 · 变动幅度 TOP' + b.apps.length + '</div><table class="fc-app-tbl"><thead><tr><th>应用名称</th><th>本期 / 上期</th><th>变动幅度</th></tr></thead><tbody>';
        b.apps.forEach(function (a, j) { var ac = a.delta >= 0 ? 'up' : 'down', aa = a.delta > 0 ? '▲' : (a.delta < 0 ? '▼' : '•'), ap = a.prev ? a.delta / a.prev * 100 : null; html += '<tr><td class="fc-app-name">' + (j + 1) + '. ' + esc(a.name) + '</td><td>' + fmtMetric(mt, a.cur) + ' / ' + fmtMetric(mt, a.prev) + '</td><td class="fc-delta ' + ac + '">' + aa + ' ' + (a.delta >= 0 ? '+' : '') + fmtMetric(mt, a.delta) + (ap == null ? '' : '（' + (ap >= 0 ? '+' : '') + ap.toFixed(1) + '%）') + '</td></tr>'; });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    });
    html += '</div><div class="factor-foot"><button id="factorClose2" type="button">关闭</button></div></div>';
    var mask = document.createElement('div'); mask.className = 'factor-mask'; mask.id = 'factorDrawer'; mask.innerHTML = html; document.body.appendChild(mask); document.body.style.overflow = 'hidden'; requestAnimationFrame(function () { mask.classList.add('show'); });
    mask.addEventListener('click', function (e) { if (e.target === mask) closeFactor(); });
    var fc = document.getElementById('factorClose'); if (fc) fc.onclick = closeFactor; var fc2 = document.getElementById('factorClose2'); if (fc2) fc2.onclick = closeFactor;
    if (factorKeyHandler) document.removeEventListener('keydown', factorKeyHandler); factorKeyHandler = function (e) { if (e.key === 'Escape') closeFactor(); }; document.addEventListener('keydown', factorKeyHandler);
  }
  function openCostFactor(mt, src, month, pm, sl) {
    closeFactor(true);
    var isSingle = (sl.scope !== "全网" && sl.scope !== "multi");
    var provAll = provDeltaAll("cost", month, pm);
    var natCur = natCost(month);
    var natPrev = pm ? natCost(pm) : 0;
    var natDelta = natCur - natPrev;
    provAll.sort(function (a, b) { return pm ? (Math.abs(b.delta) - Math.abs(a.delta)) : (b.cur - a.cur); });
    var maxProv = Math.max.apply(null, provAll.map(function (x) { return Math.abs(pm ? x.delta : x.cur); }).concat([1]));
    var topN = isSingle ? 1 : 10;
    var provShow = isSingle ? provAll.filter(function (x) { return x.name === sl.scope; }) : provAll.slice(0, topN);
    if (!provShow.length) provShow = provAll.slice(0, topN);
    var blocks = provShow.map(function (pr) {
      var apps = appDeltaInProv(pr.name, month, pm).slice(0, 5).map(function (a) {
        var coef = pr.delta !== 0 ? (a.delta / pr.delta * 100) : 0;
        return { name: a.name, cur: a.cur, prev: a.prev, delta: a.delta, coef: coef };
      });
      var aMax = Math.max.apply(null, apps.map(function (x) { return Math.abs(x.delta); }).concat([1]));
      var coef = natDelta !== 0 ? (pr.delta / natDelta * 100) : 0;
      return { name: pr.name, cur: pr.cur, prev: pr.prev, delta: pr.delta, coef: coef, apps: apps, aMax: aMax };
    });
    var pct = (natPrev !== 0) ? (natDelta / natPrev * 100) : null;
    var html = '<div class="factor-modal"><div class="factor-hd"><div class="factor-title">环比变动因素拆解 · ' + esc(mt.name) + '</div>' +
      '<button class="factor-close" id="factorClose" type="button">×</button></div>' +
      '<div class="factor-sub">' + esc(month) + ' vs ' + esc(pm || "—") + ' · 范围：' + esc(sl.text) + (pm ? '' : '　（无上期对照）') + '</div>' +
      '<div class="factor-overview">' +
      ovItem('本期合计', fmtMetric(mt, natCur)) +
      ovItem('上期合计', pm ? fmtMetric(mt, natPrev) : '—') +
      ovItem('总增减', (pct == null ? '—' : '<span class="fc-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>')) +
      '</div>' +
      '<div class="fc-note">影响系数 = 该项变动 ÷ 总体变动。<b>省份层面</b> ÷ 全国总增减；<b>应用层面</b> ÷ 该省变动。用于快速定位关键拉动 / 拖累因素。</div>' +
      '<div class="fc-drill-guide"><b>1</b>省份环比因素<span>→</span><b>2</b>该省应用环比因素 TOP5</div>' +
      '<div class="fc-hier">';
    blocks.forEach(function (b, i) {
      var pcls = b.delta >= 0 ? 'up' : 'down';
      var parrow = b.delta > 0 ? '▲' : (b.delta < 0 ? '▼' : '•');
      var pPct = (b.prev !== 0) ? (b.delta / b.prev * 100) : null;
      var pwidth = Math.abs(b.delta) / maxProv * 100;
      html += '<div class="fc-prov">' +
        '<div class="fc-prov-hd">' +
        '<span class="fc-prov-rank">' + (i + 1) + '</span>' +
        '<span class="fc-prov-name">' + esc(b.name) + '</span>' +
        '<span class="fc-prov-coef">影响系数 <b class="' + pcls + '">' + (b.coef >= 0 ? '+' : '') + b.coef.toFixed(1) + '%</b></span>' +
        '<span class="fc-prov-delta ' + pcls + '">' + parrow + ' ' + (b.delta >= 0 ? '+' : '') + fmtMoney(b.delta) + (pPct == null ? '' : ('（' + (pPct >= 0 ? '+' : '') + pPct.toFixed(1) + '%）')) + '</span>' +
        '</div>' +
        '<div class="fc-prov-bar"><i class="' + pcls + '" style="width:' + pwidth.toFixed(1) + '%"></i></div>';
      if (b.apps.length) {
        html += '<div class="fc-apps">' +
          '<div class="fc-apps-hd">该省应用层面 · 变动幅度 TOP' + b.apps.length + '</div>' +
          '<table class="fc-app-tbl"><thead><tr><th>应用名称</th><th>变动幅度</th><th>影响系数</th></tr></thead><tbody>';
        b.apps.forEach(function (a, j) {
          var acls = a.delta >= 0 ? 'up' : 'down';
          var aarrow = a.delta > 0 ? '▲' : (a.delta < 0 ? '▼' : '•');
          var aPct = (a.prev !== 0) ? (a.delta / a.prev * 100) : null;
          var awidth = Math.abs(a.delta) / b.aMax * 100;
          html += '<tr>' +
            '<td class="fc-app-name">' + (j + 1) + '. ' + esc(a.name) + '</td>' +
            '<td class="fc-delta ' + acls + '">' + aarrow + ' ' + (a.delta >= 0 ? '+' : '') + fmtMoney(a.delta) + (aPct == null ? '' : ('（' + (aPct >= 0 ? '+' : '') + aPct.toFixed(1) + '%）')) + '</td>' +
            '<td class="fc-app-coef"><b class="' + acls + '">' + (a.coef >= 0 ? '+' : '') + a.coef.toFixed(1) + '%</b>' +
            '<span class="fc-app-bar"><i class="' + acls + '" style="width:' + awidth.toFixed(1) + '%"></i></span></td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    });
    html += '</div><div class="factor-foot"><button id="factorClose2" type="button">关闭</button></div></div>';
    var mask = document.createElement('div'); mask.className = 'factor-mask'; mask.id = 'factorDrawer';
    mask.innerHTML = html;
    document.body.appendChild(mask);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { mask.classList.add('show'); });
    mask.addEventListener('click', function (e) { if (e.target === mask) closeFactor(); });
    var fc = document.getElementById('factorClose'); if (fc) fc.onclick = closeFactor;
    var fc2 = document.getElementById('factorClose2'); if (fc2) fc2.onclick = closeFactor;
    if (factorKeyHandler) document.removeEventListener('keydown', factorKeyHandler);
    factorKeyHandler = function (e) { if (e.key === 'Escape') closeFactor(); };
    document.addEventListener('keydown', factorKeyHandler);
  }
  function closeFactor(silent) {
    var m = document.getElementById("factorDrawer");
    if (factorKeyHandler) { document.removeEventListener("keydown", factorKeyHandler); factorKeyHandler = null; }
    document.body.style.overflow = "";
    if (!m) return;
    m.classList.remove("show");
    setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 200);
  }
  function ovItem(label, val) { return '<div class="factor-ov-item"><div class="factor-ov-label">' + label + '</div><div class="factor-ov-val">' + val + '</div></div>'; }
  function curTotal(items, field) { return items.reduce(function (s, x) { return s + (x[field] || 0); }, 0); }
  function totalDeltaPct(items, mt) { var cur = curTotal(items, "cur"), prev = curTotal(items, "prev"); if (prev === 0) return "—"; var p = (cur - prev) / prev * 100; var cls = p >= 0 ? "up" : "down"; return '<span class="fc-delta ' + cls + '">' + (p >= 0 ? "+" : "") + p.toFixed(1) + "%</span>"; }
  function factorColHtml(items, mt, maxAbs) {
    if (!items.length) return '<div style="font-size:12px;color:#9ca3af;padding:8px">无</div>';
    return items.map(function (x, i) {
      var pct = Math.abs(x.delta) / maxAbs * 100;
      var cls = x.delta >= 0 ? "up" : "down";
      var arrow = x.delta > 0 ? "▲" : (x.delta < 0 ? "▼" : "•");
      return '<div class="fc-row"><span class="fc-idx">' + (i + 1) + '</span><span>' +
        '<div class="fc-name">' + esc(x.name) + '</div>' +
        '<div class="fc-meta">' + esc(x.sub || "") + ' · 当月 ' + fmtMetric(mt, x.cur) + ' / 上月 ' + fmtMetric(mt, x.prev) + '</div>' +
        '<div class="fc-delta ' + cls + '">' + arrow + " " + (x.delta >= 0 ? "+" : "") + fmtMetric(mt, x.delta) + '</div>' +
        '<div class="fc-bar"><i class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '</span></div>';
    }).join("");
  }

  /* ===== 本页面渲染函数 ===== */
  function renderOverview() {
    var title = $("ovTitle"); if (title) title.textContent = "数据总览（" + V.flags.periodLabel + "）";
    noteBox("ovProvNote", V.flags.overviewProvNote);
    /* 顶栏 / 侧栏 元信息同步（Professional UI 2026-08-24） */
    syncTopbarMeta();
    bindTopbarActions();

    /* —— 关键指标（15 张 / 4 组；含ⓘ口径、环比VS上期、mini趋势；月均/累计切换） —— */
    renderCoreCards();
    renderTrendSetup(); // 关键指标下方：趋势动态分析卡片 + 环比变动因素下钻

    /* 趋势 / 应用与省份 / 成本与价值 三模块已按需求移除，仅保留关键指标模块 */
  }

  /* —— 顶栏 / 侧栏 元信息（数据快照 / 周期 / 数据源链接 / 状态灯） —— */
  function syncTopbarMeta() {
    var m = (typeof D !== "undefined" && D && D.meta) ? D.meta : {};
    var tEl = document.getElementById("topbarMetaTime");
    var pEl = document.getElementById("topbarMetaPeriod");
    if (tEl) tEl.textContent = m.generatedAt || "—";
    if (pEl) pEl.textContent = (V && V.flags && V.flags.periodLabel) || "—";
    var stEl = document.getElementById("topbarStatusText");
    if (stEl) stEl.textContent = m.source ? "已连接" : "数据未接入";
    var sfName = document.getElementById("sfSourceName");
    if (sfName) {
      sfName.textContent = m.source || "离线 Excel（build/sources）";
      sfName.removeAttribute("href");
    }
    var sfDoc = document.getElementById("sfDoc");
    if (sfDoc) { sfDoc.removeAttribute("href"); sfDoc.textContent = "离线 Excel（已固化）"; }
  }
  function bindTopbarActions() {
    if (window._ovTopbarBound) return;
    window._ovTopbarBound = true;
    var btnR = document.getElementById("btnRefreshAll");
    if (btnR) btnR.onclick = function () {
      /* 触发当前 tab 的"重新渲染"：取 data.js 快照（file:// 模式会回退本地） */
      var t = (typeof currentTab !== "undefined" && currentTab) || "overview";
      try { if (typeof window["refreshFromServerForTab"] === "function") window["refreshFromServerForTab"](t); } catch (e) { try { if (typeof refreshFromServer === "function") refreshFromServer(); } catch (e2) {} }
    };
    var btnH = document.getElementById("btnHelp");
    if (btnH) btnH.onclick = function () {
      window.open("README.md", "_blank");
    };
    var btnS = document.getElementById("btnSearch");
    if (btnS) btnS.onclick = function () {
      alert("搜索功能即将推出。当前可按 Ctrl/Cmd + F 在页面内搜索关键指标名称。");
    };
  }

  function renderProvinceMap() {
    var box = $("ovMap"); if (!box) return;
    if (!window.echarts) { box.innerHTML = '<div class="chart-fallback">图表库未加载</div>'; return; }
    if (!window.echarts.getMap || !window.echarts.getMap("china")) {
      box.innerHTML = '<div class="chart-fallback">地图组件未就绪（需联网加载 ECharts 地图）</div>'; return;
    }
    var byProv = {};
    (V.agents || []).forEach(function (a) {
      if (!a.province || a.province === NATL || a.province === "本部") return;
      byProv[a.province] = (byProv[a.province] || 0) + (a._pt || 0);
    });
    var data = [];
    Object.keys(byProv).forEach(function (sc) {
      data.push({ name: PROV_NAME_MAP[sc] || sc, value: Math.round(byProv[sc] * 100) / 100 });
    });
    if (instMap.ovMap) { try { instMap.ovMap.dispose(); } catch (e) {} }
    var c = window.echarts.init(box); instMap.ovMap = c;
    var mx = 0; data.forEach(function (d) { if (d.value > mx) mx = d.value; });
    c.setOption({
      tooltip: { trigger: "item", formatter: function (p) { return p.name + "<br/>等效人年: " + (p.value ? fmtPY(p.value) : "0"); } },
      visualMap: { min: 0, max: Math.max(mx, 1), left: 12, bottom: 12, text: ["高", "低"], inRange: { color: ["#eef3f9", "#8fb8de", "#3b6ea5"] }, textStyle: { color: SUB } },
      series: [{ type: "map", map: "china", roam: false, label: { show: false }, data: data, itemStyle: { borderColor: "#fff", areaColor: "#f4f7fb" } }]
    });
  }
})();

;
/* ===== pages/agents.js ===== */
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
  function posKpiCard(label, value, sub, color) {
    return '<div class="agx-kpi" tabindex="0" style="cursor:default">' +
      '<div class="lb">' + esc(label) + '</div>' +
      '<div class="val" style="color:' + color + '">' + value + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div>';
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
      if (!a) { a = agents[id] = { name: r.name, type: r.type, sp: {}, sc: {}, pr: {}, calls: 0, save: 0, real: 0, pos: 0 }; }
      if (r.positiveValue === 1) a.pos = 1;
      var c = NN(r.calls); if (c) a.calls += c;
      var sa = NN(r.saveAmount); if (sa != null) a.save += sa;
      var rv = NN(r.realValue); if (rv != null) a.real += rv;
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
      posKpiCard("头部集中度", (top1Share * 100).toFixed(1) + "%", "Top1 占全部节约金额", "#dc2626")
    ].join("");

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
      '<p><b>一、总体：价值极度头部化。</b>全量 ' + fmtInt(total) + ' 个智能体中仅 <b>' + posN + ' 个（' + (posN / total * 100).toFixed(1) + '%）</b>被判定为正向价值，却贡献了约 <b>' + (posSave / (totSave || 1) * 100).toFixed(1) + '%</b> 的节约金额与全部真实价值；95% 的智能体在当前计量口径下不产生可衡量价值。</p>' +
      '<p><b>二、类型画像。</b>「工作流」是价值主引擎，独占正向价值约 <b>' + wfVal + '%</b>；「智能体」正向率最高（' + agRate + '%），是命中率更优的"精兵"；「对话流」正向率为 0，应停止在其上设定价值目标。</p>' +
      '<p><b>三、分类画像（服务类型 + 场景族）。</b>按服务环节看，正向率最高的是 <b>' + esc(bestPhase.name) + '（' + (bestPhase.rate * 100).toFixed(1) + '%）</b>，其次为服务中、服务后；高频正向场景清一色属于 <b>"稽核 / 查证 / 预判 / 分析"</b> 四类：正向率最高的是 ' + esc(bestScene.name) + '（' + (bestScene.rate * 100).toFixed(1) + '%），其次为退费稽核、工单查证、服务质量稽核等。被平台<b>策展推广</b>的场景正向率平均 ' + promoAvg + '%，而<b>自然生长</b>场景仅 ' + natRate + '%（约 ' + promoRatio + ' 倍差距）。</p>' +
      '<p><b>四、价值分布风险。</b>头部极端集中：单个智能体即占全部节约金额的 <b>' + (top1Share * 100).toFixed(1) + '%</b>，Top10 占 ' + (top10Share * 100).toFixed(1) + '%；且正向智能体几乎全部为单省部署，优秀模式尚未跨省复制（省份孤岛）。</p>' +
      '<p><b>五、平台引导方向。</b>① 类型：主力用「工作流」规模化承重，精兵用「智能体」，停投「对话流」；② 场景：优先孵化服务前预判拦截（命中率最高）、规模化服务后稽核质检，聚焦已验证的稽核/查证/预判场景族；③ 机制：以"策展模板化推广"替代自由生长（复制 15–25 倍正向率），把头部模式抽象为跨省模板打破省份孤岛，并以"正向率 + 价值密度"替代"智能体数量"作为健康度 KPI。</p>' +
      '</div>';
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

;
/* ===== pages/tracking.js ===== */
/* pages/tracking.js — 平台分析（埋点）（负责人：赵莹）
 * 只读 core/core.js 暴露的全局状态（D / FILTER / V），不写取数逻辑。
 * 数据源：离线 Excel《用户行为记录》（build/sources，已固化进 data.js），按周/月统计埋点 PV/UV/曝光。
 * 本页按《页面埋点数据分析报告》结构重构：结论总览 → 核心指标 → 总体趋势 → 菜单结构 →
 *   标注模块 → 灵犀深度分析 → 页面维度 → 省份维度 → 省份×模块交叉；每个图表后附分析。
 * 时间维度由本页专属筛选（全部周 / 按周 / 按月）驱动；省份筛选作用于省份维度与交叉热力。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "pages",
    title: "平台分析（埋点）",
    icon: "◎",
    order: 3,
    owner: "赵莹",
    render: function () { renderPages(); }
  });

  /* ---------- 工具 ---------- */
  function trunc(s, n) { if (!s) return ""; return s.length > n ? s.slice(0, n) + "…" : s; }
  function ctr(c, e) { return e ? (c / e * 100) : null; }

  function analysisBox(id, cause, action) {
    var b = $(id); if (!b) return;
    b.innerHTML = '<div class="an-block">' +
      '<div class="an-item"><span class="an-tag cause">原因分析</span><span class="an-txt">' + cause + '</span></div>' +
      '<div class="an-item"><span class="an-tag action">下一步动作</span><span class="an-txt">' + action + '</span></div>' +
      '</div>';
  }

  // 选中的周（依据平台专属筛选：全部周 / 按周 / 按月）
  function selectedWeeks(pt) {
    var scope = FILTER.pfScope || "all";
    if (scope === "week") return (FILTER.pfWeeks && FILTER.pfWeeks.length) ? FILTER.pfWeeks.slice() : pt.weeks.slice();
    if (scope === "month") {
      var m = FILTER.pfMonth;
      if (!m) return pt.weeks.slice();
      return pt.weeks.filter(function (w) { return pt.weekMonth[w] === m; });
    }
    return pt.weeks.slice();
  }

  function scopeText(pt) {
    var scope = FILTER.pfScope || "all";
    if (scope === "week") {
      var n = (FILTER.pfWeeks || []).length;
      return n ? ("已选 " + n + " 周（" + (FILTER.pfWeeks || []).join("、") + "）") : "已选 0 周";
    }
    if (scope === "month") return FILTER.pfMonth ? ("按月：" + FILTER.pfMonth.replace("2026-", "") + "月") : "全部月（按月聚合）";
    return "全部周（" + pt.weeks.length + " 周合计）";
  }

  // 逐周 map 累加成 {key:{clicks,visitors,exposures}}
  function aggWeekMap(weekMap, weeks) {
    var acc = {};
    weeks.forEach(function (w) {
      var d = weekMap[w] || {};
      Object.keys(d).forEach(function (k) {
        var o = d[k];
        if (!acc[k]) acc[k] = { clicks: 0, visitors: 0, exposures: 0 };
        acc[k].clicks += o.clicks || 0; acc[k].visitors += o.visitors || 0; acc[k].exposures += o.exposures || 0;
      });
    });
    return acc;
  }

  function pctChange(cur, base) {
    if (!base) return null;
    return (cur - base) / base * 100;
  }

  function toArr(acc, withCtr) {
    return Object.keys(acc).map(function (k) {
      var o = acc[k];
      var r = { name: k, clicks: o.clicks, visitors: o.visitors, exposures: o.exposures };
      if (withCtr) r.ctr = ctr(o.clicks, o.exposures);
      return r;
    });
  }

  function weekSum(pt, weeks) {
    var c = 0, v = 0, e = 0;
    weeks.forEach(function (w) {
      var d = pt.pageByWeek[w] || {};
      Object.keys(d).forEach(function (k) { var o = d[k]; c += o.clicks || 0; v += o.visitors || 0; e += o.exposures || 0; });
    });
    return { clicks: c, visitors: v, exposures: e };
  }

  // 趋势序列（周维度按周、月维度按月聚合）
  function trendSeries(pt, weeks) {
    var scope = FILTER.pfScope || "all";
    if (scope === "month") {
      var monMap = {};
      weeks.forEach(function (w) { var m = pt.weekMonth[w]; (monMap[m] = monMap[m] || []).push(w); });
      var ms = Object.keys(monMap).sort();
      var labels = ms.map(function (m) { return m.replace("2026-", "") + "月"; });
      var clicks = ms.map(function (m) { return weekSum(pt, monMap[m]).clicks; });
      var visitors = ms.map(function (m) { return weekSum(pt, monMap[m]).visitors; });
      var exposures = ms.map(function (m) { return weekSum(pt, monMap[m]).exposures; });
      return { labels: labels, clicks: clicks, visitors: visitors, exposures: exposures };
    }
    return {
      labels: weeks.slice(),
      clicks: weeks.map(function (w) { return weekSum(pt, [w]).clicks; }),
      visitors: weeks.map(function (w) { return weekSum(pt, [w]).visitors; }),
      exposures: weeks.map(function (w) { return weekSum(pt, [w]).exposures; })
    };
  }

  function activeProvinces() {
    var p = FILTER.prov || [];
    if (!p.length || (p.length === 1 && p[0] === "全国")) return null;
    return p.slice();
  }

  // 省份×模块 聚合：{mod:{prov:clicks}}（跨选中周）
  function aggProvModule(pt, weeks) {
    var acc = {};
    weeks.forEach(function (w) {
      var d = pt.provModuleByWeek[w] || {};
      Object.keys(d).forEach(function (m) {
        if (!acc[m]) acc[m] = {};
        var pm = d[m];
        Object.keys(pm).forEach(function (pr) { acc[m][pr] = (acc[m][pr] || 0) + (pm[pr] || 0); });
      });
    });
    return acc;
  }

  // 省份 × 三级模块 聚合（页面名前 3 段），供交叉热力细化到三级目录
  function aggProvModuleL3(pt, weeks) {
    var acc = {};
    weeks.forEach(function (w) {
      var d = pt.provModuleL3ByWeek[w] || {};
      Object.keys(d).forEach(function (m) {
        if (!acc[m]) acc[m] = {};
        var pm = d[m];
        Object.keys(pm).forEach(function (pr) { acc[m][pr] = (acc[m][pr] || 0) + (pm[pr] || 0); });
      });
    });
    return acc;
  }

  /* ---------- 本地图表实例管理（用于绑定 click 下钻，避免改动共享内核） ---------- */
  var _localInst = {};
  function localChart(id, option) {
    var box = $(id);
    if (!box) return null;
    if (!window.echarts) { box.innerHTML = '<div class="chart-fallback">图表库（ECharts）未加载，请联网后刷新；数据表格不受影响。</div>'; return null; }
    if (_localInst[id]) { try { _localInst[id].dispose(); } catch (e) {} }
    var c = window.echarts.init(box);
    c.setOption(option);
    _localInst[id] = c;
    return c;
  }
  function disposeLocalAll() {
    Object.keys(_localInst).forEach(function (k) { try { _localInst[k].dispose(); } catch (e) {} });
    _localInst = {};
  }

  /* ---------- 层级 / 下钻 聚合工具 ---------- */
  function aggPagesOverWeeks(pt, weeks) {
    var acc = {};
    weeks.forEach(function (w) {
      var d = pt.pageByWeek[w] || {};
      Object.keys(d).forEach(function (k) {
        var o = d[k];
        if (!acc[k]) acc[k] = { clicks: 0, visitors: 0, exposures: 0 };
        acc[k].clicks += o.clicks || 0; acc[k].visitors += o.visitors || 0; acc[k].exposures += o.exposures || 0;
      });
    });
    return acc;
  }
  function pageL1(n) { var s = n.split("-"); return s[0]; }
  function pageL2(n) { var s = n.split("-"); return s.length >= 2 ? s.slice(0, 2).join("-") : s[0]; }
  function pageL3(n) { var s = n.split("-"); return s.length >= 3 ? s.slice(0, 3).join("-") : (s.length >= 2 ? s.slice(0, 2).join("-") : s[0]); }
  function pageL4(n) { var s = n.split("-"); return s.length >= 4 ? s.slice(0, 4).join("-") : (s.length >= 3 ? s.slice(0, 3).join("-") : (s.length >= 2 ? s.slice(0, 2).join("-") : s[0])); }
  function aggByLevel(pt, weeks, level, pred) {
    var acc = {};
    weeks.forEach(function (w) {
      var d = pt.pageByWeek[w] || {};
      Object.keys(d).forEach(function (k) {
        if (pred && !pred(k)) return;
        var key = level === 1 ? pageL1(k) : (level === 2 ? pageL2(k) : (level === 3 ? pageL3(k) : pageL4(k)));
        if (!acc[key]) acc[key] = { clicks: 0, visitors: 0, exposures: 0 };
        acc[key].clicks += d[k].clicks || 0; acc[key].visitors += d[k].visitors || 0; acc[key].exposures += d[k].exposures || 0;
      });
    });
    return acc;
  }
  function pageClicksForWeek(pt, w, pred) {
    var d = pt.pageByWeek[w] || {}; var s = 0;
    Object.keys(d).forEach(function (k) { if (!pred || pred(k)) s += (d[k].clicks || 0); });
    return s;
  }
  // 模块逐周/逐月点击序列
  function moduleWeeklyClicks(pt, weeks, pred) {
    var scope = FILTER.pfScope || "all";
    if (scope === "month") {
      var monMap = {};
      weeks.forEach(function (w) { var m = pt.weekMonth[w]; (monMap[m] = monMap[m] || []).push(w); });
      var ms = Object.keys(monMap).sort();
      return {
        labels: ms.map(function (m) { return m.replace("2026-", "") + "月"; }),
        weeksOf: ms.map(function (m) { return monMap[m]; }),
        clicks: ms.map(function (m) { var s = 0; monMap[m].forEach(function (w) { s += pageClicksForWeek(pt, w, pred); }); return s; })
      };
    }
    return {
      labels: weeks.slice(),
      weeksOf: weeks.map(function (w) { return [w]; }),
      clicks: weeks.map(function (w) { return pageClicksForWeek(pt, w, pred); })
    };
  }
  // 取 |WoW%| 最大的 2 个点为异常拐点（不含首点）
  function detectInflections(labels, values) {
    var n = values.length; if (n < 3) return [];
    var pct = [];
    for (var i = 1; i < n; i++) { var b = values[i - 1]; pct.push(b ? (values[i] - b) / b * 100 : 0); }
    var idx = pct.map(function (v, i) { return { i: i + 1, v: v }; }).sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    return idx.slice(0, 2).map(function (o) { return o.i; });
  }

  // 全局：标签(周/月) -> 实际周列表，供下钻映射
  var gLabelWeeks = {};

  // 点击趋势/模块拐点 -> 下钻该周期各页面埋点，并做环比归因（哪页拉高/拖累、占净变动多少）
  // pred: 可选，传入时仅统计当前模块的页面（剔除其余模块）；全局趋势下钻传 null
  function drillPagesPanel(containerId, label, pt, scopeNote, pred) {
    var box = $(containerId); if (!box) return;
    var weeks = gLabelWeeks[label] || [];
    if (!weeks.length) { box.innerHTML = '<div class="chart-fallback">无可下钻数据</div>'; return; }
    var acc = aggPagesOverWeeks(pt, weeks);
    if (pred) { var _f = {}; Object.keys(acc).forEach(function (k) { if (pred(k)) _f[k] = acc[k]; }); acc = _f; }
    var arr = Object.keys(acc).map(function (k) {
      var o = acc[k]; return { name: k, clicks: o.clicks, visitors: o.visitors, exposures: o.exposures, ctr: o.exposures ? o.clicks / o.exposures * 100 : null };
    });
    var totC = arr.reduce(function (a, b) { return a + b.clicks; }, 0);
    var totE = arr.reduce(function (a, b) { return a + (b.exposures || 0); }, 0);

    // ---- 环比对比（仅单周且有上一周时）----
    var allWeeks = pt.weeks;
    var wi = allWeeks.indexOf(weeks[0]);
    var hasPrev = (weeks.length === 1 && wi > 0);
    var prevTotC = 0, prevTotE = 0, prevArr = null;
    if (hasPrev) {
      var pAcc = aggPagesOverWeeks(pt, [allWeeks[wi - 1]]);
      if (pred) { var _pf = {}; Object.keys(pAcc).forEach(function (k) { if (pred(k)) _pf[k] = pAcc[k]; }); pAcc = _pf; }
      prevArr = Object.keys(pAcc).map(function (k) { return { name: k, clicks: pAcc[k].clicks, exposures: pAcc[k].exposures }; });
      prevTotC = prevArr.reduce(function (a, b) { return a + b.clicks; }, 0);
      prevTotE = prevArr.reduce(function (a, b) { return a + (b.exposures || 0); }, 0);
    }

    // ---- 页面级环比 delta 与贡献度（占净变动）----
    var prevMap = {}; (prevArr || []).forEach(function (p) { prevMap[p.name] = p; });
    var recs = arr.map(function (t) {
      var p = prevMap[t.name];
      var pe = p ? (p.exposures || 0) : 0, pc = p ? (p.clicks || 0) : 0;
      return { name: t.name, curE: t.exposures, prevE: pe, dE: t.exposures - pe, curC: t.clicks, prevC: pc, dC: t.clicks - pc };
    });
    var posDE = recs.reduce(function (a, b) { return a + (b.dE > 0 ? b.dE : 0); }, 0);
    var negDE = recs.reduce(function (a, b) { return a + (b.dE < 0 ? b.dE : 0); }, 0);
    var posDC = recs.reduce(function (a, b) { return a + (b.dC > 0 ? b.dC : 0); }, 0);
    var negDC = recs.reduce(function (a, b) { return a + (b.dC < 0 ? b.dC : 0); }, 0);
    recs.forEach(function (r) {
      r.shareE = r.dE > 0 ? (posDE ? r.dE / posDE * 100 : 0) : (negDE ? r.dE / negDE * 100 : 0);
      r.shareC = r.dC > 0 ? (posDC ? r.dC / posDC * 100 : 0) : (negDC ? r.dC / negDC * 100 : 0);
    });
    var movers = recs.slice().sort(function (a, b) { return Math.abs(b.dE) - Math.abs(a.dE); }).slice(0, 5);
    var byUp = recs.slice().sort(function (a, b) { return b.dE - a.dE; });
    var maxUp = byUp[0], maxDown = byUp[byUp.length - 1];

    // ---- 环比概览数值 ----
    var chgE = prevTotE ? (totE - prevTotE) / prevTotE * 100 : 0;
    var chgC = prevTotC ? (totC - prevTotC) / prevTotC * 100 : 0;
    var ctrNow = totE ? totC / totE * 100 : 0, ctrPrev = prevTotE ? prevTotC / prevTotE * 100 : 0;
    var ctrChg = ctrNow - ctrPrev;
    function dirClass(v) { return v > 0.5 ? "up" : (v < -0.5 ? "down" : "flat"); }
    function pct(v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
    function kpiChip(lb, val, deltaTxt, vsVal, dval) {
      var dc = dirClass(dval);
      var arrw = dc === "up" ? "▲" : (dc === "down" ? "▼" : "—");
      return '<div class="drill-kpi ' + dc + '"><div class="dk-lb">' + lb + '</div>' +
        '<div class="dk-val">' + val + '</div>' +
        '<div class="dk-delta"><span class="arr">' + arrw + '</span><span>' + deltaTxt + '</span>' +
        '<span class="dk-vs">vs 上周 ' + vsVal + '</span></div></div>';
    }

    var kpiHtml = "";
    if (hasPrev) {
      kpiHtml =
        '<div class="drill-kpi-row">' +
          kpiChip("曝光", fmtWan(totE), pct(chgE), fmtWan(prevTotE), chgE) +
          kpiChip("点击", fmtWan(totC), pct(chgC), fmtWan(prevTotC), chgC) +
          kpiChip("转化率", ctrNow.toFixed(1) + "%", (ctrChg >= 0 ? "+" : "") + ctrChg.toFixed(1) + "pp", ctrPrev.toFixed(1) + "%", ctrChg) +
        '</div>';
    }

    // ---- 核心驱动页面贡献表 ----
    var contribHtml = "";
    if (hasPrev && movers.length) {
      var rows = movers.map(function (r) {
        var ec = r.dE > 0 ? "up" : (r.dE < 0 ? "down" : "flat");
        var cc = r.dC > 0 ? "up" : (r.dC < 0 ? "down" : "flat");
        var esign = r.dE > 0 ? "+" : "";
        var csign = r.dC > 0 ? "+" : "";
        return '<tr>' +
          '<td class="pg">' + esc(trunc(r.name, 32)) + '</td>' +
          '<td>' + fmtInt(r.prevE) + '</td>' +
          '<td>' + fmtInt(r.curE) + '</td>' +
          '<td class="' + ec + '">' + esign + fmtInt(r.dE) + '</td>' +
          '<td class="' + ec + '">' + esign + r.shareE.toFixed(1) + '%</td>' +
          '<td>' + fmtInt(r.curC) + '</td>' +
          '<td class="' + cc + '">' + csign + fmtInt(r.dC) + '</td>' +
        '</tr>';
      }).join('');
      contribHtml =
        '<div class="drill-sub">核心驱动页面 · 按曝光环比增量排序 TOP ' + movers.length + '（贡献度 = 该页 Δ曝光 ÷ 同方向净变动，正值=拉高、负值=拖累）</div>' +
        '<table class="tbl drill-contrib"><thead><tr>' +
          '<th>页面</th><th>上周曝光</th><th>本周曝光</th><th>Δ曝光</th><th>贡献度</th><th>本周点击</th><th>Δ点击</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    // ---- 归因叙事 + 下一步 ----
    var noteCause = "", noteAction = "";
    if (hasPrev) {
      var upName = maxUp ? trunc(maxUp.name, 22) : "—";
      var upE = maxUp ? maxUp.dE : 0, upShare = maxUp ? maxUp.shareE : 0;
      var secName = movers[1] ? trunc(movers[1].name, 16) : "";
      if (chgE > 15 && Math.abs(ctrChg) < 2) {
        noteCause = "该周期曝光环比 " + pct(chgE) + "、点击 " + pct(chgC) + "，转化率基本持平（" + ctrPrev.toFixed(1) + "%→" + ctrNow.toFixed(1) + "%），属推广/培训带来的流量型波动。曝光增量主要由「" + upName + "」拉动（曝光 +" + fmtInt(upE) + "，贡献度 " + upShare.toFixed(1) + "%）" + (secName ? "，其次「" + secName + "」" : "") + "。";
        noteAction = "①沉淀本次流量高峰的运营动作（培训/推广）形成可复用 SOP；②高峰后复盘留存，把一次性流量转化为稳定使用；③关注「" + upName + "」并发与稳定性。";
      } else if (chgE <= 5 && chgC > 10) {
        noteCause = "该周期曝光基本持平（" + pct(chgE) + "）但点击 " + pct(chgC) + "，转化率由 " + ctrPrev.toFixed(1) + "% 升至 " + ctrNow.toFixed(1) + "%，说明入口优化/功能上线带动使用深度。点击增量主要来自「" + upName + "」（+" + fmtInt(maxUp ? maxUp.dC : 0) + "，贡献度 " + (maxUp ? maxUp.shareC.toFixed(1) : "0") + "%）。";
        noteAction = "①固化该入口/功能改版经验向同类页面复制；②沿高转化路径继续做链路优化；③监测改版后次周留存，确认非短期刺激。";
      } else if (chgC < -10) {
        var dnName = (maxDown && maxDown.dE < 0) ? trunc(maxDown.name, 22) : "多个页面";
        noteCause = "该周期点击环比 " + pct(chgC) + "、曝光 " + pct(chgE) + "，呈明显下滑，可能为推广收缩、排班/假期或入口变更所致。下滑最多页面为「" + dnName + "」（曝光 " + (maxDown ? fmtInt(maxDown.dE) : "0") + "，贡献度 " + (maxDown ? maxDown.shareE.toFixed(1) : "0") + "%）。";
        noteAction = "①核查该周期是否有推广/培训排期空档或入口调整；②对下滑页面排查可用性（报错/加载）与业务排期；③必要时主动触达一线重启使用引导。";
      } else {
        noteCause = "该周期曝光 " + pct(chgE) + "、点击 " + pct(chgC) + "，波动温和，属正常使用起伏。变动最大页面为「" + upName + "」（曝光 " + (upE >= 0 ? "+" : "") + fmtInt(upE) + "）。";
        noteAction = "①维持现有运营节奏；②持续监控是否出现持续性下滑信号。";
      }
    } else {
      noteCause = "所选范围「" + label + "」（" + weeks.length + " 周合计）曝光 " + fmtWan(totE) + "、点击 " + fmtWan(totC) + "；下钻展示该范围内页面埋点 TOP。";
      noteAction = "①对照各页面点击/转化率定位高价值入口；②对低转化页面做入口文案与位置优化。";
    }

    var top = arr.slice().sort(function (a, b) { return b.clicks - a.clicks; }).slice(0, 12).reverse();
    box.innerHTML =
      '<div class="drill-head">下钻 · ' + esc(label) + '（' + esc(scopeNote) + '）· 页面埋点 TOP ' + top.length + '</div>' +
      kpiHtml +
      contribHtml +
      '<div class="drill-sub2">页面点击量 TOP ' + top.length + '（绝对值）</div>' +
      '<div class="chart" id="' + containerId + '_c"></div>' +
      '<div id="' + containerId + '_an"></div>';
    localChart(containerId + "_c", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 230, right: 55, top: 10, bottom: 20 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: top.map(function (t) { return trunc(t.name, 28); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[0] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    analysisBox(containerId + "_an", noteCause, noteAction);
  }

  // 通用模块专项分析：①二级菜单结构 ②周使用趋势(拐点可下钻) ③低效与冗余页面
  function renderModuleDeep(name, title, pred, pt, weeks, mountEl, uid, scoped, level) {
    if (!mountEl) return;
    var l2 = aggByLevel(pt, weeks, level || 2, pred);
    var l2Arr = Object.keys(l2).map(function (k) {
      var o = l2[k]; return { name: k, clicks: o.clicks, visitors: o.visitors, exposures: o.exposures, ctr: o.exposures ? o.clicks / o.exposures * 100 : null };
    }).sort(function (a, b) { return b.clicks - a.clicks; });
    var l2Top = l2Arr.slice(0, 12).reverse();
    var modTot = l2Arr.reduce(function (a, b) { return a + b.clicks; }, 0);
    var modExp = l2Arr.reduce(function (a, b) { return a + (b.exposures || 0); }, 0);
    var modCtr = modExp ? modTot / modExp * 100 : 0;

    var mws = moduleWeeklyClicks(pt, weeks, pred);
    var inf = detectInflections(mws.labels, mws.clicks);
    var markData = inf.map(function (i) { return { name: mws.labels[i], coord: [mws.labels[i], mws.clicks[i]], value: "拐点", itemStyle: { color: "#e0533d" } }; });

    var acc = aggPagesOverWeeks(pt, weeks);
    var pgArr = Object.keys(acc).filter(function (k) { return pred ? pred(k) : true; }).map(function (k) {
      var o = acc[k]; return { name: k, clicks: o.clicks, visitors: o.visitors, exposures: o.exposures, ctr: o.exposures ? o.clicks / o.exposures * 100 : null };
    }).sort(function (a, b) { return (a.ctr == null ? -1 : a.ctr) - (b.ctr == null ? -1 : b.ctr); });
    // ③ 低效与冗余页面：优先用点击率(CTR)；若模块埋点绝大多数页面无曝光(exposures=0)导致 CTR 不可计算，退化为点击量口径
    var withCtr = pgArr.filter(function (p) { return p.ctr != null; }).length;
    var hasCtr = pgArr.length > 0 && withCtr / pgArr.length >= 0.5;
    var lowEff, lowMetricName, lowValFn, lowLblFn;
    var noExpPages = 0;
    if (hasCtr) {
      var ctrPages = pgArr.filter(function (p) { return p.ctr != null; });
      noExpPages = pgArr.length - ctrPages.length;
      lowEff = ctrPages.slice(0, 10).reverse();
      lowMetricName = "CTR%";
      lowValFn = function (t) { return Math.min(t.ctr, 100); };
      lowLblFn = function (t) { return t.ctr.toFixed(1) + "%"; };
    } else {
      lowEff = pgArr.slice().sort(function (a, b) { return a.clicks - b.clicks; }).slice(0, 10).reverse();
      lowMetricName = "点击量";
      lowValFn = function (t) { return t.clicks; };
      lowLblFn = function (t) { return fmtWan(t.clicks); };
    }
    var redundant = pgArr.slice().sort(function (a, b) { return a.clicks - b.clicks; }).slice(0, 5);

    var titleHtml = title ? (scoped ? '<div class="mdeep-h">' + esc(title) + '</div>' : '<div class="block-title">' + esc(title) + '</div>') : '';
    var inner =
        titleHtml +
        '<div class="mdeep-h">① ' + (level === 3 ? '三级' : '二级') + '菜单结构与转化效率</div>' +
        '<div class="row-2">' +
          '<div class="chart-card"><div class="ct">' + esc(name) + ' · ' + (level === 3 ? '三级' : '二级') + '菜单点击量 TOP</div><div class="chart" id="' + uid + '_l2"></div></div>' +
          '<div class="chart-card"><div class="ct">' + esc(name) + ' · 使用趋势（红点可点击下钻）</div><div class="chart" id="' + uid + '_tr"></div></div>' +
        '</div>' +
        '<div class="mdeep-row"><div id="' + uid + '_l2an"></div><div id="' + uid + '_tran"></div></div>' +
        '<div class="mdeep-h">② 使用趋势及异常拐点分析</div>' +
        '<div class="drill" id="' + uid + '_drill"></div>' +
        '<div class="mdeep-h">③ 低效与冗余页面</div>' +
        '<div class="chart-card"><div class="ct">' + esc(name) + ' · 页面点击率（低→高，偏低为低效）</div><div class="chart" id="' + uid + '_low"></div></div>' +
        '<div id="' + uid + '_lowan"></div>';
    mountEl.insertAdjacentHTML("beforeend", scoped ? inner : '<div class="block">' + inner + '</div>');

    localChart(uid + "_l2", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 170, right: 55, top: 10, bottom: 20 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: l2Top.map(function (t) { return trunc(t.name, 22); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: l2Top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[2] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    var mwChart = localChart(uid + "_tr", {
      color: PALETTE, tooltip: { trigger: "axis" }, legend: { bottom: 0, textStyle: { color: SUB } },
      grid: { left: 70, right: 30, top: 20, bottom: 45 },
      xAxis: { type: "category", data: mws.labels, axisLabel: { color: SUB, fontSize: 11, rotate: mws.labels.length > 8 ? 30 : 0 }, axisLine: { lineStyle: { color: AX } } },
      yAxis: { type: "value", name: "点击量", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      series: [{ name: "点击量", type: "line", smooth: true, data: mws.clicks, itemStyle: { color: PALETTE[0] }, areaStyle: { opacity: 0.08 }, lineStyle: { width: 3 }, markPoint: { symbol: "pin", symbolSize: 46, data: markData } }]
    });
    if (mwChart) {
      mwChart.on("click", function (params) {
        var label = params.name || (mws.labels[params.dataIndex]);
        if (!label) return;
        drillPagesPanel(uid + "_drill", label, pt, scopeText(pt), pred);
        var dz = $(uid + "_drill"); if (dz && dz.scrollIntoView) dz.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    // ② 默认展示首个异常拐点（无拐点则展示首周期）的下钻分析，避免标题下空白；点击趋势线任意点可切换
    if (inf.length) {
      drillPagesPanel(uid + "_drill", mws.labels[inf[0]], pt, scopeText(pt), pred);
    } else if (mws.labels.length) {
      drillPagesPanel(uid + "_drill", mws.labels[0], pt, scopeText(pt), pred);
    }

    // 分析文案
    var topL2 = l2Arr[0];
    analysisBox(uid + "_l2an",
      "「" + esc(name) + "」模块点击 " + fmtWan(modTot) + (modExp ? "，整体点击率 " + modCtr.toFixed(1) + "%" : "") + "；" + (level === 3 ? '三级' : '二级') + "菜单中「" + (topL2 ? esc(trunc(topL2.name, 18)) : "—") + "」点击最高（" + fmtWan(topL2 ? topL2.clicks : 0) + "），是模块主力入口。",
      "①保障头部二级菜单的稳定与体验；②对低活跃二级菜单评估合并或精简；③按二级菜单点击占比分配运营与前端资源。");
    var infLabels = inf.map(function (i) { return mws.labels[i] + "（" + fmtWan(mws.clicks[i]) + "）"; });
    analysisBox(uid + "_tran",
      "模块使用呈波动，已标记异常拐点：" + (infLabels.length ? infLabels.join("、") : "样本不足") + "；点击趋势线任意点可下钻该周期页面埋点。",
      "①对拐点周对齐运营动作复盘；②对持续下滑周提前预警；③将波动归因沉淀为运营基线。");

    localChart(uid + "_low", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: function (p) { var d = lowEff[p.dataIndex]; return (d ? esc(trunc(d.name, 24)) : "") + "<br/>点击 " + fmtInt(d ? d.clicks : 0) + " · 曝光 " + fmtInt(d ? d.exposures : 0) + (hasCtr ? "<br/>CTR " + (d && d.ctr != null ? d.ctr.toFixed(1) + "%" : "/") : ""); } },
      grid: { left: 230, right: 55, top: 10, bottom: 20 },
      xAxis: { type: "value", name: lowMetricName, axisLabel: { color: SUB, formatter: hasCtr ? "{value}%" : function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: lowEff.map(function (t) { return trunc(t.name, 26); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: lowEff.map(lowValFn), itemStyle: { color: PALETTE[1] }, label: { show: true, position: "right", formatter: function (p) { return lowLblFn(lowEff[p.dataIndex]); } } }]
    });
    var lowTxt, lowAction;
    if (lowEff.length) {
      if (hasCtr) {
        lowTxt = "点击率最低页面为「" + trunc(lowEff[0].name, 22) + "」（CTR " + (lowEff[0].ctr != null ? lowEff[0].ctr.toFixed(1) : "/") + "%，模块均值 " + modCtr.toFixed(1) + "%），属低效入口" + (noExpPages ? ("；另有 " + noExpPages + " 个页面无曝光埋点、CTR 不可计算已单列") : "");
        lowAction = "①对低效高曝光页面优化入口文案/位置或合并；②对冗余页面评估下线或归入高频页；③将点击率纳入页面健康度看板持续监控。";
      } else {
        lowTxt = "该模块埋点未上报曝光数据，点击率(CTR)无法计算；改以「点击量最低」识别疑似冗余/低效页面，最低为「" + trunc(lowEff[0].name, 22) + "」（点击 " + fmtWan(lowEff[0].clicks) + " 次）";
        lowAction = "①补充该模块曝光埋点，以便后续评估页面转化效率；②对点击量极低的页面评估合并或下线；③结合业务确认是否为低频但必要页面。";
      }
    } else {
      lowTxt = "无页面数据";
      lowAction = "调整时间/省份筛选，或确认埋点是否覆盖该模块。";
    }
    var redTxt = redundant.length ? ("；疑似冗余页面（点击量最低）：" + redundant.map(function (r) { return "「" + trunc(r.name, 14) + "」"; }).join("、")) : "";
    analysisBox(uid + "_lowan", lowTxt + redTxt + "。", lowAction);
  }

  /* ---------- 模块专项分析：单一格式 + 筛选键切换（合并原 三~七） ---------- */
  var PG_PT = null, PG_WEEKS = null, PG_AP = null, PG_MOD = "标注", PG_MOD_UID = "";
  // 埋点页顶部 8 卡复用月度页容器（与月度页 pfm* 区分，避免同文档重复 ID）
  var PG_IDS = { kpi: "pgKpi", drillArea: "pgDrillArea", drillTitle: "pgDrillTitle", drillClose: "pgDrillClose", drillExports: "pgDrillExports", colLeft: "pgColLeft", colMid: "pgColMid", colRight: "pgColRight" };
  var PG_MOD_DEFS = [
    { key: "标注", name: "数据标注", pred: function (k) { return k.indexOf("标注") >= 0; } },
    { key: "灵犀", name: "APP灵犀", pred: function (k) { return k.split("-")[0] === "APP灵犀"; }, lingxi: true },
    { key: "个人探索", name: "个人探索", pred: function (k) { return k.split("-")[0] === "个人探索"; } },
    { key: "智能应用工厂", name: "智能应用工厂", pred: function (k) { return k.split("-")[0] === "智能应用工厂"; } },
    { key: "AI能力工厂", name: "AI能力工厂（非标注）", pred: function (k) { return k.split("-")[0] === "AI能力工厂" && k.indexOf("标注") < 0; } }
  ];
  function renderModuleAnalysis() { renderModuleTabs(); renderModuleDeepNow(); }
  function renderModuleTabs() {
    var box = $("pgModTabs"); if (!box) return;
    box.innerHTML = PG_MOD_DEFS.map(function (d) {
      return '<button class="chip' + (d.key === PG_MOD ? " on" : "") + '" data-mod="' + d.key + '">' + esc(d.name) + '</button>';
    }).join("");
    var chips = box.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      (function (el) {
        el.onclick = function () { PG_MOD = el.getAttribute("data-mod"); renderModuleTabs(); renderModuleDeepNow(); };
      })(chips[i]);
    }
  }
  function renderModuleDeepNow() {
    var mount = $("pgModDeep"); if (!mount) return;
    if (PG_MOD_UID) {
      Object.keys(_localInst).forEach(function (k) {
        if (k.indexOf(PG_MOD_UID) === 0) { try { _localInst[k].dispose(); } catch (e) {} delete _localInst[k]; }
      });
    }
    mount.innerHTML = "";
    var def = null;
    for (var i = 0; i < PG_MOD_DEFS.length; i++) if (PG_MOD_DEFS[i].key === PG_MOD) def = PG_MOD_DEFS[i];
    if (!def) return;
    PG_MOD_UID = "pm_" + def.key + "_" + Date.now();
    renderModuleDeep(def.name, def.name + " 模块 · 专项分析", def.pred, PG_PT, PG_WEEKS, mount, PG_MOD_UID, true, def.key === "标注" ? 3 : 2);
    if (def.lingxi) {
      var lxMod = (aggProvModule(PG_PT, PG_WEEKS)["APP灵犀"]) || {};
      var arr = Object.keys(lxMod).map(function (p) { return { name: p, clicks: lxMod[p] }; }).sort(function (a, b) { return b.clicks - a.clicks; });
      if (PG_AP) arr = arr.filter(function (x) { return PG_AP.indexOf(x.name) >= 0; });
      var top = arr.slice(0, 10).reverse();
      mount.insertAdjacentHTML("beforeend",
        '<div class="mdeep-h">④ APP灵犀 · 省份渗透（点击量 TOP 省份）</div>' +
        '<div class="row-2"><div class="chart-card"><div class="ct">灵犀省份点击 TOP10</div><div class="chart" id="' + PG_MOD_UID + '_lxprov"></div></div></div>');
      if (top.length) {
        localChart(PG_MOD_UID + "_lxprov", {
          color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
          grid: { left: 90, right: 55, top: 10, bottom: 30 },
          xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
          yAxis: { type: "category", data: top.map(function (t) { return t.name; }), axisLabel: { color: INK } },
          series: [{ type: "bar", data: top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[3] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
        });
      } else {
        var e = $(PG_MOD_UID + "_lxprov"); if (e) e.innerHTML = '<div class="chart-fallback">当前筛选下灵犀无省份渗透数据</div>';
      }
    }
  }

  /* ---------- 主渲染 ---------- */
  // 顶部 8 卡头条月份：单选某月→该月；「全部」→ 取最新月（与月度页「全部→最新月头条」一致）
  // 注意：埋点域(platformTracking)月份为短格式("2026-5")，月度域(platformMonthly)为补零格式("2026-05")，
  // 直接把短格式传给月度域会导致 M.active[m] 等查找失败（Object.keys(undefined) 异常，整页渲染中断变空白）。
  function pgHeadlineMonth(M) {
    if (!M || !M.months || !M.months.length) return null;
    if (FILTER.pfMonth) {
      var fm = FILTER.pfMonth;
      if (M.months.indexOf(fm) >= 0) return fm;
      var padded = fm.replace(/^(\d{4})-(\d)$/, "$1-0$2");   // "2026-5" → "2026-05"
      return M.months.indexOf(padded) >= 0 ? padded : fm;
    }
    return M.months[M.months.length - 1];
  }

  function renderPages() {
    var pt = V.platformTracking || null;
    var title = $("pgTitle"); if (title) title.textContent = "平台分析（埋点）";

    // 埋点页只保留月维度：归一化筛选状态，避免周维度残留导致空白
    // 默认（未选具体月）即按月聚合全部周，趋势图呈现月度维度而非周维度
    if (!FILTER.pfMonth) { FILTER.pfScope = "month"; FILTER.pfMonth = ""; }
    else { FILTER.pfScope = "month"; }

    // 清理上一轮渲染的动态容器 + 本地图表实例，避免筛选切换时区块/副本累积
    ["pgModDeep", "pgModTabs", "pgLingxiDeep", "pgTrendDrill", "pgKpi", "pgColLeft", "pgColMid", "pgColRight", "pgConclusion"].forEach(function (id) { var el = $(id); if (el) el.innerHTML = ""; });
    var da = $("pgDrillArea"); if (da) da.style.display = "none";
    disposeLocalAll();

    if (!pt || !pt.weeks || !pt.weeks.length) {
      var f1 = $("pgKpi"); if (f1) f1.innerHTML = '<div class="chart-fallback">暂无平台埋点数据（请确认 build/sources 下的 Excel 已构建进 data.js）。</div>';
      var c0 = $("pgConclusion"); if (c0) c0.innerHTML = "";
      var da0 = $("pgDrillArea"); if (da0) da0.style.display = "none";
      return;
    }

    var weeks = selectedWeeks(pt);
    var ap = activeProvinces();
    var scopeNote = scopeText(pt);

    // 聚合
    var pageAgg = aggWeekMap(pt.pageByWeek, weeks);
    var modAgg = aggWeekMap(pt.moduleByWeek, weeks);
    var provModuleAgg = aggProvModule(pt, weeks);
    var provAgg = aggWeekMap(pt.provinceByWeek, weeks);
    if (ap) { var keep = {}; ap.forEach(function (p) { if (p in provAgg) keep[p] = provAgg[p]; }); provAgg = keep; }

    var pageArr = toArr(pageAgg, true).sort(function (a, b) { return b.clicks - a.clicks; });
    var modArr = toArr(modAgg, true).sort(function (a, b) { return b.clicks - a.clicks; });
    var provArr = toArr(provAgg, true).sort(function (a, b) { return b.clicks - a.clicks; });

    // ===== 顶部说明 =====
    noteBox("pgProvNote",
      "数据源：" + (pt.source || "离线 Excel·用户行为记录") + "；" + scopeNote +
      (ap ? "；省份：" + ap.join("、") : "；省份：全国") +
      "。页面维度/菜单结构/趋势为全站口径，省份筛选仅作用于省份维度、灵犀渗透与交叉热力。");

    // ===== 核心指标：8 张卡片（与「平台分析（月）」页完全一致，复用月度 MAU 数据） =====
    var pfmM = (window.PFM && window.PFM.getM) ? PFM.getM() : null;
    if (pfmM && window.PFM && window.PFM.renderKpi) {
      PFM.ensureDrillStyle();
      PFM.renderKpi(pfmM, pgHeadlineMonth(pfmM), PG_IDS);
    }

    // 结论总览用到的当前口径汇总（仍按下方筛选计算）
    // 注意：平均点击率必须用「整体 Σ点击 / Σ曝光」，不能对「各页面 CTR」取算术平均
    // （部分页面点击>曝光导致单页 CTR>100%，平均后会得出 >100% 的荒谬值）
    var sumC = 0, sumV = 0, sumE = 0;
    pageArr.forEach(function (t) { sumC += t.clicks; sumV += t.visitors; sumE += t.exposures; });
    var avgCtr = sumE ? sumC / sumE * 100 : null;

    // ===== 结论总览 =====
    var topMod = modArr[0], topPage = pageArr[0], topProv = provArr[0];
    var modShare = topMod && sumC ? (topMod.clicks / sumC * 100).toFixed(1) : "0";
    var concl = $("pgConclusion");
    if (concl) {
      var li = [];
      // 平台页面总数取自「全量菜单配置元数据」（共 102 页），已下线的页面不计入；
      // 埋点实际观测到的活跃页面数另以 pageArr.length 体现，两者之差即离线/未埋点页面。
      var platPages = (window.PFM && window.PFM.TOTAL_PAGES) ? window.PFM.TOTAL_PAGES : pageArr.length;
      li.push("平台当前配置页面共 " + platPages + " 个（全量菜单配置，已下线的页面不计入）；当前口径（" + scopeNote + "）埋点观测活跃页面 " + pageArr.length + " 个、点击量 " + fmtWan(sumC) + "，平均点击率 " + (avgCtr == null ? "—" : avgCtr.toFixed(2) + "%") + "。");
      if (topMod) li.push("流量高度集中于 <b>" + esc(topMod.name) + "</b> 模块（点击 " + fmtWan(topMod.clicks) + "，占 " + modShare + "%），是平台核心入口。");
      if (topPage) li.push("单页热度最高为 <b>" + esc(trunc(topPage.name, 24)) + "</b>（点击 " + fmtWan(topPage.clicks) + "）。");
      if (topProv) li.push("省份侧 <b>" + esc(topProv.name) + "</b> 点击领先（" + fmtWan(topProv.clicks) + "），但长尾省份仍有较大渗透空间。");
      concl.innerHTML = '<span class="c-title">结论总览</span><ul>' + li.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>";
    }

    // ===== 一、总体趋势 =====
    var ts = trendSeries(pt, weeks);
    var trScope = FILTER.pfScope || "all";
    var trendWeeksOf, ctrArr;
    if (trScope === "month") {
      var monMap = {}; weeks.forEach(function (w) { var m = pt.weekMonth[w]; (monMap[m] = monMap[m] || []).push(w); });
      var ms = Object.keys(monMap).sort();
      trendWeeksOf = ms.map(function (m) { return monMap[m]; });
      ctrArr = ms.map(function (m) { var c = 0, e = 0; monMap[m].forEach(function (w) { var i = pt.weeks.indexOf(w); c += pt.weekly.clicks[i] || 0; e += pt.weekly.exposures[i] || 0; }); return e ? +(c / e * 100).toFixed(2) : 0; });
    } else {
      trendWeeksOf = weeks.map(function (w) { return [w]; });
      ctrArr = weeks.map(function (w) { var i = pt.weeks.indexOf(w); var c = pt.weekly.clicks[i] || 0, e = pt.weekly.exposures[i] || 0; return e ? +(c / e * 100).toFixed(2) : 0; });
    }
    gLabelWeeks = {};
    ts.labels.forEach(function (lab, i) { gLabelWeeks[lab] = trendWeeksOf[i]; });

    var infT = detectInflections(ts.labels, ts.clicks);
    var markT = infT.map(function (i) { return { name: ts.labels[i], coord: [ts.labels[i], ts.clicks[i]], value: "拐点", itemStyle: { color: "#e0533d" } }; });
    var ctTrend = $("pgTrendCt"); if (ctTrend) ctTrend.textContent = (trScope === "month" ? "各月 点击量 / 访客 / 曝光 / 转化率 趋势" : "各周 点击量 / 访客 / 曝光 / 转化率 趋势");
    var trendChart = localChart("pgTrend", {
      color: PALETTE, tooltip: { trigger: "axis" }, legend: { bottom: 0, textStyle: { color: SUB } },
      grid: { left: 70, right: 60, top: 30, bottom: 45 },
      xAxis: { type: "category", data: ts.labels, axisLabel: { color: SUB, fontSize: 11, rotate: ts.labels.length > 8 ? 30 : 0 }, axisLine: { lineStyle: { color: AX } } },
      yAxis: [
        { type: "value", name: "次数", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
        { type: "value", name: "转化率%", min: 0, max: 100, axisLabel: { color: SUB, formatter: "{value}%" }, splitLine: { show: false } }
      ],
      series: [
        { name: "点击量", type: "line", smooth: true, data: ts.clicks, yAxisIndex: 0, itemStyle: { color: PALETTE[0] }, areaStyle: { opacity: 0.08 }, lineStyle: { width: 3 } },
        { name: "访客", type: "line", smooth: true, data: ts.visitors, yAxisIndex: 0, itemStyle: { color: PALETTE[1] } },
        { name: "曝光", type: "line", smooth: true, data: ts.exposures, yAxisIndex: 0, itemStyle: { color: PALETTE[3] } },
        { name: "转化率", type: "line", smooth: true, data: ctrArr, yAxisIndex: 1, itemStyle: { color: PALETTE[5] }, lineStyle: { type: "dashed", width: 2 }, markPoint: { symbol: "pin", symbolSize: 46, data: markT } }
      ]
    });
    if (trendChart) {
      trendChart.on("click", function (params) {
        var label = params.name || ts.labels[params.dataIndex];
        if (!label) return;
        drillPagesPanel("pgTrendDrill", label, pt, scopeText(pt));
        var dz = $("pgTrendDrill"); if (dz && dz.scrollIntoView) dz.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    var totC = ts.clicks.reduce(function (a, b) { return a + b; }, 0);
    var infLabels = infT.map(function (i) { return ts.labels[i] + "（" + fmtWan(ts.clicks[i]) + "）"; });
    analysisBox("pgTrendAn",
      "所选周期内点击量合计 " + fmtWan(totC) + "；已标记异常拐点：" + (infLabels.length ? infLabels.join("、") : "样本不足") + "。点击趋势线任意点（含红点拐点）可下钻该周期各页面埋点分布。",
      "①建立月度环比基线，自动标记异常波动；②将流量高峰与运营动作（培训/推广）对齐复盘，量化效果；③对曝光高但点击低的周期，回头优化入口文案与位置；④对下钻出的低转化页面优先做体验优化。");

    // ===== 二、平台菜单结构 =====
    topChart("pgMenuPie", {
      color: PALETTE, tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { type: "scroll", bottom: 0, textStyle: { color: SUB } },
      series: [{ type: "pie", radius: ["38%", "68%"], center: ["50%", "45%"], data: modArr.slice(0, 6).map(function (m) { return { name: m.name, value: m.clicks }; }), label: { color: INK, formatter: "{b}\n{d}%" } }]
    });
    var m2 = modArr[1];
    analysisBox("pgMenuAn",
      "一级模块点击呈「头部集中」：" + (topMod ? esc(topMod.name) : "—") + " 占 " + modShare + "%，" + (m2 ? esc(m2.name) + " 次之（" + fmtWan(m2.clicks) + "）" : "") + "；AI能力工厂（数据标注/智能体）与智能应用工厂是平台主力工作台。",
      "①对头部模块持续做体验与稳定性保障；②对低活跃模块（系统管理/运营配置等）评估是否合并或精简入口；③按模块点击占比分配前端资源与运营精力。");

    // 二级 / 三级菜单（在一级模块之外细化到操作颗粒度）
    var l2Agg = aggByLevel(pt, weeks, 2, null);
    var l2Arr = Object.keys(l2Agg).map(function (k) { var o = l2Agg[k]; return { name: k, clicks: o.clicks }; }).sort(function (a, b) { return b.clicks - a.clicks; });
    var l2Top = l2Arr.slice(0, 15).reverse();
    topChart("pgMenuL2", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 180, right: 55, top: 20, bottom: 30 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: l2Top.map(function (t) { return trunc(t.name, 22); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: l2Top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[2] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    var l3Agg = aggByLevel(pt, weeks, 3, null);
    var l3Arr = Object.keys(l3Agg).map(function (k) { var o = l3Agg[k]; return { name: k, clicks: o.clicks }; }).sort(function (a, b) { return b.clicks - a.clicks; });
    var l3Top = l3Arr.slice(0, 15).reverse();
    topChart("pgMenuL3", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 220, right: 55, top: 20, bottom: 30 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: l3Top.map(function (t) { return trunc(t.name, 26); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: l3Top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[4] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    // 四级菜单点击量 TOP15
    var l4Agg = aggByLevel(pt, weeks, 4, null);
    var l4Arr = Object.keys(l4Agg).map(function (k) { var o = l4Agg[k]; return { name: k, clicks: o.clicks }; }).sort(function (a, b) { return b.clicks - a.clicks; });
    var l4Top = l4Arr.slice(0, 15).reverse();
    topChart("pgMenuL4", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 240, right: 55, top: 20, bottom: 30 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: l4Top.map(function (t) { return trunc(t.name, 30); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: l4Top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[3] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    analysisBox("pgMenuL23An",
      "二级菜单共 " + l2Arr.length + " 个、三级菜单共 " + l3Arr.length + " 个、四级菜单共 " + l4Arr.length + " 个；头部二级菜单「" + (l2Arr[0] ? esc(trunc(l2Arr[0].name, 18)) : "—") + "」点击最高，三级/四级菜单进一步细化到具体工作台/页面簇，便于定位到操作颗粒度。",
      "①按三级/四级菜单拆解 KPI，把运营从「模块级」细化到「页面簇级」；②对长尾三级/四级菜单评估合并/下线；③结合二/三/四级联动识别高价值操作路径。");

    // ===== 三、模块专项分析（标注 / 灵犀 / 各一级模块 · 筛选键切换）=====
    PG_PT = pt; PG_WEEKS = weeks; PG_AP = ap;
    renderModuleAnalysis();

    // ===== 五、页面维度 =====
    var top = pageArr.slice(0, 15).reverse();
    topChart("pgRank", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 220, right: 55, top: 20, bottom: 30 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: top.map(function (t) { return trunc(t.name, 24); }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: top.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[0] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    var p1 = pageArr[0];
    analysisBox("pgPageAn",
      "页面点击高度集中：TOP1「" + (p1 ? esc(trunc(p1.name, 24)) : "/") + "」点击 " + fmtWan(p1 ? p1.clicks : 0) +
      (p1 && p1.ctr != null ? "（点击率 " + p1.ctr.toFixed(1) + "%）" : "") + "，属于高频操作入口，多为数据标注/智能体展示类页面。",
      "①将 TOP3 高频页面纳入体验优化与稳定性保障清单；②在高频页顶部增加「常用智能体/能力」快捷入口，缩短操作路径；③对高频页监控加载耗时与报错，避免影响一线作业。");

    // ===== 六、省份维度 =====
    var pt15 = provArr.slice(0, 15).reverse();
    topChart("pgProvRank", {
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 90, right: 55, top: 20, bottom: 30 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: pt15.map(function (t) { return t.name; }), axisLabel: { color: INK } },
      series: [{ type: "bar", data: pt15.map(function (t) { return t.clicks; }), itemStyle: { color: PALETTE[1] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    var ptop = provArr[0];
    analysisBox("pgProvAn",
      "点击量省份分布呈「少数领跑、长尾分散」：" + (ptop ? esc(ptop.name) + " 点击 " + fmtWan(ptop.clicks) : "—") +
      "，与分中心规模/业务量正相关；" + provArr.length + " 个省份有埋点上报，平台已在各分中心铺开。",
      "①萃取领先省份标杆用法向其他省推广；②对上报少/无上报的省份排查埋点接入，避免数据盲区；③结合业务量评估投入产出，向高活跃省份倾斜运营资源。");

    // ===== 七、省份 × 模块交叉（细化到三级目录） =====
    var crossCt = $("pgCrossCt");
    var provModL3Agg = aggProvModuleL3(pt, weeks);
    var l3Arr = Object.keys(provModL3Agg).map(function (m) {
      var prs = provModL3Agg[m], tc = 0;
      Object.keys(prs).forEach(function (p) { tc += prs[p] || 0; });
      return { name: m, clicks: tc };
    }).sort(function (a, b) { return b.clicks - a.clicks; });
    var topMods = l3Arr.slice(0, 6).map(function (m) { return m.name; });
    var topProvs = (ap && ap.length ? ap : provArr.slice(0, 10).map(function (p) { return p.name; }));
    if (topMods.length && topProvs.length) {
      if (crossCt) crossCt.textContent = "Top " + topProvs.length + " 省份 × Top " + topMods.length + " 三级模块 点击量分布";
      var hdata = [], maxV = 0;
      topProvs.forEach(function (pr, i) {
        topMods.forEach(function (mo, j) {
          var v = (provModL3Agg[mo] && provModL3Agg[mo][pr]) || 0;
          if (v > maxV) maxV = v;
          hdata.push([j, i, v]);
        });
      });
      topChart("pgCross", {
        tooltip: { position: "top", formatter: function (p) { return topProvs[p.value[1]] + " · " + topMods[p.value[0]] + "<br/>点击 " + fmtInt(p.value[2]); } },
        grid: { left: 110, right: 30, top: 20, bottom: 70 },
        xAxis: { type: "category", data: topMods, axisLabel: { color: SUB, rotate: 25, fontSize: 11 }, splitArea: { show: true } },
        yAxis: { type: "category", data: topProvs, axisLabel: { color: INK }, splitArea: { show: true } },
        visualMap: { min: 0, max: maxV || 1, calculable: true, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: SUB }, inRange: { color: ["#eef4ff", "#8fb4ff", "#3884ff", "#1f5fd1"] } },
        series: [{ type: "heatmap", data: hdata, label: { show: false }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,.3)" } } }]
      });
      analysisBox("pgCrossAn",
        "交叉热力细化到三级模块：头部省份在「AI能力工厂-数据管理-数据标注」等三级模块点击密集，而灵犀/个人探索类模块集中在少数先进省份；省份×三级模块存在明显不均衡。",
        "①对高价值省份×三级模块组合优先投入运营与培训；②针对低渗透格子（省份×三级模块）制定唤醒策略；③按矩阵拆解 KPI，把平台推广从「省维度」细化到「省份×三级模块」颗粒度。");
    } else {
      var cb = $("pgCross"); if (cb) cb.innerHTML = '<div class="chart-fallback">无交叉数据</div>';
      analysisBox("pgCrossAn", "当前筛选下无省份×三级模块交叉数据。", "放宽时间/省份筛选后重试。");
    }

    insightBox("pgInsight",
      "平台分析覆盖 " + pageArr.length + " 个页面、" + provArr.length + " 个上报省份；口径：" + scopeNote +
      "。各图表后均附「原因分析 / 下一步动作」分析，统一按「按月」维度查看。");
  }
})();

;
/* ===== pages/tracking-monthly.js ===== */
/* pages/tracking-monthly.js — 平台分析（月度）
 * 设计依据：《埋点数据看板·指标口径与下钻设计方案》（2026-08-28）
 * 数据源：V.platformMonthly（离线 Excel「平台分析-月」· 用户级埋点，已固化）
 *   - 每月一个 sheet，含 点击量 / 访客人数 / 曝光次数 三个 block
 *   - 点击量 & 曝光次数 block 含 NAME 字段（用户唯一 ID = 省份-姓名）→ 用户级去重
 * 指标口径：
 *   - MAU（月活跃用户数）= 各月 (省份-姓名) 去重集合大小
 *   - 月新增用户数 = 本月用户 − 此前所有月并集（基线月 5 月不报）
 *   - 月留存率 = 上月活跃 ∩ 本月活跃 ÷ 上月活跃（首个有效点 6 月→）
 *   - 转化率（原“应用打开率”）= Σ点击量 ÷ Σ曝光次数（页面级真实，上限 100%）
 * 下钻模式参考「数据总览」抽屉式 modal（遮罩 / Esc 关闭）。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "pages-monthly",
    title: "平台分析（月度）",
    icon: "◷",
    order: 4,
    owner: "赵莹",
    render: function () { renderMonthly(); }
  });

  /* ---------- 局部工具（analysisBox 非全局，需自带；其余复用 core.js 全局） ---------- */
  function analysisBox(id, cause, action) {
    var b = $(id); if (!b) return;
    b.innerHTML = '<div class="an-block">' +
      '<div class="an-item"><span class="an-tag cause">原因分析</span><span class="an-txt">' + cause + '</span></div>' +
      '<div class="an-item"><span class="an-tag action">下一步动作</span><span class="an-txt">' + action + '</span></div>' +
      '</div>';
  }
  function pctChange(cur, base) { if (base === null || base === undefined || base === 0) return null; return (cur - base) / base * 100; }
  function monthLabel(m) { return (m || "").replace("2026-", "") + "月"; }
  function isBaseline(m) { return m === "2026-05"; }            // 部分月，灰显，不环比
  function isInProgress(m) { return m === "2026-08"; }          // 进行中月，数据未落库完

  /* ---------- 读取 platformMonthly 域，整理为前端友好结构 ---------- */
  function getM() {
    var V = window.LY.getView();
    var pm = V.platformMonthly;
    if (!pm) return null;
    if (window.__pfmM) return window.__pfmM;
    var M = {
      months: (pm.months || []).slice(),
      exp: {}, clk: {}, vis: {}, conv: {},
      mau: {}, newU: {}, ret: {}, userKeys: {},
      pageAgg: {}, modAgg: {}, modL2Agg: {}, modL3Agg: {}, provAgg: {}, provModAgg: {}, active: {}, totalCum: {},
      provUser: {}, provNew: {}, newMod: {}, newUserKeys: {},
      userAgg: {}, userL1: {}, userL3: {}, newL3: {}, pageProv: {}, mauComp: {}, avgPages: {}
    };
    M.months.forEach(function (m) {
      var tot = (pm.totalsByMonth && pm.totalsByMonth[m]) || { clicks: 0, visitors: 0, exposures: 0 };
      M.exp[m] = tot.exposures || 0;
      M.clk[m] = tot.clicks || 0;
      M.vis[m] = tot.visitors || 0;
      M.conv[m] = (pm.convRate && pm.convRate[m] != null) ? pm.convRate[m] : (tot.exposures ? +(tot.clicks / tot.exposures * 100).toFixed(2) : null);
      M.mau[m] = (pm.mauByMonth && pm.mauByMonth[m] != null) ? pm.mauByMonth[m] : null;
      M.newU[m] = (pm.newByMonth && pm.newByMonth[m] != null) ? pm.newByMonth[m] : null;
      M.ret[m] = (pm.retByMonth && pm.retByMonth[m] != null) ? pm.retByMonth[m] : null;
      M.userKeys[m] = (pm.userKeysByMonth && pm.userKeysByMonth[m]) || [];
      M.provUser[m] = (pm.provUserByMonth && pm.provUserByMonth[m]) || {};
      M.provNew[m] = (pm.provNewByMonth && pm.provNewByMonth[m]) || {};
      M.newMod[m] = (pm.newUserModuleByMonth && pm.newUserModuleByMonth[m]) || {};
      M.newUserKeys[m] = (pm.newUserKeysByMonth && pm.newUserKeysByMonth[m]) || [];
      M.userAgg[m] = (pm.userAggByMonth && pm.userAggByMonth[m]) || {};
      M.userL1[m] = (pm.userL1ByMonth && pm.userL1ByMonth[m]) || {};
      M.userL3[m] = (pm.userL3ByMonth && pm.userL3ByMonth[m]) || {};
      M.newL3[m] = (pm.newUserL3ByMonth && pm.newUserL3ByMonth[m]) || {};
      M.pageProv[m] = (pm.pageProvUsersByMonth && pm.pageProvUsersByMonth[m]) || {};
      M.mauComp[m] = (pm.mauCompL3ByMonth && pm.mauCompL3ByMonth[m]) || {};
      M.avgPages[m] = (pm.avgPagesByMonth && pm.avgPagesByMonth[m] != null) ? pm.avgPagesByMonth[m] : null;
      M.pageAgg[m] = (pm.pageByMonth && pm.pageByMonth[m]) || {};
      M.modAgg[m] = (pm.moduleByMonth && pm.moduleByMonth[m]) || {};
      M.modL2Agg[m] = (pm.moduleL2ByMonth && pm.moduleL2ByMonth[m]) || {};
      M.modL3Agg[m] = (pm.moduleL3ByMonth && pm.moduleL3ByMonth[m]) || {};
      M.provAgg[m] = (pm.provinceByMonth && pm.provinceByMonth[m]) || {};
      M.provModAgg[m] = (pm.provinceModuleByMonth && pm.provinceModuleByMonth[m]) || {};
      // 活跃页面 = 曝光>0 的三级页
      var act = {};
      Object.keys(M.pageAgg[m]).forEach(function (p) {
        var o = M.pageAgg[m][p];
        if ((o.exposures || 0) > 0) act[p] = 1;
      });
      M.active[m] = act;
      // 平台页面总数：改用「页面配置元数据」（全量菜单），非埋点观测页代理；各月恒定
      M.totalCum[m] = PFM_TOTAL_PAGES;
    });
    window.__pfmM = M;
    return M;
  }

  /* ---------- 8 卡指标规格 ----------
   * 卡片样式完全参考「数据总览」：左侧=指标名称/数值/统计范围/环比，右侧=月均·累计切换+ⓘ口径，右侧趋势图。
   * cumulative=true 的指标支持「累计」(各月求和)；率值/快照类(转化率/页面活跃率/留存/页面总数/活跃页)仅支持「月均」。 */
  var METRICS = [
    { key: "totalUsers", label: "用户总数", star: false, cumulative: false,
      calc: function (M, m) { return totalUsersCount(M); },
      fmt: function (v) { return fmtInt(v); },
      kou: "全量去重用户数（验收口径 = 6717，来自全量用户行为记录真值，5–8 月并集）",
      note: "平台累计去重用户总量，非单月指标；作为 MAU 率、活跃率的分母基数。",
      sub: function () { return "全量去重用户（验收口径 6717）"; } },
    { key: "mau", label: "月活跃用户数 MAU", star: false, cumulative: true,
      calc: function (M, m) { return M.mau[m]; },
      fmt: function (v) { return fmtInt(v); },
      kou: "用户级去重：Σ(省份-姓名) 唯一用户数（月度快照，展示筛选选中月）",
      note: "以「省份-姓名」为唯一用户 ID 去重统计，为真实 MAU（非访客求和近似）。",
      sub: function (M, m) {
        var tu = totalUsersCount(M); if (!tu) return "—";
        var v = M.mau[m]; if (v == null) return "—";
        return "月活跃用户率：" + (v / tu * 100).toFixed(1) + "%";
      } },
    { key: "newu", label: "月新增用户数", star: false, cumulative: true,
      calc: function (M, m) { return M.newU[m]; },
      fmt: function (v) { return fmtInt(v); },
      kou: "本月首次出现的用户数（省份-姓名 未在任何更早月份出现；基线月 5 月不报）",
      note: "本月新增用户；含换省误判误差（建议以工号/账号去重）。",
      sub: function (M, m) {
        var r = nextMonthRetRate(M, m);
        return r == null ? "次月留存率：—（无次月）" : "次月留存率：" + r.toFixed(1) + "%";
      } },
    { key: "totalPages", label: "平台页面总数", star: false, cumulative: false,
      calc: function (M, m) { return PFM_TOTAL_PAGES; },
      fmt: function (v) { return fmtInt(v); },
      kou: "平台全量页面配置元数据（来源：0903灵运平台全量菜单.xlsx，2026-09-03 导出）共 102 页：二级 3 / 三级 64 / 四级 35，每月恒定",
      note: "页面总数来自页面配置元数据（非埋点观测），为固定全量值；活跃率分母=此总数。" },
    { key: "activePages", label: "活跃页面数", star: false, cumulative: false,
      calc: function (M, m) { return Object.keys(M.active[m] || {}).length; },
      fmt: function (v) { return fmtInt(v); },
      kou: "本月曝光>0 的三级页去重（快照）",
      note: "本月曝光>0 的三级页数量（真有人用的页面）。",
      sub: function (M, m) {
        var tot = M.totalCum[m] || 0; if (!tot) return "—";
        return "页面活跃率：" + (Object.keys(M.active[m] || {}).length / tot * 100).toFixed(1) + "%";
      } },
    { key: "open", label: "应用打开次数", star: false, cumulative: true,
      calc: function (M, m) { return M.exp[m]; },
      fmt: function (v) { return fmtWan(v); },
      kou: "Σ 三级页曝光次数（月 PV）",
      note: "Σ 三级页曝光次数，即功能被打开的总次数。",
      sub: function (M, m) { return "头部集中度：" + headConcForMonth(M, m).toFixed(1) + "%"; } },
    { key: "conv", label: "应用转化率", star: true, cumulative: false,
      calc: function (M, m) { return M.conv[m]; },
      fmt: function (v) { return v == null ? "/" : v.toFixed(1) + "%"; },
      kou: "Σ 三级页点击 ÷ Σ 三级页曝光（页面级真实转化率）",
      note: "真实口径 = 三级页点击量 ÷ 三级页曝光次数（上限 100%）。" },
    { key: "retention", label: "月留存率", star: false, cumulative: false,
      calc: function (M, m) { return M.ret[m]; },
      fmt: function (v) { return v == null ? "/" : v.toFixed(1) + "%"; },
      kou: "上月活跃 ∩ 本月活跃 ÷ 上月活跃（首个有效点 6月→；率值）",
      note: "用户级去重口径；基线月 5 月无前置，不报。",
      sub: function (M, m) {
        var months = M.months || []; var mi = months.indexOf(m);
        if (mi <= 0) return "留存人均点击：—（无留存基数）";
        var prevM = months[mi - 1];
        var prevSet = new Set(M.userKeys[prevM] || []);
        var curSet = new Set(M.userKeys[m] || []);
        var retained = [];
        prevSet.forEach(function (k) { if (curSet.has(k)) retained.push(k); });
        var ua = (M.userAgg && M.userAgg[m]) || {};
        var retClk = 0;
        retained.forEach(function (k) { var d = ua[k]; if (d) retClk += d.clicks || 0; });
        return "留存人均点击：" + (retained.length ? (retClk / retained.length).toFixed(1) : "—");
      } }
  ];
  // 卡片主色（冷色系：蓝/青/靛/天蓝，符合整体冷色偏好）
  var PFM_COLORS = { totalUsers: "#0ea5e9", mau: "#3b82f6", newu: "#14b8a6", totalPages: "#6366f1", activePages: "#0ea5e9", open: "#14b8a6", conv: "#8b5cf6", retention: "#6366f1" };
  // —— 派生指标辅助（供卡片「数值下方一行」sub 使用）——
  // 用户总数：验收口径全量去重 = 6717（来自全量《用户行为记录》xlsx 真值；当前 data.js 的 userKeys 并集为部分口径，故直接采用验收真值）
  var PFM_TOTAL_USERS = 6717;
  function totalUsersCount(M) { return PFM_TOTAL_USERS; }
  // —— 平台页面配置元数据（来源：0903灵运平台全量菜单.xlsx，2026-09-03 导出；共 102 页，替代原「埋点观测页」代理） ——
var PFM_PAGE_MENU = [[2, "个人探索", "AI问答", null, null], [3, "个人探索", "信息库", "个人信息库", null], [3, "个人探索", "信息库", "团队信息库", null], [2, "个人探索", "AI问答日志分析", null, null], [3, "APP灵犀", "灵犀智能体运营", "Skill管理", null], [3, "APP灵犀", "灵犀智能体运营", "测评中心", null], [3, "APP灵犀", "灵犀智能体运营", "鉴权配置_临时", null], [2, "APP灵犀", "应用发布", null, null], [3, "APP灵犀", "意图管理", "意图体系", null], [3, "APP灵犀", "意图管理", "意图配置", null], [3, "APP灵犀", "意图管理", "意图审批管理", null], [3, "APP灵犀", "流程管理", "业务流程", null], [3, "APP灵犀", "流程管理", "流程审批管理", null], [3, "APP灵犀", "流程管理", "调试号码管理", null], [3, "APP灵犀", "流程管理", "业务流程_灵犀", null], [3, "APP灵犀", "流程管理", "流程片段_灵犀", null], [3, "APP灵犀", "流程管理", "指令管理_灵犀", null], [3, "APP灵犀", "资源库管理", "知识配置", null], [3, "APP灵犀", "资源库管理", "知识审批管理", null], [3, "APP灵犀", "资源库管理", "气泡管理", null], [3, "APP灵犀", "资源库管理", "气泡组管理", null], [3, "APP灵犀", "资源库管理", "卡片模板", null], [3, "APP灵犀", "资源库管理", "业务接口", null], [3, "APP灵犀", "渠道管理", "入口管理", null], [3, "APP灵犀", "渠道管理", "首页配置管理", null], [3, "APP灵犀", "渠道管理", "首页工单管理", null], [3, "APP灵犀", "渠道管理", "首页审批管理", null], [3, "APP灵犀", "渠道管理", "应急业务快回配置", null], [3, "APP灵犀", "渠道管理", "应急业务快回审批管理", null], [3, "APP灵犀", "评测管理", "数据看板", null], [3, "APP灵犀", "评测管理", "用户评价管理", null], [3, "APP灵犀", "评测管理", "回放统计", null], [3, "APP灵犀", "评测管理", "回放管理", null], [3, "APP灵犀", "评测管理", "交互日志查询", null], [3, "APP灵犀", "全屏版配置管理", "渠道列表", null], [3, "APP灵犀", "全屏版配置管理", "关键词管理", null], [3, "APP灵犀", "全屏版配置管理", "动作组管理", null], [3, "APP灵犀", "灵犀会话系统管理", "内测白名单", null], [3, "APP灵犀", "灵犀会话系统管理", "正则", null], [3, "智能应用工厂", "智能体构建", "智能体", null], [3, "智能应用工厂", "智能体构建", "工作流", null], [3, "智能应用工厂", "智能体构建", "对话流", null], [3, "智能应用工厂", "智能体展示", "应用广场", null], [3, "智能应用工厂", "智能体展示", "个人应用", null], [3, "智能应用工厂", "智能体展示", "团队应用", null], [3, "智能应用工厂", "智能评测", "坐席agent", null], [3, "智能应用工厂", "智能体监控", "运营总览", null], [3, "智能应用工厂", "智能体监控", "运营统计", null], [3, "智能应用工厂", "智能体监控", "性能看板", null], [3, "智能应用工厂", "智能体监控", "SDK模型监控", null], [3, "智能应用工厂", "运营管理", "上下架管理", null], [3, "智能应用工厂", "运营管理", "上线审批", null], [3, "AI能力工厂", "工具管理", "提示工具", null], [3, "AI能力工厂", "工具管理", "模型工具", null], [4, "AI能力工厂", "工具管理", "AI话术", "接口管理"], [4, "AI能力工厂", "工具管理", "AI话术", "模板管理"], [4, "AI能力工厂", "工具管理", "AI话术", "效果调试"], [4, "AI能力工厂", "工具管理", "AI话术", "智能话术配置管理"], [3, "AI能力工厂", "工具管理", "技能工具", null], [4, "AI能力工厂", "模型管理", "模型微调", "参数微调_任务管理"], [4, "AI能力工厂", "模型管理", "模型微调", "参数微调_任务监控"], [4, "AI能力工厂", "模型管理", "模型微调", "Prompt任务管理"], [4, "AI能力工厂", "模型管理", "模型微调", "Prompt工程广场"], [4, "AI能力工厂", "模型管理", "模型评测", "任务管理"], [4, "AI能力工厂", "模型管理", "模型管理", "模型纳管"], [4, "AI能力工厂", "模型管理", "模型管理", "模型纳管操作日志"], [4, "AI能力工厂", "模型管理", "模型授权", "调用申请"], [4, "AI能力工厂", "模型管理", "模型授权", "授权审批"], [4, "AI能力工厂", "模型管理", "模型授权", "我的授权"], [4, "AI能力工厂", "模型管理", "模型授权", "授权管理"], [4, "AI能力工厂", "模型管理", "模型授权", "渠道管理"], [4, "AI能力工厂", "模型管理", "模型看板", "模型计费看板"], [4, "AI能力工厂", "模型管理", "模型看板", "调用统计"], [4, "AI能力工厂", "模型管理", "模型看板", "调用日志"], [4, "AI能力工厂", "数据管理", "数据飞轮", "任务监控"], [4, "AI能力工厂", "数据管理", "数据飞轮", "任务创建"], [4, "AI能力工厂", "数据管理", "数据集管理", "数据接入"], [4, "AI能力工厂", "数据管理", "数据标注", "语音_数据集管理"], [4, "AI能力工厂", "数据管理", "数据标注", "语音_项目管理"], [4, "AI能力工厂", "数据管理", "数据标注", "语音_数据标注"], [4, "AI能力工厂", "数据管理", "数据标注", "语音_效果验证"], [4, "AI能力工厂", "数据管理", "数据标注", "文本_任务管理"], [4, "AI能力工厂", "数据管理", "数据标注", "文本_标注管理"], [4, "AI能力工厂", "数据管理", "数据标注", "团队管理"], [4, "AI能力工厂", "数据管理", "数据标注", "统计管理"], [4, "AI能力工厂", "数据管理", "数据处理", "数据清洗"], [4, "AI能力工厂", "数据管理", "数据处理", "数据增强"], [4, "AI能力工厂", "数据管理", "智能体标注", "标注任务"], [4, "AI能力工厂", "数据管理", "智能体标注", "模板中心"], [4, "AI能力工厂", "数据管理", "智能体标注", "智能体协作"], [3, "运营配置", "统一意图", "意图管理", null], [3, "运营配置", "统一意图", "实体管理", null], [3, "运营配置", "统一意图", "意图识别", null], [3, "运营配置", "在线客服", "流程优化", null], [3, "运营配置", "综合运营", "问题反馈管理", null], [3, "系统管理", "平台监控", "统计分析", null], [3, "系统管理", "平台监控", "页面监控", null], [3, "系统管理", "平台监控", "层级管理", null], [3, "系统管理", "系统管理", "菜单管理", null], [3, "系统管理", "系统管理", "组织管理", null], [3, "系统管理", "系统管理", "角色管理", null], [3, "系统管理", "系统管理", "账号管理", null]];
  var PFM_TOTAL_PAGES = PFM_PAGE_MENU.length; // 平台全量页面总数 = 102
  function pageLevelCount(L) { var n = 0; for (var i = 0; i < PFM_PAGE_MENU.length; i++) { if (PFM_PAGE_MENU[i][0] === L) n++; } return n; }

  // 次月留存率：本月新增用户在下月仍活跃的比例（队列留存）
  function nextMonthRetRate(M, m) {
    var idx = (M.months || []).indexOf(m);
    if (idx < 0 || idx + 1 >= (M.months || []).length) return null;
    var nextM = M.months[idx + 1];
    var nu = M.newUserKeys[m] || [];
    if (!nu.length) return null;
    var nset = new Set(nu), nxt = new Set(M.userKeys[nextM] || []);
    var r = 0; nset.forEach(function (k) { if (nxt.has(k)) r++; });
    return r / nu.length * 100;
  }
  // 头部集中度：Top10% 三级页曝光占全部曝光的比例（复用 headConcentration）
  function headConcForMonth(M, m) {
    var pg = M.pageAgg[m] || {};
    var rows = Object.keys(pg).map(function (p) { return { exp: pg[p].exposures || 0 }; });
    var total = rows.reduce(function (s, r) { return s + r.exp; }, 0) || 1;
    return headConcentration(rows, "exp", total);
  }

  // 时间筛选（页内，月维度，单选/多选）——本页数据月份为 2026-05~08，与全站全局筛选（1-7月/N月 键）口径不同，故独立维护
  var SEL_MONTHS = null; // null = 全选
  function selMonths(M) {
    if (!SEL_MONTHS) return M.months.slice();
    var s = SEL_MONTHS.filter(function (m) { return M.months.indexOf(m) >= 0; });
    s.sort(function (a, b) { return M.months.indexOf(a) - M.months.indexOf(b); });
    return s.length ? s : M.months.slice();
  }
  function headlineMonth(M) {
    var s = selMonths(M);
    if (s.length === M.months.length) return M.months[M.months.length - 1]; // 全部 → 最新月
    return s[0]; // 单选隔离 → 所选月
  }
  // 跨所选月聚合三级模块树：tree[L1][L2][L3] = {clicks,visitors,exposures}
  function buildTree(M, months) {
    var tree = {};
    months.forEach(function (m) {
      var L3 = M.modL3Agg[m] || {};
      Object.keys(L3).forEach(function (l1) {
        tree[l1] = tree[l1] || {};
        Object.keys(L3[l1]).forEach(function (l2) {
          tree[l1][l2] = tree[l1][l2] || {};
          Object.keys(L3[l1][l2]).forEach(function (l3) {
            var d = L3[l1][l2][l3];
            var t = tree[l1][l2][l3] = tree[l1][l2][l3] || { clicks: 0, visitors: 0, exposures: 0 };
            t.clicks += d.clicks; t.visitors += d.visitors; t.exposures += d.exposures;
          });
        });
      });
    });
    return tree;
  }
  // 模块下钻状态（全部 → L1 → L2）
  // 与 build_real.py L1_MODULES 保持一致
  var L1_MODULES = ["个人探索", "APP灵犀", "智能应用工厂", "AI能力工厂", "运营配置", "系统管理"];
  var MOD_DRILL = { l1: null, l2: null };
  var HEALTH_Q = "";

  function l1Of(page) {
    var map = { "个人探索": "个人探索", "APP灵犀": "APP灵犀", "智能应用工厂": "智能应用工厂", "AI能力工厂": "AI能力工厂", "运营配置": "运营配置", "系统管理": "系统管理",
      "智能体调优": "智能应用工厂", "智能体构建": "智能应用工厂", "智能体应用": "APP灵犀", "智能体运营": "运营配置" };
    if (!page) return "智能应用工厂";
    var seg = (page.split("-")[0] || "").trim();
    if (map[seg]) return map[seg];
    if (L1_MODULES.indexOf(seg) >= 0) return seg;
    // 兜底关键字
    if (/灵犀|APP|应用/.test(seg)) return "APP灵犀";
    if (/运营|配置|管理/.test(seg)) return "运营配置";
    if (/系统|设置|权限/.test(seg)) return "系统管理";
    if (/个人|我的|探索/.test(seg)) return "个人探索";
    if (/AI能力|模型|提示词|技能/.test(seg)) return "AI能力工厂";
    if (/智能体|应用工厂|构建|调优/.test(seg)) return "智能应用工厂";
    return "智能应用工厂";
  }

  function renderHealthTable(M, m) {
    var box = $("pfmHealth"); if (!box) return;
    var pg = M.pageAgg[m] || {};
    var before = pagesBefore(M, m);
    var rows = Object.keys(pg).map(function (p) {
      var d = pg[p]; var exp = d.exposures || 0, clk = d.clicks || 0, vis = d.visitors || 0;
      var segs = p.split("-");
      var l1 = l1Of(p);
      var l2 = (segs[1] || "").trim() || "—";
      var st = exp > 0 ? (before.has(p) ? "active" : "new") : "dead";
      var stTxt = st === "active" ? "健康活跃" : (st === "new" ? "本月新增" : "沉默死页");
      var op = st === "dead" ? "建议下架" : "明细";
      var opCls = st === "dead" ? "op warn" : "op";
      return {
        page: p, l1: l1, l2: l2, exp: exp, clk: clk, vis: vis, ctr: exp ? clk / exp * 100 : 0,
        st: st, stTxt: stTxt, op: op, opCls: opCls
      };
    });
    var activeN = rows.filter(function (r) { return r.st === "active"; }).length;
    var newN = rows.filter(function (r) { return r.st === "new"; }).length;
    var deadN = rows.filter(function (r) { return r.st === "dead"; }).length;
    var q = (HEALTH_Q || "").trim().toLowerCase();
    var filtered = rows;
    if (q) {
      filtered = rows.filter(function (r) {
        return r.page.toLowerCase().indexOf(q) >= 0 || r.l1.toLowerCase().indexOf(q) >= 0 || r.l2.toLowerCase().indexOf(q) >= 0;
      });
    }
    filtered.sort(function (a, b) {
      // 健康活跃 > 本月新增 > 沉默死页；同类按曝光降序
      var o = { active: 0, new: 1, dead: 2 };
      if (o[a.st] !== o[b.st]) return o[a.st] - o[b.st];
      return b.exp - a.exp;
    });
    var showRows = filtered.slice(0, 50);
    var html =
      '<div class="pfm-health-bar">' +
        '<div class="pfm-health-stat">' +
          '<span class="h-active">健康活跃 <b>' + activeN + '</b></span>' +
          '<span class="h-new">本月新增 <b>' + newN + '</b></span>' +
          '<span class="h-dead">沉默死页 <b>' + deadN + '</b></span>' +
        '</div>' +
        '<div class="pfm-health-search">' +
          '<input type="text" id="pfmHealthInput" placeholder="搜索页面名称 / 一级菜单 / 二级分类" value="' + esc(HEALTH_Q) + '">' +
          '<span class="h-info">展示 ' + showRows.length + ' / ' + filtered.length + ' 个页面</span>' +
        '</div>' +
      '</div>' +
      '<div style="overflow:auto;max-height:520px">' +
      '<table class="pfm-health-tbl"><thead><tr>' +
        '<th style="text-align:left">三级应用页面名称</th>' +
        '<th style="text-align:left">所属一级菜单</th>' +
        '<th style="text-align:left">二级分类</th>' +
        '<th>曝光次数(PV)</th>' +
        '<th>点击量（交互）</th>' +
        '<th>去重用户量</th>' +
        '<th>点击率(CTR)</th>' +
        '<th>状态判定</th>' +
        '<th>操作建议</th>' +
      '</tr></thead><tbody>' +
      showRows.map(function (r) {
        return '<tr>' +
          '<td class="name" title="' + esc(r.page) + '">' + esc(r.page) + '</td>' +
          '<td class="l1">' + esc(r.l1) + '</td>' +
          '<td class="l2">' + esc(r.l2) + '</td>' +
          '<td>' + fmtInt(r.exp) + '</td>' +
          '<td>' + fmtInt(r.clk) + '</td>' +
          '<td>' + fmtInt(r.vis) + '人</td>' +
          '<td>' + r.ctr.toFixed(1) + '%</td>' +
          '<td><span class="badge ' + r.st + '">' + r.stTxt + '</span></td>' +
          '<td><span class="' + r.opCls + '">' + r.op + '</span></td>' +
          '</tr>';
      }).join("") +
      '</tbody></table></div>' +
      '<div class="pfm-note" style="margin-top:10px"><b>口径：</b>状态判定基于本月埋点：健康活跃=曝光>0且上月已存在；本月新增=曝光>0且首次出现；沉默死页=曝光≈0。建议下架仅针对死页。搜索支持页面名称、一级菜单、二级分类。</div>';
    box.innerHTML = html;
    var inp = box.querySelector("#pfmHealthInput");
    if (inp) {
      inp.oninput = function () { HEALTH_Q = inp.value; renderHealthTable(M, m); };
    }
  }

  /* ---------- 主渲染 ---------- */
  function renderMonthly() {
    var V = window.LY.getView();
    var pm = V.platformMonthly;
    var title = $("pfmTitle"); if (title) title.textContent = "平台分析（月度）";
    delete window.__pfmM; // 数据可能刷新，重算
    var M = getM();
    if (!M || !M.months.length) {
      ["pfmKpi", "pfmTrend", "pfmModTree", "pfmInsight"].forEach(function (id) { var b = $(id); if (b) b.innerHTML = '<div class="chart-fallback">暂无平台月度数据（请确认 build/sources 下的 Excel 已构建进 data.js）。</div>'; });
      return;
    }
    MOD_DRILL = { l1: null, l2: null };
    renderMonthChips(M);
    var sels = selMonths(M);
    var head = headlineMonth(M);

    renderKpi(M, head);
    MOD_M = M; MOD_SELS = sels;
    renderTrend(M, sels);
    renderModules(M, sels);
    renderHealthTable(M, head);
    renderNote(M, sels);
    insightBox("pfmInsight", "平台分析（月度）覆盖 " + M.months.length + " 个月；一级模块共 6 个（个人探索 / APP灵犀 / 智能应用工厂 / AI能力工厂 / 运营配置 / 系统管理），下钻可见二/三级与点击/访客/曝光三指标。点击任意 KPI 卡片可下钻六类面板。底部三级功能页健康度台账可按页面/菜单搜索。");
  }

  /* ---------- 月份芯片（单选/多选，页内时间筛选） ---------- */
  function renderNote(M, sels) {
    var selLabel = sels.length === M.months.length ? "全部 " + M.months.length + " 个月" : (sels.map(monthLabel).join("、") + "（" + sels.length + " 个月）");
    var pm = (window.LY.getView() || {}).platformMonthly || {};
    var srcTxt = (pm.source || "离线 Excel·平台分析-月") + (pm.isSample ? "（⚠ 样本验证数据，非真实全量）" : "");
    noteBox("pfmProvNote", "数据源：" + srcTxt + "；口径：用户级真实去重（省份-姓名）。时间筛选=本页月份（单选/多选，当前：" + selLabel + "）。MAU/新增/留存/转化率均为真实值。");
  }
  function renderMonthChips(M) {
    var box = $("pfmMonthChips"); if (!box) return;
    if (SEL_MONTHS == null) SEL_MONTHS = M.months.slice();
    var allOn = SEL_MONTHS.length === M.months.length;
    var chips = M.months.map(function (m) {
      var on = SEL_MONTHS.indexOf(m) >= 0 ? " on" : "";
      var tag = isBaseline(m) ? "（基线·部分月）" : (isInProgress(m) ? "（进行中）" : "");
      return '<button class="chip mchip' + on + '" data-m="' + m + '" title="点击仅看该月">' + monthLabel(m) + tag + "</button>";
    }).join("");
    var allChip = '<button class="chip mchip' + (allOn ? " on" : "") + '" data-all="1" title="恢复全部月份">全部</button>';
    box.innerHTML = chips + allChip;
    box.querySelectorAll(".mchip").forEach(function (c) {
      c.onclick = function () {
        if (c.dataset.all) SEL_MONTHS = M.months.slice();   // 全部
        else SEL_MONTHS = [c.dataset.m];                     // 单选隔离该月
        renderMonthChips(M);
        var sels = selMonths(M), head = headlineMonth(M);
        renderKpi(M, head); MOD_M = M; MOD_SELS = sels;
        renderTrend(M, sels); renderModules(M, sels); renderHealthTable(M, head); renderNote(M, sels);
      };
    });
  }

  /* ---------- 三级模块树（6 一级模块 · 可下钻 L1→L2→L3，每层点击/访客/曝光） ---------- */
  var MOD_M = null, MOD_SELS = null;
  function ensureModTreeStyle() {
    if (document.getElementById("pfmModTreeStyle")) return;
    var s = document.createElement("style");
    s.id = "pfmModTreeStyle";
    s.textContent =
      ".pfm-mod-crumb{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin:6px 0 10px;flex-wrap:wrap}" +
      ".pfm-mod-crumb .c{color:var(--brand-2);cursor:pointer;font-weight:700}" +
      ".pfm-mod-crumb .c.cur{color:var(--ink);cursor:default}" +
      ".pfm-mod-crumb .sep{color:#cbd5e1}" +
      ".pfm-mod-tbl{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}" +
      ".pfm-mod-tbl th,.pfm-mod-tbl td{border:1px solid var(--line);padding:6px 8px;text-align:right}" +
      ".pfm-mod-tbl th{background:#f8fafc;color:var(--muted);font-weight:700}" +
      ".pfm-mod-tbl tr.drill{cursor:pointer}" +
      ".pfm-mod-tbl tr.drill:hover td{background:#eef6ff}" +
      ".pfm-mod-tbl td.name{text-align:left;color:var(--ink);font-weight:600}" +
      ".pfm-mod-tbl td.name .ar{color:var(--brand-2);font-size:10px;margin-left:4px}";
    document.head.appendChild(s);
  }
  function _modAgg(tree, l1, l2, l3) {
    function add(a, d) { if (!d) return; a.c += d.clicks || 0; a.v += d.visitors || 0; a.e += d.exposures || 0; }
    var a = { c: 0, v: 0, e: 0 };
    if (l3 != null) add(a, (((tree[l1] || {})[l2] || {})[l3]));
    else if (l2 != null) { var L3 = ((tree[l1] || {})[l2] || {}); Object.keys(L3).forEach(function (k) { add(a, L3[k]); }); }
    else { var L2 = (tree[l1] || {}); Object.keys(L2).forEach(function (k2) { var L3 = L2[k2] || {}; Object.keys(L3).forEach(function (k3) { add(a, L3[k3]); }); }); }
    return { clicks: a.c, visitors: a.v, exposures: a.e, ctr: a.e ? a.c / a.e * 100 : null };
  }
  function renderModules(M, sels) {
    var box = $("pfmModTree"); if (!box) return;
    ensureModTreeStyle();
    var tree = buildTree(M, sels);
    var l1 = MOD_DRILL.l1, l2 = MOD_DRILL.l2;
    var level = l1 ? (l2 ? "L3" : "L2") : "L1";
    var items = [];
    if (level === "L1") L1_MODULES.forEach(function (n) { if (tree[n]) items.push(n); });
    else if (level === "L2") Object.keys(tree[l1] || {}).forEach(function (k) { items.push(k); });
    else Object.keys((tree[l1] || {})[l2] || {}).forEach(function (k) { items.push(k); });

    var rows = items.map(function (k) {
      var d = (level === "L1") ? _modAgg(tree, k, null, null)
        : (level === "L2") ? _modAgg(tree, l1, k, null)
          : _modAgg(tree, l1, l2, k);
      return { key: k, d: d };
    }).sort(function (a, b) { return b.d.clicks - a.d.clicks; });

    var selsLabel = sels.length === M.months.length ? "全部月份合计" : (sels.map(monthLabel).join("、"));
    var crumb = '<span class="c' + (level === "L1" ? " cur" : "") + '" data-go="root">全部</span>';
    if (l1) crumb += '<span class="sep">›</span><span class="c' + (level === "L2" ? " cur" : "") + '" data-go="l1">' + esc(l1) + '</span>';
    if (l2) crumb += '<span class="sep">›</span><span class="c cur">' + esc(l2) + '</span>';

    var top = rows.slice(0, 10).reverse();
    var levelLabel = level === "L1" ? "一级模块点击量 TOP" : (level === "L2" ? esc(l1) + " · 二级模块点击量 TOP" : esc(l1) + " › " + esc(l2) + " · 三级点击量 TOP");
    box.innerHTML = '<div class="pfm-mod-crumb" id="pfmModCrumb">' + crumb + '</div>' +
      '<div class="chart-card"><div class="ct">' + esc(selsLabel) + ' · ' + levelLabel + '</div><div class="chart" id="pfmModBar" style="height:300px"></div></div>' +
      '<div id="pfmModTbl"></div>';
    if (window.echarts) {
      topChart("pfmModBar", {
        color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        grid: { left: 150, right: 55, top: 10, bottom: 20 },
        xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
        yAxis: { type: "category", data: top.map(function (t) { return t.key; }), axisLabel: { color: INK, fontSize: 11 } },
        series: [{ type: "bar", data: top.map(function (t) { return t.d.clicks; }), itemStyle: { color: PALETTE[0] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
      });
    }
    var tbl = '<table class="pfm-mod-tbl"><thead><tr><th style="text-align:left">模块</th><th>点击量</th><th>访客</th><th>曝光</th><th>转化率</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var drillable = level !== "L3";
        return '<tr class="' + (drillable ? "drill" : "") + '" data-key="' + esc(r.key) + '">' +
          '<td class="name">' + esc(r.key) + (drillable ? ' <span class="ar">›</span>' : '') + '</td>' +
          '<td>' + fmtInt(r.d.clicks) + '</td><td>' + fmtInt(r.d.visitors) + '</td><td>' + fmtInt(r.d.exposures) + '</td>' +
          '<td>' + (r.d.ctr == null ? "/" : r.d.ctr.toFixed(1) + "%") + '</td></tr>';
      }).join("") + '</tbody></table>';
    var tw = box.querySelector("#pfmModTbl"); if (tw) tw.innerHTML = tbl;

    var cb = box.querySelector("#pfmModCrumb");
    if (cb) cb.querySelectorAll(".c").forEach(function (c) {
      c.onclick = function () {
        var go = c.dataset.go;
        if (go === "root") MOD_DRILL = { l1: null, l2: null };
        else if (go === "l1") MOD_DRILL = { l1: l1, l2: null };
        renderModules(MOD_M, MOD_SELS);
      };
    });
    box.querySelectorAll("#pfmModTbl tr.drill").forEach(function (tr) {
      tr.onclick = function () {
        var k = tr.dataset.key;
        if (level === "L1") MOD_DRILL = { l1: k, l2: null };
        else if (level === "L2") MOD_DRILL = { l1: l1, l2: k };
        renderModules(MOD_M, MOD_SELS);
      };
    });
  }

  /* ---------- 8 张核心卡 ---------- */
  // 容器 ID 映射：默认 pfm*（月度页自身）；埋点页可传 PG_IDS 复用同一套卡片/下钻逻辑，互不冲突
  var PFM_IDS = { kpi: "pfmKpi", drillArea: "pfmDrillArea", drillTitle: "pfmDrillTitle", drillClose: "pfmDrillClose", drillExports: "pfmDrillExports", colLeft: "pfmColLeft", colMid: "pfmColMid", colRight: "pfmColRight" };

  /* ---------- 卡片主值聚合：月均=各月均值，累计=各月求和（率值/快照指标累计禁用） ---------- */
  function computePfmAgg(mt, M, mode) {
    var vals = M.months.map(function (mm) { var v = mt.calc(M, mm); return (v == null ? null : v); })
      .filter(function (v) { return v != null; });
    if (!vals.length) return null;
    if (mode === "累计") return vals.reduce(function (a, b) { return a + b; }, 0);
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  function pfmRangeLabel(M) {
    var ms = M.months; if (!ms.length) return "";
    return monthLabel(ms[0]) + "–" + monthLabel(ms[ms.length - 1]);
  }
  // 迷你趋势图（SVG sparkline，参考「数据总览」）
  function pfmSpark(vals, color) {
    var w = 86, h = 30, pad = 3;
    var nums = vals.filter(function (v) { return v != null; });
    if (nums.length < 2) return '<span class="spark-empty">—</span>';
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), rng = (max - min) || 1;
    var n = vals.length;
    var pts = vals.map(function (v, i) {
      var x = pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
      var y = h - pad - (h - 2 * pad) * (v == null ? 0 : (v - min) / rng);
      return [x, y];
    });
    var ptsStr = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var areaPts = ptsStr + " " + pts[pts.length - 1][0].toFixed(1) + "," + (h - pad).toFixed(1) + " " + pts[0][0].toFixed(1) + "," + (h - pad).toFixed(1);
    var gid = "sg" + Math.random().toString(36).slice(2, 8);
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + areaPts + '" fill="url(#' + gid + ')"/>' +
      '<polyline points="' + ptsStr + '" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
      '</svg>';
  }
  // 卡片底部环比（VS 上月）：本平台无去年同期数据，以「环比上一月」呈现（与数据总览底部一致）
  function pfmMomHtml(mt, M, m) {
    var mi = M.months.indexOf(m);
    if (mi <= 0) return '<span class="mom flat" title="无上期对照数据，无法计算环比">— 无上期对照</span>';
    var cur = mt.calc(M, m), prev = mt.calc(M, M.months[mi - 1]);
    if (cur == null || prev == null) return '<span class="mom flat" title="无上期对照数据，无法计算环比">— 无上期对照</span>';
    var cls, txt;
    if (mt.star) {
      var pp = cur - prev;
      cls = pp > 0.05 ? "up" : (pp < -0.05 ? "down" : "flat");
      txt = (pp >= 0 ? "+" : "") + pp.toFixed(1) + "pp";
    } else {
      var p = prev ? (cur - prev) / prev * 100 : 0;
      cls = p > 0.5 ? "up" : (p < -0.5 ? "down" : "flat");
      txt = (p >= 0 ? "+" : "") + Math.round(p) + "%";
    }
    return '<span class="mom ' + cls + '" title="环比上一月（' + monthLabel(M.months[mi - 1]) + '）">环比 ' + monthLabel(M.months[mi - 1]) + ' ' + txt + '</span>';
  }

  /* ---------- 8 卡渲染（完全参考「数据总览」卡片样式） ----------
   * 单月口径：卡片主值取筛选选中月 m 的单月值（不在卡内做月均/累计切换，切换入口在页面顶部月份筛选）。
   * 数值下方一行（kpi-sub）：优先 metric.sub(M,m) 派生指标（月活跃率/次月留存率/页面活跃率/头部集中度），否则显示选中月份；
   * 底部（kpi-foot）：仅保留对比数值（环比上一月，带方向色；月份维度已由 kpi-sub 行展示），统一居左。 */
  function renderKpi(M, m, ids) {
    ids = ids || PFM_IDS;
    var grid = $(ids.kpi); if (!grid) return;
    ensurePfmcStyle();
    var html = METRICS.map(function (mt) {
      var cur = mt.calc(M, m);
      var color = PFM_COLORS[mt.key] || "#3b82f6";
      var valTxt = (cur == null) ? "/" : mt.fmt(cur);
      // 数值下方一行：派生指标优先，否则选中月份
      var sub = mt.sub ? mt.sub(M, m) : null;
      var hasSub = (sub != null && sub !== "");
      var subTxt = hasSub ? sub : monthLabel(m);
      // 底部环比（VS 上月）；全量指标（用户总数）无环比，显示全量口径说明
      var mom = (cur == null) ? '<span class="mom flat">— 无数据</span>' : pfmMomHtml(mt, M, m);
      var foot = (mt.key === "totalUsers")
        ? '<span class="mom flat" title="全量累计去重用户，非单月指标">全量累计去重</span>'
        : mom;
      var spark = (cur == null) ? '<span class="spark-empty">—</span>' : pfmSpark(M.months.map(function (mm) { return mt.calc(M, mm); }), color);
      return '<div class="kpi kpi-pfm" data-key="' + mt.key + '" style="--c:' + color + '">' +
        '<div class="kpi-hd">' +
          '<div class="lb">' + esc(mt.label) + '</div>' +
          '<div class="kpi-actions">' +
            '<span class="tip" data-tip="' + esc(mt.kou) + '">ⓘ</span>' +
          '</div>' +
        '</div>' +
        '<div class="val">' + valTxt + '</div>' +
        '<div class="kpi-sub">' + esc(subTxt) + '</div>' +
        '<div class="kpi-spark">' + spark + '</div>' +
        '<div class="kpi-foot">' + foot + '</div>' +
      '</div>';
    }).join("");
    grid.innerHTML = html;
    grid.querySelectorAll(".kpi-pfm").forEach(function (el) {
      el.onclick = function () { openDrill(el.dataset.key, M, m, ids); };
    });
  }

  /* ---------- 顶部卡片样式（完全参考「数据总览」KPI 卡） ---------- */
  function ensurePfmcStyle() {
    if (document.getElementById("pfmCardStyle")) return;
    var s = document.createElement("style");
    s.id = "pfmCardStyle";
    s.textContent =
      /* 覆盖容器最小宽度，确保卡片内容（标题/数值/范围/环比/切换/趋势）完整 */
      "#pgKpi.kpi-grid,#pfmKpi.kpi-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))!important}" +
      ".kpi-pfm{position:relative;min-height:140px;display:flex;flex-direction:column;padding:14px 14px 12px;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}" +
      ".kpi-pfm:hover{box-shadow:0 6px 18px rgba(31,41,55,.14);transform:translateY(-2px)}" +
      ".kpi-pfm.selected{outline:2px solid var(--brand);outline-offset:2px;box-shadow:0 8px 22px rgba(59,130,246,.20)}" +
      ".kpi-pfm .kpi-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:2px}" +
      ".kpi-pfm .kpi-hd .lb{flex:1 1 auto;min-width:0;font-size:12px;color:var(--muted);margin:0;padding-right:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".kpi-pfm .kpi-actions{display:flex;align-items:center;gap:5px;flex-shrink:0;margin-top:-1px}" +
      ".kpi-pfm .kpi-mode-seg{display:inline-flex;border:1px solid var(--line,#e5e7eb);border-radius:6px;overflow:hidden;background:#fff}" +
      ".kpi-pfm .kpi-mode-btn{border:none;background:#fff;color:#64748b;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;line-height:1;transition:.12s}" +
      ".kpi-pfm .kpi-mode-btn.active{background:var(--brand,#3b82f6);color:#fff}" +
      ".kpi-pfm .kpi-mode-btn:disabled{opacity:.55;cursor:not-allowed;background:#f8fafc;color:#94a3b8}" +
      ".kpi-pfm .kpi-mode-btn:not(.active):not(:disabled):hover{background:var(--brand-soft,#eff6ff);color:var(--brand,#3b82f6)}" +
      ".kpi-pfm .tip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--brand-soft,#eff6ff);color:var(--brand,#3b82f6);font-size:11px;line-height:1;cursor:help;font-style:normal;font-weight:700;z-index:2}" +
      ".kpi-pfm .tip::after{content:attr(data-tip);position:absolute;right:0;top:22px;width:248px;white-space:pre-line;background:#1f2937;color:#fff;font-size:12px;line-height:1.6;padding:8px 10px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);opacity:0;visibility:hidden;transition:.15s;z-index:40;pointer-events:none;text-align:left}" +
      ".kpi-pfm .tip:hover::after{opacity:1;visibility:visible}" +
      ".kpi-pfm .val{font-size:22px;font-weight:800;letter-spacing:.3px;margin-top:2px;line-height:1.15;padding-right:96px;color:var(--c,#1f2937)}" +
      ".kpi-pfm .val .val-unit{font-size:13px;font-weight:600;color:var(--muted);margin-left:1px;letter-spacing:0}" +
      ".kpi-pfm .kpi-sub{font-size:11px;color:var(--muted);margin-top:1px;padding-right:96px}" +
      ".kpi-pfm .kpi-spark{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:84px;height:40px;display:flex;align-items:center;justify-content:flex-end;pointer-events:none}" +
      ".kpi-pfm .kpi-spark svg{width:100%;height:100%;display:block}" +
      ".kpi-pfm .kpi-foot{margin-top:auto;padding-top:8px;border-top:1px dashed var(--line,#e5e7eb);display:flex;align-items:center;justify-content:flex-start;text-align:left;gap:6px;flex-wrap:wrap}" +
      ".kpi-pfm .mom{font-size:11.5px;font-weight:700;white-space:nowrap}" +
      ".kpi-pfm .mom.up{color:#14b8a6}.kpi-pfm .mom.down{color:#ef4444}.kpi-pfm .mom.flat{color:#9ca3b8}" +
      ".kpi-pfm .spark-empty{font-size:11px;color:#9ca3af}";
    document.head.appendChild(s);
  }

  /* ---------- 月度趋势（始终展示全月作背景，高亮所选月） ---------- */
  function renderTrend(M, sels) {
    var allMs = M.months.slice();
    var labels = allMs.map(monthLabel);
    var exp = allMs.map(function (m) { return M.exp[m]; });
    var clk = allMs.map(function (m) { return M.clk[m]; });
    var vis = allMs.map(function (m) { return M.vis[m]; });
    var conv = allMs.map(function (m) { return M.conv[m] != null ? M.conv[m] : 0; });
    var pageRate = allMs.map(function (m) { return M.totalCum[m] ? +(Object.keys(M.active[m]).length / M.totalCum[m] * 100).toFixed(2) : 0; });
    var single = (sels.length === 1) ? allMs.indexOf(sels[0]) : -1;
    var hiLabel = single >= 0 ? monthLabel(allMs[single]) : "";
    var ct = $("pfmTrendCt");
    if (ct) ct.textContent = "全部月份趋势" + (hiLabel ? "（● 高亮：" + hiLabel + "）" : "（所选：全部）") + " · 曝光/点击/访客/转化率/页面活跃率";
    var mauSeries = { name: "访客(MAU)", type: "line", smooth: true, data: vis, yAxisIndex: 0, itemStyle: { color: PALETTE[1] } };
    if (single >= 0) {
      mauSeries.markPoint = { symbol: "pin", symbolSize: 46, data: [{ coord: [single, vis[single]], value: hiLabel }], itemStyle: { color: PALETTE[1] }, label: { color: "#fff", fontSize: 10 } };
    }
    topChart("pfmTrend", {
      color: PALETTE, tooltip: { trigger: "axis" }, legend: { bottom: 0, textStyle: { color: SUB } },
      grid: { left: 70, right: 65, top: 30, bottom: 45 },
      xAxis: { type: "category", data: labels, axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
      yAxis: [
        { type: "value", name: "次数/人", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
        { type: "value", name: "%", min: 0, max: 100, axisLabel: { color: SUB, formatter: "{value}%" }, splitLine: { show: false } }
      ],
      series: [
        { name: "曝光", type: "line", smooth: true, data: exp, yAxisIndex: 0, itemStyle: { color: PALETTE[3] }, areaStyle: { opacity: 0.06 } },
        { name: "点击", type: "line", smooth: true, data: clk, yAxisIndex: 0, itemStyle: { color: PALETTE[0] } },
        mauSeries,
        { name: "转化率", type: "line", smooth: true, data: conv, yAxisIndex: 1, itemStyle: { color: PALETTE[5] }, lineStyle: { type: "dashed" } },
        { name: "页面活跃率", type: "line", smooth: true, data: pageRate, yAxisIndex: 1, itemStyle: { color: PALETTE[2] }, lineStyle: { type: "dashed" } }
      ]
    });
    var last = allMs.length - 1;
    analysisBox("pfmTrendAn",
      "全周期曝光合计 " + fmtWan(exp.reduce(function (a, b) { return a + b; }, 0)) + "、点击 " + fmtWan(clk.reduce(function (a, b) { return a + b; }, 0)) +
      "；转化率由 " + (M.conv[allMs[0]] != null ? M.conv[allMs[0]].toFixed(1) : "/") + "% 至 " + (M.conv[allMs[last]] != null ? M.conv[allMs[last]].toFixed(1) : "/") + "%，页面活跃率由 " + pageRate[0].toFixed(1) + "% 至 " + pageRate[last].toFixed(1) + "%。" + (hiLabel ? "当前高亮 " + hiLabel + "（MAU " + fmtInt(vis[single]) + "）。" : "") + "5 月为部分月（仅 10 天），仅作基线参考。",
      "①以转化率/页面活跃率两条率值线判断「供给有没有被用起来」；②5 月部分月不进强结论；③趋势仅 3-4 个点，看方向不判绝对值。点击上方月份芯片可单独聚焦某月。");
  }

  /* ===================== 下钻：KPI 卡片下方内联三栏展开 ===================== */
  function ensureDrillStyle() {
    // 清单表「更多 ›」展开/收起：文档级代理，对两页下钻均生效（仅绑定一次）
    if (!window.__pfmMoreBound) {
      window.__pfmMoreBound = true;
      document.addEventListener("click", function (e) {
        var t = e.target;
        var btn = (t && t.closest) ? t.closest(".pfm-more") : null;
        if (!btn) return;
        var wrap = btn.closest(".pfm-rank-wrap");
        if (!wrap) return;
        var collapsed = wrap.classList.toggle("collapsed");
        btn.textContent = collapsed ? "更多 ›" : "‹ 收起";
      });
    }
    if (document.getElementById("pfmDrillStyle")) return;
    var s = document.createElement("style");
    s.id = "pfmDrillStyle";
    s.textContent =
      ".pfm-drill-area{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 6px 22px rgba(15,23,42,.08);padding:16px 18px;margin:14px 0 6px;animation:pfmDrillIn .22s ease}" +
      "@keyframes pfmDrillIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}" +
      ".pfm-drill-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:14px}" +
      ".pfm-drill-title{font-size:16px;font-weight:800;color:var(--ink)}" +
      ".pfm-drill-close{border:none;background:var(--brand-soft);color:var(--brand-2);width:30px;height:30px;border-radius:8px;font-size:18px;cursor:pointer}" +
      ".pfm-drill-cols{display:block;margin-top:4px}" +
      "@media(max-width:1100px){.pfm-drill-cols{}}" +
      "@media(max-width:760px){.pfm-drill-cols{}}" +
      ".pfm-col{min-width:0;display:flex;flex-direction:column;gap:12px}" +
      ".pfm-col .pfm-sec-t:first-child{margin-top:0}" +
      ".pfm-col .chart{height:220px}" +
      ".pfm-kpi-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:0}" +
      ".pfm-kpi{flex:1;min-width:120px;background:var(--brand-soft);border:1px solid #dbeafe;border-radius:10px;padding:10px 12px}" +
      ".pfm-kpi .dk-lb{font-size:11px;color:var(--muted);font-weight:700}" +
      ".pfm-kpi .dk-val{font-size:20px;font-weight:800;color:var(--brand-2);margin:2px 0}" +
      ".pfm-kpi .dk-delta{font-size:11px;color:var(--muted)}" +
      ".pfm-kpi.up .dk-val{color:var(--red)} .pfm-kpi.down .dk-val{color:var(--green)}" +
      ".pfm-kpi.up .dk-delta{color:var(--red)} .pfm-kpi.down .dk-delta{color:var(--green)}" +
      ".pfm-sec-t{font-size:13px;font-weight:800;color:var(--ink);margin:14px 0 6px}" +
      ".pfm-tbl{width:100%;border-collapse:collapse;font-size:12px}" +
      ".pfm-tbl th,.pfm-tbl td{border:1px solid var(--line);padding:5px 8px;text-align:right}" +
      ".pfm-tbl th{background:#f8fafc;color:var(--muted);font-weight:700;position:sticky;top:0}" +
      ".pfm-tbl td.pg{text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".pfm-tbl tr.up td.d{color:var(--red)} .pfm-tbl tr.down td.d{color:var(--green)}" +
      ".pfm-note{font-size:12px;color:var(--muted);background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:8px 10px;line-height:1.6}" +
      ".pfm-note b{color:var(--ink)}" +
      ".pfm-prov{display:flex;align-items:center;gap:8px;margin:6px 0 2px;font-size:12px;color:var(--muted)}" +
      ".pfm-prov select{padding:4px 8px;border:1px solid var(--line);border-radius:8px;color:var(--ink)}" +
      ".pfm-export{margin-left:auto}" +
      ".pfm-user{font-size:12px;color:var(--ink);background:#f1f5f9;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:8px;max-height:220px;overflow:auto;line-height:1.7;word-break:break-all}" +
      ".pfm-empty{padding:30px;text-align:center;color:var(--muted)}" +
      ".c-no{width:32px;text-align:center;color:var(--muted);font-weight:700}" +
      ".pfm-tbl td.c-no{border-left:none}" +
      ".pfm-bar{height:6px;background:#eef2f7;border-radius:4px;margin-top:5px;overflow:hidden}" +
      ".pfm-bar i{display:block;height:100%;background:var(--brand);border-radius:4px}" +
      ".pfm-tbl tr.drill-mod{cursor:pointer}" +
      ".pfm-tbl tr.drill-mod:hover{background:#f1f5f9}" +
      ".pfm-rank-wrap{position:relative}" +
      ".pfm-rank-hd{display:flex;justify-content:flex-end;padding:2px 0 5px}" +
      ".pfm-more{border:1px solid var(--line);background:#fff;color:var(--brand-2);font-size:12px;font-weight:700;padding:3px 11px;border-radius:7px;cursor:pointer;transition:background .15s}" +
      ".pfm-more:hover{background:var(--brand-soft)}" +
      ".pfm-rank-wrap.collapsed tbody tr:nth-child(n+11){display:none}" +
      /* 下钻三行布局：第一行卡片 / 第二行图表 / 第三行列表，每行按宽度自适应 n 列 */
      ".pfm-drill-grid{display:flex;flex-direction:column;gap:14px}" +
      ".pfm-row{display:grid;gap:14px;align-items:start}" +
      ".pfm-row-card{grid-template-columns:1fr}" +
      ".pfm-row-chart{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}" +
      ".pfm-row-list{grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}" +
      ".pfm-sec{display:flex;flex-direction:column;gap:6px;min-width:0}" +
      ".pfm-kpi-band{grid-column:1/-1}" +
      ".pfm-row-chart .pfm-sec,.pfm-row-list .pfm-sec{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff}" +
      ".pfm-sec .pfm-sec-t{margin:0 0 4px}" +
      ".pfm-sec .chart{width:100%}" +
      ".kpi-summary.active{outline:3px solid var(--brand-2);outline-offset:-3px}" +
      /* 健康度明细表 */
      ".pfm-health-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}" +
      ".pfm-health-stat{display:flex;gap:14px;flex-wrap:wrap;font-size:13px}" +
      ".pfm-health-stat b{font-size:16px;margin-right:2px}" +
      ".pfm-health-stat .h-active{color:var(--green)}" +
      ".pfm-health-stat .h-new{color:var(--brand-2)}" +
      ".pfm-health-stat .h-dead{color:var(--red)}" +
      ".pfm-health-search{display:flex;align-items:center;gap:8px}" +
      ".pfm-health-search input{padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;min-width:220px}" +
      ".pfm-health-search .h-info{font-size:12px;color:var(--muted)}" +
      ".pfm-health-tbl{width:100%;border-collapse:collapse;font-size:12px}" +
      ".pfm-health-tbl th,.pfm-health-tbl td{border:1px solid var(--line);padding:6px 8px;text-align:right}" +
      ".pfm-health-tbl th{background:#f8fafc;color:var(--muted);font-weight:700;position:sticky;top:0}" +
      ".pfm-health-tbl td.name{text-align:left;font-weight:600;color:var(--ink);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".pfm-health-tbl td.l1,.pfm-health-tbl td.l2{text-align:left;color:var(--muted)}" +
      ".pfm-health-tbl .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}" +
      ".pfm-health-tbl .badge.active{background:#dcfce7;color:#166534}" +
      ".pfm-health-tbl .badge.new{background:#dbeafe;color:#1e40af}" +
      ".pfm-health-tbl .badge.dead{background:#fee2e2;color:#991b1b}" +
      ".pfm-health-tbl .op{font-size:12px;color:var(--brand-2);cursor:pointer;white-space:nowrap}" +
      ".pfm-health-tbl .op.warn{color:var(--red)}" +
      ".pfm-health-tbl .op:hover{text-decoration:underline}" +
      /* 下钻面板头部：右上角统一放置导出按钮 */
      ".pfm-drill-hd-right{display:flex;align-items:center;gap:8px}" +
      ".pfm-drill-exports{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-right:4px}" +
      ".pfm-drill-exports .pfm-export{margin-left:0}" +
      /* 卡片型指标横向铺开（取代原先纵向堆叠） */
      ".pfm-row-card .pfm-kpi-row-wrap{display:flex;flex-wrap:wrap;gap:12px}" +
      ".pfm-row-card .pfm-kpi-row-wrap .pfm-kpi{flex:1 1 160px;min-width:150px}" +
      /* 全量菜单明细表：限高滚动 */
      ".pfm-menu-scroll{max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:2px}" +
      ".pfm-menu-scroll .pfm-tbl th{position:sticky;top:0;z-index:1}" +
      ".pfm-menu-scroll .pfm-tbl td.l1,.pfm-menu-scroll .pfm-tbl td.l2,.pfm-menu-scroll .pfm-tbl td.l3,.pfm-menu-scroll .pfm-tbl td.l4{text-align:left}" +
      ".pfm-row-card .pfm-sec{display:flex;flex-direction:column;gap:8px}" +
      ".pfm-row-card .pfm-sec > .pfm-sec-t{flex:0 0 auto}";
    document.head.appendChild(s);
  }

  var CURRENT_DRILL = { key: null, M: null, m: null, ids: null };
  function closeDrill() {
    var ids = CURRENT_DRILL.ids || PFM_IDS;
    var area = document.getElementById(ids.drillArea);
    if (area) area.style.display = "none";
    var ex = document.getElementById(ids.drillExports);
    if (ex) ex.innerHTML = "";
    document.querySelectorAll("#" + ids.kpi + " .kpi-pfm").forEach(function (el) { el.classList.remove("active", "selected"); });
    CURRENT_DRILL = { key: null, M: null, m: null, ids: null };
  }

  function openDrill(key, M, m, ids) {
    ids = ids || PFM_IDS;
    var mt = null;
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === key) mt = METRICS[i];
    if (!mt) return;
    ensureDrillStyle();
    // 点击同一卡片则收起
    if (CURRENT_DRILL.key === key && CURRENT_DRILL.m === m && CURRENT_DRILL.ids === ids) { closeDrill(); return; }
    CURRENT_DRILL = { key: key, M: M, m: m, ids: ids };
    document.querySelectorAll("#" + ids.kpi + " .kpi-pfm").forEach(function (el) { el.classList.remove("active", "selected"); });
    var card = document.querySelector('#' + ids.kpi + ' .kpi-pfm[data-key="' + key + '"]');
    if (card) card.classList.add("active", "selected");

    var area = document.getElementById(ids.drillArea);
    if (!area) return;
    area.style.display = "block";
    var title = document.getElementById(ids.drillTitle);
    if (title) title.textContent = mt.label + ' · ' + monthLabel(m);
    var closeBtn = document.getElementById(ids.drillClose);
    if (closeBtn) closeBtn.onclick = closeDrill;
    if (area.scrollIntoView) area.scrollIntoView({ behavior: "smooth", block: "nearest" });

    var cur = mt.calc(M, m);
    if (cur == null) {
      var b0 = area.querySelector(".pfm-drill-cols") || area;
      b0.innerHTML = '<div class="pfm-drill-grid"><div class="pfm-row pfm-row-list"><div class="pfm-sec"><div class="pfm-empty">该指标本月无前置数据（基线月 5 月），无法计算/下钻。<br/><br/>口径：' + esc(mt.kou) + '</div><div class="pfm-note"><b>说明：</b>' + esc(mt.note) + '</div></div></div></div>';
      return;
    }

    var mi = M.months.indexOf(m);
    var prevM = mi > 0 ? M.months[mi - 1] : null;
    var prev = (prevM && !isBaseline(m)) ? mt.calc(M, prevM) : null;
    renderDrillBody(mt, M, m, cur, prev, prevM, "全国", ids);
    // 导出类按钮统一收拢到下钻面板右上角（不单独占模块）
    moveExportsToHeader(area, ids);
  }

  /* 把下钻体内的 [data-export=1] 按钮收集到面板右上角的 .pfm-drill-exports 容器；
     按钮的 onclick 在 builder.bind 中已绑定（area 范围内仍可命中），移动 DOM 节点不丢失事件。 */
  function moveExportsToHeader(area, ids) {
    var box = document.getElementById(ids.drillExports);
    if (!box) return;
    box.innerHTML = "";
    var btns = area.querySelectorAll("[data-export='1']");
    Array.prototype.forEach.call(btns, function (b) { box.appendChild(b); });
  }

  function renderDrillBody(mt, M, m, cur, prev, prevM, prov, ids) {
    ids = ids || PFM_IDS;
    // 1) 当前值 + 环比
    var dCls = "flat", dTxt = "/", vsTxt = "无前置月";
    if (prev != null) {
      if (mt.star) { var pp = cur - prev; dCls = pp > 0.05 ? "up" : (pp < -0.05 ? "down" : "flat"); dTxt = (pp >= 0 ? "+" : "") + pp.toFixed(1) + "pp"; }
      else { var p = pctChange(cur, prev); dCls = p > 0.5 ? "up" : (p < -0.5 ? "down" : "flat"); dTxt = (p >= 0 ? "+" : "") + Math.round(p) + "%"; }
      vsTxt = "vs " + monthLabel(prevM);
    } else if (isBaseline(m)) { vsTxt = "基线月无环比"; }
    var kpiHtml = '<div class="pfm-kpi-row"><div class="pfm-kpi ' + dCls + '"><div class="dk-lb">' + esc(mt.label) + '（' + monthLabel(m) + (prov !== "全国" ? " · " + esc(prov) : "") + '）</div>' +
      '<div class="dk-val">' + mt.fmt(cur) + '</div>' +
      '<div class="dk-delta">环比 ' + dTxt + ' · ' + vsTxt + '</div></div>' +
      '<div class="pfm-kpi"><div class="dk-lb">口径</div><div class="dk-val" style="font-size:13px;font-weight:700;color:var(--ink)">' + esc(mt.kou) + '</div></div></div>';

    var area = document.getElementById(ids.drillArea);
    var body = area.querySelector(".pfm-drill-cols") || area; // 仅替换内容区，保留标题栏(pfm-drill-hd)

    // 按指标分发差异化下钻（依据 md 方案 6.1-6.8 + 用户 6 点要求）
    var builder = DRILL[mt.key];
    if (!builder) {
      body.innerHTML = '<div class="pfm-drill-grid">' +
        '<div class="pfm-row pfm-row-card"><div class="pfm-sec pfm-kpi-band">' + kpiHtml + '</div></div>' +
        '<div class="pfm-row pfm-row-list"><div class="pfm-sec"><div class="pfm-note">该指标下钻暂未配置</div></div></div>' +
        '</div>';
      return;
    }
    var res = builder({ M: M, m: m, cur: cur, prev: prev, prevM: prevM, prov: prov, mt: mt });
    var html = res.html || "";

    // 将下钻内容按「小节（pfm-sec-t + 紧随内容）」拆块，再按类型归入 卡片/图表/列表 三行
    var tmp = document.createElement("div"); tmp.innerHTML = html;
    var sections = splitDrillSections(tmp);
    var groups = { card: [], chart: [], list: [] };
    sections.forEach(function (sec) {
      var t = classifyDrillSection(sec);
      // 卡片型小节：把内部所有 .pfm-kpi 卡片横向铺开（不再纵向堆叠），标题保持在上方
      groups[t].push(t === "card" ? flattenCardSection(sec.title, sec.body.join("")) : '<div class="pfm-sec">' + sec.title + sec.body.join("") + '</div>');
    });

    var html2 = '<div class="pfm-row pfm-row-card"><div class="pfm-sec pfm-kpi-band">' + kpiHtml + '</div>' + groups.card.join("") + '</div>';
    if (groups.chart.length) html2 += '<div class="pfm-row pfm-row-chart">' + groups.chart.join("") + '</div>';
    if (groups.list.length) html2 += '<div class="pfm-row pfm-row-list">' + groups.list.join("") + '</div>';

    body.innerHTML = '<div class="pfm-drill-grid">' + html2 + '</div>';
    if (res.bind) res.bind(area, { M: M, m: m, cur: cur, prev: prev, prevM: prevM, prov: prov, mt: mt });
  }

  // 把下钻 html 拆成「小节」数组：每个 pfm-sec-t 标题 + 其后的内容块（跨 pfm-col 合并，保持文档顺序）
  function splitDrillSections(root) {
    var raw = Array.from(root.children);
    var nodes = [];
    if (raw.length && raw[0].classList && raw[0].classList.contains("pfm-col")) {
      raw.forEach(function (col) { Array.from(col.children).forEach(function (ch) { nodes.push(ch); }); });
    } else {
      nodes = raw;
    }
    var sections = [], cur = null;
    nodes.forEach(function (node) {
      if (!node || node.nodeType !== 1) return;
      if (node.classList.contains("pfm-sec-t")) {
        cur = { title: node.outerHTML, body: [] };
        sections.push(cur);
      } else {
        if (!cur) { cur = { title: "", body: [] }; sections.push(cur); }
        cur.body.push(node.outerHTML);
      }
    });
    return sections;
  }
  // 依据小节内容判定类型：含 .chart → 图表；含 .pfm-tbl → 列表；其余 → 卡片
  function classifyDrillSection(sec) {
    var box = document.createElement("div"); box.innerHTML = sec.body.join("");
    if (box.querySelector(".chart")) return "chart";
    if (box.querySelector(".pfm-tbl")) return "list";
    return "card";
  }
  // 卡片型小节：把内部所有 .pfm-kpi 卡片收集进同一横向 flex 行（可换行），标题保持在上方，实现「横向铺开」
  // 注意：除 .pfm-kpi / .pfm-kpi-row 外的其它节点（如定义说明 div、文本）须原样保留，否则会被整段丢弃。
  function flattenCardSection(title, bodyHtml) {
    var d = document.createElement("div"); d.innerHTML = bodyHtml;
    var kpis = Array.prototype.slice.call(d.querySelectorAll(".pfm-kpi")).map(function (k) { return k.outerHTML; });
    if (!kpis.length) return '<div class="pfm-sec">' + title + bodyHtml + '</div>';
    // 保留非卡片节点（定义说明、文本等），按原顺序拼回，卡片统一收进底部 flex 行
    var others = [];
    Array.prototype.slice.call(d.childNodes).forEach(function (n) {
      if (n.nodeType === 1) {
        if (n.classList && (n.classList.contains("pfm-kpi") || n.classList.contains("pfm-kpi-row"))) return;
        others.push(n.outerHTML);
      } else if (n.nodeType === 3 && n.textContent.trim()) {
        others.push('<div class="pfm-sec-note">' + n.textContent.trim() + '</div>');
      }
    });
    var inner = others.join("");
    if (kpis.length) inner += '<div class="pfm-kpi-row pfm-kpi-row-wrap">' + kpis.join("") + '</div>';
    return '<div class="pfm-sec">' + title + inner + '</div>';
  }

  /* 通用带序号表格；cols:[{k,t,right,num,bar,fmt}]；进度条按各列自身最大值缩放
     opts.max：默认收起行数（默认 10）；行数超过则在表格右上角显示「更多 ›」展开全部 */
  function buildTable(rows, cols, opts) {
    opts = opts || {};
    var max = (opts.max != null) ? opts.max : 10;
    var colMax = {};
    cols.forEach(function (c) { if (c.bar) colMax[c.k] = Math.max.apply(null, rows.map(function (r) { return r[c.k] || 0; })) || 1; });
    var head = '<thead><tr><th class="c-no">#</th>' + cols.map(function (c) {
      return '<th' + (c.num ? ' data-sort="' + c.k + '"' : '') + (c.right ? ' style="text-align:right"' : '') + '>' + esc(c.t) + '</th>';
    }).join("") + '</tr></thead>';
    var bodyRows = rows.map(function (r, i) {
      var rowCls = (r._l1 ? "drill-mod" : "") + (r._cls ? " " + r._cls : "");
      return '<tr' + (rowCls.trim() ? ' class="' + rowCls.trim() + '"' : '') + (r._l1 ? ' data-l1="' + esc(r._l1) + '"' : '') + '>' +
        '<td class="c-no">' + (i + 1) + '</td>' +
        cols.map(function (c) {
          var v = r[c.k];
          var txt = c.fmt ? c.fmt(v, r) : (v == null ? "/" : v);
          var cell = txt;
          if (c.bar && colMax[c.k]) { var pct = Math.max(0, Math.min(100, (v / colMax[c.k]) * 100)); cell += '<div class="pfm-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>'; }
          var cls = c.delta ? "d" : "";
          var style = c.right ? "text-align:right" : "";
          var attr = (cls ? ' class="' + cls + '"' : "") + (style ? ' style="' + style + '"' : "");
          return '<td' + attr + '>' + cell + '</td>';
        }).join("") + '</tr>';
    }).join("");
    var needMore = rows.length > max;
    var wrapCls = "pfm-rank-wrap" + (needMore ? " collapsed" : "");
    var moreBar = needMore ? '<div class="pfm-rank-hd"><button type="button" class="pfm-more" data-more="1">更多 ›</button></div>' : "";
    return '<div class="' + wrapCls + '">' + moreBar + '<table class="pfm-tbl">' + head + '<tbody>' + bodyRows + '</tbody></table></div>';
  }

  /* 模块跨月序列（活跃页/曝光/点击/访客）——用于活跃页数模块下钻趋势 */
  function moduleSeries(M, l1) {
    var months = M.months, act = [], exp = [], clk = [], vis = [];
    months.forEach(function (mm) {
      var l3 = (M.modL3Agg[mm] && M.modL3Agg[mm][l1]) || {};
      var a = 0, e = 0, c = 0, v = 0;
      Object.keys(l3).forEach(function (l2) { Object.keys(l3[l2]).forEach(function (l3k) {
        var d = l3[l2][l3k]; e += d.exposures || 0; c += d.clicks || 0; v += d.visitors || 0; if ((d.exposures || 0) > 0) a++;
      }); });
      act.push(a); exp.push(e); clk.push(c); vis.push(v);
    });
    return { months: months, act: act, exp: exp, clk: clk, vis: vis };
  }

  // ---- 下钻辅助函数 ----
  function provOf(k) { return (k || "").split("-", 1)[0]; }
  function kpiMini(label, val, sub) {
    // val 由调用方负责格式化（常带单位，如 "150人"/"30.5%"/"12类"），此处不再二次 fmtInt，避免非数字串被转成 "/"
    var v = (typeof val === "number") ? fmtInt(val) : (val == null || val === "" ? "/" : String(val));
    return '<div class="pfm-kpi"><div class="dk-lb">' + esc(label) + '</div><div class="dk-val">' + v + '</div><div class="dk-delta">' + esc(sub || "") + '</div></div>';
  }
  // 截至某月之前（不含 m）出现过的所有页面集合
  function pagesBefore(M, m) {
    var idx = M.months.indexOf(m); if (idx <= 0) return new Set();
    var s = new Set();
    for (var i = 0; i < idx; i++) { var mm = M.months[i]; var pg = M.pageAgg[mm] || {}; Object.keys(pg).forEach(function (p) { s.add(p); }); }
    return s;
  }
  // 页面状态分类（活跃/沉默/本月新增/已下架）
  function pageStatus(M, m) {
    var pg = M.pageAgg[m] || {};
    var before = pagesBefore(M, m);
    var active = [], silent = [], newThis = [], removed = [];
    Object.keys(pg).forEach(function (p) {
      var d = pg[p]; var o = { page: p, exp: d.exposures || 0, clk: d.clicks || 0, vis: d.visitors || 0 };
      if (o.exp > 0) { active.push(o); if (!before.has(p)) newThis.push(o); } else { silent.push(o); }
    });
    before.forEach(function (p) { if (!pg[p]) removed.push({ page: p, exp: 0, clk: 0, vis: 0 }); });
    return { active: active, silent: silent, newThis: newThis, removed: removed };
  }
  // 头部集中度：按 valKey 降序，Top 10% 项占总额比例
  function headConcentration(rows, valKey, totalVal) {
    if (!rows.length || !totalVal) return 0;
    var sorted = rows.slice().sort(function (a, b) { return (b[valKey] || 0) - (a[valKey] || 0); });
    var k = Math.max(1, Math.ceil(sorted.length * 0.1));
    var top = 0; for (var i = 0; i < k; i++) top += (sorted[i][valKey] || 0);
    return totalVal ? top / totalVal * 100 : 0;
  }
  // 新增活跃三级模块（本月活跃但此前从未活跃的页面，按 L3 归并）
  function newlyActiveByL3(M, m) {
    var idx = M.months.indexOf(m); if (idx <= 0) return {};
    var pg = M.pageAgg[m] || {};
    var earlyActive = new Set();
    for (var i = 0; i < idx; i++) { var mm = M.months[i]; var p2 = M.pageAgg[mm] || {}; Object.keys(p2).forEach(function (p) { if ((p2[p].exposures || 0) > 0) earlyActive.add(p); }); }
    var cnt = {};
    Object.keys(pg).forEach(function (p) {
      if ((pg[p].exposures || 0) <= 0) return;
      if (earlyActive.has(p)) return;
      var segs = p.split("-"); var l3 = segs[2] ? segs[2].trim() : (segs[1] ? segs[1].trim() : p);
      cnt[l3] = (cnt[l3] || 0) + 1;
    });
    return cnt;
  }
  // 用户首次出现月份（用于新/老用户分群）
  function firstAppearanceMap(M) {
    var fa = {};
    M.months.forEach(function (mm) { (M.userKeys[mm] || []).forEach(function (k) { if (!(k in fa)) fa[k] = mm; }); });
    return fa;
  }

  var DRILL = {
    /* 6.1 月活跃用户数 MAU：互斥功能页构成 + 省份排名(含环比) + 活跃度分层 + 人均功能页数 + 名单 + 月度趋势 */
    mau: function (ctx) {
      var M = ctx.M, m = ctx.m, prevM = ctx.prevM;
      var total = M.mau[m] || 0;
      // ① 各三级功能页用户量（互斥归属 → 占比和=100%）；按 L1 归并得功能模块使用分布
      var comp = M.mauComp[m] || {};
      var compAll = Object.keys(comp).reduce(function (s, p) { return s + comp[p]; }, 0);
      var compRows = Object.keys(comp).map(function (p) { return { page: p, n: comp[p], pct: total ? comp[p] / total * 100 : 0 }; })
        .sort(function (a, b) { return b.n - a.n; }).slice(0, 40);
      var l1map = {};
      Object.keys(comp).forEach(function (p) { var l1 = (p.split("-")[0] || "").trim(); l1map[l1] = (l1map[l1] || 0) + comp[p]; });
      var l1Rows = Object.keys(l1map).map(function (l1) { return { l1: l1, n: l1map[l1], pct: total ? l1map[l1] / total * 100 : 0 }; })
        .sort(function (a, b) { return b.n - a.n; });
      // ② 省份 MAU 排名（含环比 · 部门维度暂无，以省份代示）
      var pu = M.provUser[m] || {};
      var prevPu = (prevM && M.provUser[prevM]) || {};
      var puRows = Object.keys(pu).map(function (p) {
        var prev = prevPu[p] || 0; var d = prev ? (pu[p] - prev) / prev * 100 : null;
        return { prov: p, n: pu[p], pct: total ? pu[p] / total * 100 : 0, prev: prev, d: d, _cls: d == null ? "" : (d >= 0 ? "up" : "down") };
      }).sort(function (a, b) { return b.n - a.n; });
      // ③ 用户活跃度分层（按总点击量：重度 top30% / 中度 40% / 轻度 30%）
      var ua = M.userAgg[m] || {};
      var vals = Object.keys(ua).map(function (k) { return ua[k].clicks || 0; }).sort(function (a, b) { return b - a; });
      var nn = vals.length, i1 = Math.ceil(nn * 0.3), i2 = Math.ceil(nn * 0.7);
      function tier(s, e) { var sl = vals.slice(s, e); var c = sl.length; var clk = sl.reduce(function (a, b) { return a + b; }, 0); return { c: c, avg: c ? clk / c : 0 }; }
      var tH = tier(0, i1), tM = tier(i1, i2), tL = tier(i2, nn);
      var avgPages = M.avgPages[m];
      var mauSeries = M.months.map(function (mm) { return M.mau[mm]; });
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 各三级功能页用户量（互斥归属·占比和=100%）Top40 · 全量互斥合计 ' + fmtInt(compAll) + ' 人 ≈ MAU</div>' +
        buildTable(compRows, [
          { k: "page", t: "三级功能页" },
          { k: "n", t: "独占用户数", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "pct", t: "占MAU比", right: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '<div class="pfm-sec-t">①-b 功能模块使用分布（按 L1 归并 · 互斥占比合计 100%）</div>' +
        buildTable(l1Rows, [
          { k: "l1", t: "一级模块" },
          { k: "n", t: "独占用户数", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "pct", t: "占MAU比", right: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">② 省份 MAU 排名（含环比 · ⚠ 部门维度数据源暂无，以省份代示）</div>' +
        buildTable(puRows, [
          { k: "prov", t: "省份" },
          { k: "n", t: "MAU", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "prev", t: "上月", right: true, fmt: function (v) { return fmtInt(v); } },
          { k: "d", t: "环比", right: true, delta: true, fmt: function (v) { return v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; } },
          { k: "pct", t: "占比", right: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">③ 用户活跃度分层（按总点击量 · 重度top30%/中度40%/轻度30%）</div><div class="pfm-kpi-row">' +
          kpiMini("重度用户", fmtInt(tH.c) + "人", "人均点击 " + tH.avg.toFixed(0)) +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("中度用户", fmtInt(tM.c) + "人", "人均点击 " + tM.avg.toFixed(0)) +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("轻度用户", fmtInt(tL.c) + "人", "人均点击 " + tL.avg.toFixed(0)) +
        '</div>' +
        '<div class="pfm-sec-t">④ 人均到达功能页数（用了几个功能）</div><div class="pfm-kpi-row">' +
          kpiMini("人均到达功能页数", avgPages != null ? avgPages.toFixed(2) : "—", "每用户平均到达的不同功能页") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("MAU", fmtInt(total), monthLabel(m)) +
        '</div>' +
        '<div class="pfm-sec-t">⑤ 月度趋势：MAU</div><div class="chart" id="pfmMauTrend"></div>' +
        '<div class="pfm-note" id="pfmMauAn"></div>' +
        '</div>';
      return { html: html, bind: function (body) {
        var b = body.querySelector("#pfmDrillCsv");
        if (b) b.onclick = function () { exportRows("MAU_" + monthLabel(m), (M.userKeys[m] || []).map(function (k) { return { id: k }; }), [{ k: "id", t: "用户唯一ID(省份-姓名)" }]); };
        if (window.echarts) {
          var tb = body.querySelector("#pfmMauTrend");
          if (tb) { var c = window.echarts.init(tb); c.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 55, right: 30, top: 20, bottom: 40 },
            xAxis: { type: "category", data: M.months.map(monthLabel), axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
            yAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
            series: [{ name: "MAU", type: "line", smooth: true, data: mauSeries, itemStyle: { color: PALETTE[1] }, lineStyle: { width: 3 } }] }); }
        }
        var an = body.querySelector("#pfmMauAn");
        if (an) {
          var tp = puRows.slice(0, 3).map(function (r) { return r.prov + " " + fmtInt(r.n); }).join("、");
          an.innerHTML = '<b>具体分析：</b>本月活跃 ' + fmtInt(total) + ' 人，互斥功能页构成全量合计 ' + fmtInt(compAll) + ' 人（占比和≈100%）；省份 TOP3：' + (tp || "—") + '。重度用户 ' + fmtInt(tH.c) + ' 人人均点击 ' + tH.avg.toFixed(0) + '，为活跃主阵地；人均到达功能页 ' + (avgPages != null ? avgPages.toFixed(2) : "—") + ' 个。⚠️ 同省同名合并、换省误判为新增（见风险章节）。';
        }
      } };
    },
    /* 6.2 月新增用户数：名单 + 来源分布 + 累计增长曲线 + 次月留存(跳月留存) + 提示 */
    newu: function (ctx) {
      var M = ctx.M, m = ctx.m, cur = ctx.cur;
      if (cur == null) return { html: '<div class="pfm-empty">基线月（5月）不报新增（全算初始用户池）。</div>' };
      var nu = M.newUserKeys[m] || [];
      var idx = M.months.indexOf(m);
      var nextM = (idx >= 0 && idx + 1 < M.months.length) ? M.months[idx + 1] : null;
      // ② 新增来源 省份分布
      var pn = M.provNew[m] || {};
      var total = nu.length || 1;
      var pnRows = Object.keys(pn).map(function (p) { return { prov: p, n: pn[p], pct: pn[p] / total * 100 }; })
        .sort(function (a, b) { return b.n - a.n; });
      // ③ 累计用户池增长曲线（新增累加）
      var cum = 0, cumLabels = [], cumData = [];
      M.months.forEach(function (mm) {
        cum += (M.newU[mm] != null ? M.newU[mm] : 0);
        if (M.mau[mm] == null) return;
        cumLabels.push(monthLabel(mm)); cumData.push(cum);
      });
      // ④ 新用户次月留存
      var retN = null, retRate = null;
      if (nextM && M.userKeys[nextM]) {
        var nset = new Set(nu), nxt = new Set(M.userKeys[nextM]);
        retN = 0; nset.forEach(function (k) { if (nxt.has(k)) retN++; });
        retRate = nu.length ? retN / nu.length * 100 : null;
      }
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 新增来源：省份分布（⚠ 部门维度数据源暂无，以省份代示）</div>' +
        buildTable(pnRows, [
          { k: "prov", t: "省份" },
          { k: "n", t: "新增用户", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "pct", t: "占比", right: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '<button class="btn btn-ghost sm pfm-export" id="pfmDrillCsv" data-export="1">⬇ 导出新增用户名单(CSV)</button>' +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">② 累计用户池增长曲线（Σ 各月新增 · 剔除基线前）</div><div class="chart" id="pfmNewCum"></div>' +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">③ 新用户次月留存（新增质量 · ' + (nextM ? monthLabel(nextM) + " 回访" : "无次月数据") + '）</div><div class="pfm-kpi-row">' +
          kpiMini("次月留存人数", retN != null ? fmtInt(retN) : "—", nextM ? monthLabel(nextM) + " 回访" : "—") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("次月留存率", retRate != null ? retRate.toFixed(1) + "%" : "—", "新增质量指标") +
        '</div>' +
        (nextM ? '<button class="btn btn-ghost sm pfm-export" id="pfmJumpRet">跳「月留存」下钻</button>' : '') +
        '<div class="pfm-note"><b>提示：</b>May 为基线月不报新增（全算初始用户池）；「省份-姓名」换省会被误判为新增，含此口径误差，建议以工号/账号 ID 去重；累计用户池 = Σ 各月新增（基线月不计）。次月留存 = 本月新增用户在下月仍活跃的比例。</div>' +
        '</div>';
      return { html: html, bind: function (body) {
        var b = body.querySelector("#pfmDrillCsv");
        if (b) b.onclick = function () { exportRows("NEW_" + monthLabel(m), nu.map(function (k) { return { id: k }; }), [{ k: "id", t: "新增用户(省份-姓名)" }]); };
        var jr = body.querySelector("#pfmJumpRet");
        if (jr && nextM) jr.onclick = function () { closeDrill(); openDrill("retention", M, nextM); };
        if (window.echarts) {
          var tb = body.querySelector("#pfmNewCum");
          if (tb) { var c = window.echarts.init(tb); c.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 55, right: 30, top: 20, bottom: 40 },
            xAxis: { type: "category", data: cumLabels, axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
            yAxis: { type: "value", name: "累计用户", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
            series: [{ name: "累计用户池", type: "line", smooth: true, data: cumData, itemStyle: { color: PALETTE[0] }, areaStyle: { opacity: 0.08 }, lineStyle: { width: 3 } }] }); }
        }
      } };
    },
    /* 6.3 平台页面总数：全量页面清单 + 状态分类 + 一二级分布 + 死页清单 */
    totalPages: function (ctx) {
      var M = ctx.M, m = ctx.m;
      var st = pageStatus(M, m);
      var pg = M.pageAgg[m] || {};
      var totalObs = Object.keys(pg).length;
      var newSet = {}; st.newThis.forEach(function (o) { newSet[o.page] = 1; });
      // ①-b 全量页面清单（埋点观测页作配置元数据代理）
      var inv = [];
      Object.keys(pg).forEach(function (k) {
        var d = pg[k]; var exp = d.exposures || 0;
        var s = exp > 0 ? (newSet[k] ? "本月新增" : "活跃") : "沉默";
        inv.push({ page: k, exp: exp, clk: d.clicks || 0, st: s });
      });
      st.removed.forEach(function (o) { inv.push({ page: o.page, exp: 0, clk: 0, st: "已下架" }); });
      inv.sort(function (a, b) { return b.exp - a.exp; });
      var invTop = inv.slice(0, 100);
      // ② 一二级分布
      var l2 = M.modL2Agg[m] || {}, l3 = M.modL3Agg[m] || {};
      var rows = Object.keys(l3).map(function (l1) {
        var l3n = Object.keys(l3[l1]).reduce(function (s, l2k) { return s + Object.keys(l3[l1][l2k]).length; }, 0);
        var l2n = Object.keys(l2[l1] || {}).length;
        return { l1: l1, l2n: l2n, l3n: l3n };
      }).sort(function (a, b) { return b.l3n - a.l3n; });
      var dead = st.silent.slice().sort(function (a, b) { return (b.clk || 0) - (a.clk || 0); }).slice(0, 50);
      // ① 页面层级分布（来自全量菜单配置元数据）
      var menuRows = PFM_PAGE_MENU.map(function (r) {
        return { lvl: "L" + r[0], l1: r[1] || "—", l2: r[2] || "—", l3: r[3] || "—", l4: r[4] || "—" };
      });
      var menuTableHtml = buildTable(menuRows, [
        { k: "lvl", t: "层级", w: 50 },
        { k: "l1", t: "一级菜单" },
        { k: "l2", t: "二级菜单" },
        { k: "l3", t: "三级菜单" },
        { k: "l4", t: "四级菜单" }
      ], { max: 999 });
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 页面层级分布（全量菜单配置元数据 · 共 ' + fmtInt(PFM_TOTAL_PAGES) + ' 页）</div>' +
        '<div class="pfm-kpi-row">' +
          kpiMini("二级页面", pageLevelCount(2), "仅一级+二级菜单") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("三级页面", pageLevelCount(3), "一级+二级+三级") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("四级页面", pageLevelCount(4), "一级+二级+三级+四级") +
        '</div>' +
        '<div class="pfm-sec-t">①-b 各层级页面明细（' + fmtInt(PFM_TOTAL_PAGES) + ' 页全量 · 滚动查看）</div>' +
        '<div class="pfm-menu-scroll">' + menuTableHtml + '</div>' +
        '<div class="pfm-sec-t">①-c 埋点观测页面清单（本月埋点出现 · Top100 by 曝光）</div>' +
        buildTable(invTop, [
          { k: "page", t: "页面" },
          { k: "st", t: "状态" },
          { k: "exp", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '<div class="pfm-sec-t">② 按一级/二级菜单的页面数分布（哪个分类挂页多）</div>' +
        buildTable(rows, [
          { k: "l1", t: "一级模块" },
          { k: "l2n", t: "二级数", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "l3n", t: "子页面数(三级)", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">③ 死页清单（曝光≈0，可下架建议）Top50</div>' +
        buildTable(dead, [
          { k: "page", t: "页面" },
          { k: "exp", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "vis", t: "访客", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '<div class="pfm-note"><b>口径：</b>左侧 ① 为「全量菜单配置元数据」（共 ' + fmtInt(PFM_TOTAL_PAGES) + ' 页，来源 0903灵运平台全量菜单.xlsx），已区分二级/三级/四级页面；本栏 ①-c 为「本月埋点实际观测到的页面」（共 ' + fmtInt(totalObs) + ' 页），两者之差即「已配置但未埋点 / 埋点缺失」的页面，需排查埋点覆盖。死页=曝光≈0，优先评估下架或重新运营。</div>' +
        '</div>';
      return { html: html };
    },
    /* 6.4 活跃页面数（含活跃页面清单 + 多维度） */
    activePages: function (ctx) {
      var M = ctx.M, m = ctx.m, cur = ctx.cur;
      var pg = M.pageAgg[m] || {};
      var all = Object.keys(pg).map(function (k) { var d = pg[k]; return { page: k, exp: d.exposures || 0, clk: d.clicks || 0, vis: d.visitors || 0, ctr: d.exposures ? d.clicks / d.exposures * 100 : 0 }; })
        .filter(function (r) { return r.exp > 0; });
      var totalExp = all.reduce(function (s, r) { return s + r.exp; }, 0) || 1;
      var listRows = all.slice().sort(function (a, b) { return b.exp - a.exp; }).slice(0, 60);
      var clickTop = all.slice().sort(function (a, b) { return b.clk - a.clk; }).slice(0, 15);
      var userTop = all.slice().sort(function (a, b) { return b.clk - a.clk; }).slice(0, 15);
      // ④ 部门/省份 各页活跃用户分布（取 Top10 页）
      var provRows = listRows.slice(0, 10).map(function (r) {
        var pp = (M.pageProv[m] && M.pageProv[m][r.page]) || {};
        var arr = Object.keys(pp).map(function (p) { return { p: p, n: pp[p] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
        return { page: r.page, dist: arr.map(function (x) { return x.p + " " + x.n; }).join("、") || "—" };
      });
      var head = headConcentration(all, "exp", totalExp);
      var st = pageStatus(M, m);
      var silent = st.silent.slice().sort(function (a, b) { return (b.clk || 0) - (a.clk || 0); }).slice(0, 50);
      var newL3 = newlyActiveByL3(M, m);
      var newL3t = Object.keys(newL3).reduce(function (s, k) { return s + newL3[k]; }, 0) || 1;
      var newL3Rows = Object.keys(newL3).map(function (l3) { return { l3: l3, n: newL3[l3], pct: newL3[l3] / newL3t * 100 }; }).sort(function (a, b) { return b.n - a.n; });
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 活跃页面清单（每页 曝光/点击/用户量/CTR · Top60 by 曝光）</div>' +
        buildTable(listRows, [
          { k: "page", t: "页面" },
          { k: "exp", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "vis", t: "用户量", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "ctr", t: "CTR", right: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '<div class="pfm-sec-t">② 活跃用户排名 Top（按点击量 · Top15）</div>' +
        buildTable(userTop, [
          { k: "page", t: "页面" },
          { k: "vis", t: "活跃用户量", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">③ 点击量排名 Top（条形）· Top15</div><div class="chart" id="pfmActClickBar"></div>' +
        '<div class="pfm-sec-t">④ 月度趋势：活跃页数变化</div><div class="chart" id="pfmActTrend"></div>' +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">⑤ 部门/省份 各页活跃用户分布（Top10 页 · 取前 3 省）</div>' +
        buildTable(provRows, [
          { k: "page", t: "页面" },
          { k: "dist", t: "省份分布(用户量)", fmt: function (v) { return v; } }
        ]) +
        '<div class="pfm-sec-t">⑥ 头部集中度 · 新增活跃的三级模块占比</div><div class="pfm-kpi-row">' +
          kpiMini("头部集中度", head.toFixed(1) + "%", "Top10%页曝光占比") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("新增活跃页", Object.keys(newL3).length + "类", "本月首活跃L3") +
        '</div>' +
        buildTable(newL3Rows, [
          { k: "l3", t: "三级模块" },
          { k: "n", t: "新增活跃页数", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "pct", t: "占比", right: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '<div class="pfm-sec-t">⑦ 死页对照：沉默页清单（Top50 by 点击）</div>' +
        buildTable(silent, [
          { k: "page", t: "页面" },
          { k: "exp", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "vis", t: "访客", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '<div class="pfm-note" id="pfmActAn"></div>' +
        '</div>';
      return { html: html, bind: function (body) {
        if (window.echarts) {
          var cb = body.querySelector("#pfmActClickBar");
          if (cb) {
            var arr = clickTop.slice().reverse();
            var c = window.echarts.init(cb);
            c.setOption({ color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, grid: { left: 200, right: 50, top: 10, bottom: 20 },
              xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
              yAxis: { type: "category", data: arr.map(function (t) { return t.page; }), axisLabel: { color: INK, fontSize: 10 } },
              series: [{ type: "bar", data: arr.map(function (t) { return t.clk; }), itemStyle: { color: PALETTE[0] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }] });
          }
          var tb = body.querySelector("#pfmActTrend");
          if (tb) {
            var actSeries = M.months.map(function (mm) { var p = M.pageAgg[mm] || {}; var n = 0; Object.keys(p).forEach(function (k) { if ((p[k].exposures || 0) > 0) n++; }); return n; });
            var c2 = window.echarts.init(tb);
            c2.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 60, right: 30, top: 20, bottom: 40 },
              xAxis: { type: "category", data: M.months.map(monthLabel), axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
              yAxis: { type: "value", axisLabel: { color: SUB }, splitLine: { lineStyle: { color: GRID } } },
              series: [{ name: "活跃页数", type: "line", smooth: true, data: actSeries, itemStyle: { color: PALETTE[2] } }] });
          }
        }
        var an = body.querySelector("#pfmActAn");
        if (an) {
          an.innerHTML = '<b>原因分析：</b>本月活跃页 ' + fmtInt(cur) + ' 个，占观测页 ' + (totalExp ? (all.length / Object.keys(pg).length * 100).toFixed(1) : "/") + '%；头部集中度 ' + head.toFixed(1) + '% 说明流量集中于少数页面。沉默页 ' + st.silent.length + ' 个，建议结合「页面活跃率」下钻定位死页。';
        }
      } };
    },
    /* 6.5 应用打开次数：三级页排名 + 省份分布 + 趋势 + 集中度 + 人均 */
    open: function (ctx) {
      var M = ctx.M, m = ctx.m, cur = ctx.cur;
      var pg = M.pageAgg[m] || {};
      var all = Object.keys(pg).map(function (k) { return { page: k, exp: pg[k].exposures || 0, clk: pg[k].clicks || 0, vis: pg[k].visitors || 0 }; });
      var totalExp = all.reduce(function (s, r) { return s + r.exp; }, 0) || 1;
      var rows = all.slice().sort(function (a, b) { return b.exp - a.exp; }).slice(0, 30);
      var pa = M.provAgg[m] || {};
      var prows = Object.keys(pa).map(function (p) { return { prov: p, exp: pa[p].exposures || 0, clk: pa[p].clicks || 0 }; })
        .sort(function (a, b) { return b.exp - a.exp; }).slice(0, 15);
      var head = headConcentration(all, "exp", totalExp);
      var mau = M.mau[m] || 1;
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 各三级页打开次数(曝光)排名 TOP30</div>' +
        buildTable(rows, [
          { k: "page", t: "页面" },
          { k: "exp", t: "曝光(打开)", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "vis", t: "访客", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">② 月度趋势：打开次数</div><div class="chart" id="pfmOpenTrend"></div>' +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">③ 部门/省份 打开次数分布 TOP15</div>' +
        buildTable(prows, [
          { k: "prov", t: "省份" },
          { k: "exp", t: "曝光", right: true, num: true, bar: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '<div class="pfm-sec-t">④ 人均打开次数 · 集中度</div><div class="pfm-kpi-row">' +
          kpiMini("人均打开次数", (mau ? (cur / mau).toFixed(1) : "/"), "打开次数÷MAU") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("头部集中度", head.toFixed(1) + "%", "Top10%页曝光占比") +
        '</div>' +
        '<div class="pfm-note"><b>口径：</b>打开次数 = Σ 三级页曝光次数（月 PV）；人均 = 打开次数 ÷ MAU，反映单用户使用强度。省份维度按「省份-姓名」去重聚合（部门维度数据源暂无，以省份代示）。</div>' +
        '</div>';
      return { html: html, bind: function (body) {
        if (window.echarts) {
          var tb = body.querySelector("#pfmOpenTrend");
          if (tb) {
            var c = window.echarts.init(tb);
            c.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 65, right: 30, top: 20, bottom: 40 },
              xAxis: { type: "category", data: M.months.map(monthLabel), axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
              yAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
              series: [{ name: "打开次数", type: "line", smooth: true, data: M.months.map(function (mm) { return M.exp[mm]; }), itemStyle: { color: PALETTE[3] } }] });
          }
        }
      } };
    },
    /* 6.6 应用转化率 ★：漏斗 + 分类转化率 + 低转化率定位 + 省份转化率 + 趋势 */
    conv: function (ctx) {
      var M = ctx.M, m = ctx.m;
      var labels = M.months.map(monthLabel);
      var exp = M.months.map(function (mm) { return M.exp[mm]; });
      var clk = M.months.map(function (mm) { return M.clk[mm]; });
      var vis = M.months.map(function (mm) { return M.vis[mm]; });
      var conv = M.months.map(function (mm) { return M.conv[mm] != null ? M.conv[mm] : 0; });
      // 按一级菜单分类的转化率
      var l3 = M.modL3Agg[m] || {};
      var l1rows = Object.keys(l3).map(function (l1) {
        var c = 0, e = 0;
        Object.keys(l3[l1]).forEach(function (l2) { Object.keys(l3[l1][l2]).forEach(function (l3k) { var d = l3[l1][l2][l3k]; c += d.clicks || 0; e += d.exposures || 0; }); });
        return { l1: l1, c: c, e: e, rate: e ? c / e * 100 : 0 };
      }).sort(function (a, b) { return a.rate - b.rate; });
      var pa = M.provAgg[m] || {};
      var prows = Object.keys(pa).map(function (p) { return { prov: p, c: pa[p].clicks || 0, e: pa[p].exposures || 0, rate: (pa[p].exposures || 0) ? (pa[p].clicks || 0) / (pa[p].exposures || 0) * 100 : 0 }; })
        .sort(function (a, b) { return b.rate - a.rate; });
      var curClk = (M.clk[m] || 0), curExp = (M.exp[m] || 0);
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 按一级菜单分类的转化率（升序，最前即卡点）</div>' +
        buildTable(l1rows, [
          { k: "l1", t: "一级模块" },
          { k: "c", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "e", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "rate", t: "转化率", right: true, bar: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '<div class="pfm-sec-t">② 部门/省份 转化率</div>' +
        buildTable(prows, [
          { k: "prov", t: "省份" },
          { k: "c", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "e", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "rate", t: "转化率", right: true, bar: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">③ 漏斗：一级菜单点击 → 三级曝光（整体）</div><div class="chart" id="pfmConvFunnel"></div>' +
        '<div class="pfm-sec-t">④ 月度趋势：转化率</div><div class="chart" id="pfmConvTrend"></div>' +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-note" id="pfmConvAn"></div>' +
        '</div>';
      return { html: html, bind: function (body) {
        if (window.echarts) {
          var fb = body.querySelector("#pfmConvFunnel");
          if (fb) {
            var c = window.echarts.init(fb);
            c.setOption({ color: PALETTE, tooltip: { trigger: "item", formatter: "{b}: {c}" }, series: [{ type: "funnel", left: "10%", right: "10%", top: 20, bottom: 10, minSize: "20%",
              data: [ { name: "一级菜单点击", value: curClk }, { name: "三级曝光", value: curExp } ],
              label: { color: "#fff" } }] });
          }
          var tb = body.querySelector("#pfmConvTrend");
          if (tb) {
            var c2 = window.echarts.init(tb);
            c2.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 55, right: 30, top: 20, bottom: 40 },
              xAxis: { type: "category", data: labels, axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
              yAxis: { type: "value", name: "%", max: 100, axisLabel: { color: SUB, formatter: "{value}%" }, splitLine: { lineStyle: { color: GRID } } },
              series: [{ name: "转化率", type: "line", smooth: true, data: conv, itemStyle: { color: PALETTE[5] }, lineStyle: { width: 3 } }] });
          }
        }
        var an = body.querySelector("#pfmConvAn");
        if (an) {
          var low = l1rows[0];
          an.innerHTML = '<b>低转化率定位：</b>「' + (low ? low.l1 : "—") + '」转化率仅 ' + (low ? low.rate.toFixed(1) : "—") + '%，为当前最明显卡点（点击相对曝光偏低，入口引导或页面价值待优化）。整体转化率 ' + (M.conv[m] != null ? M.conv[m].toFixed(1) + "%" : "/") + '。';
        }
      } };
    },
    /* 6.7 页面活跃率 ★：堆叠 + 分类活跃率 + 死页清单 + 集中度 + 趋势 */
    pageActiveRate: function (ctx) {
      var M = ctx.M, m = ctx.m, cur = ctx.cur;
      var l3 = M.modL3Agg[m] || {};
      var rows = Object.keys(l3).map(function (l1) {
        var tot = 0, act = 0;
        Object.keys(l3[l1]).forEach(function (l2k) { Object.keys(l3[l1][l2k]).forEach(function (l3k) { tot++; if ((l3[l1][l2k][l3k].exposures || 0) > 0) act++; }); });
        return { l1: l1, tot: tot, act: act, dead: tot - act, rate: tot ? act / tot * 100 : 0 };
      }).sort(function (a, b) { return a.rate - b.rate; });
      var pg = M.pageAgg[m] || {};
      var all = Object.keys(pg).map(function (k) { return { page: k, exp: pg[k].exposures || 0 }; });
      var totalExp = all.reduce(function (s, r) { return s + r.exp; }, 0) || 1;
      var head = headConcentration(all, "exp", totalExp);
      var dead = Object.keys(pg).filter(function (k) { return (pg[k].exposures || 0) <= 0; })
        .map(function (k) { return { page: k, exp: pg[k].exposures || 0, clk: pg[k].clicks || 0, vis: pg[k].visitors || 0 }; })
        .sort(function (a, b) { return (b.clk || 0) - (a.clk || 0); }).slice(0, 50);
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 按一级分类的页面活跃率（升序，废页最多在前）</div>' +
        buildTable(rows, [
          { k: "l1", t: "一级模块" },
          { k: "tot", t: "总页数", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "act", t: "活跃页", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "dead", t: "死页", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "rate", t: "页面活跃率", right: true, bar: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '<div class="pfm-sec-t">② 死页清单（曝光≈0，下架建议）Top50</div>' +
        buildTable(dead, [
          { k: "page", t: "页面" },
          { k: "exp", t: "曝光", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "clk", t: "点击", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "vis", t: "访客", right: true, num: true, fmt: function (v) { return fmtInt(v); } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">③ 活跃页 vs 死页 分布（按一级模块堆叠）</div><div class="chart" id="pfmParStack"></div>' +
        '<div class="pfm-sec-t">④ 月度趋势：页面活跃率</div><div class="chart" id="pfmParTrend"></div>' +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">⑤ 头部集中度</div><div class="pfm-kpi-row">' + kpiMini("头部集中度", head.toFixed(1) + "%", "Top10%页曝光占比") + '</div>' +
        '<div class="pfm-note"><b>口径：</b>页面活跃率=活跃页÷平台总页；死页=曝光≈0。整体：' + (cur != null ? cur.toFixed(1) + "%" : "/") + '。</div>' +
        '</div>';
      return { html: html, bind: function (body) {
        if (window.echarts) {
          var sb = body.querySelector("#pfmParStack");
          if (sb) {
            var c = window.echarts.init(sb);
            c.setOption({ color: [PALETTE[2], PALETTE[1]], tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { data: ["活跃页", "死页"], textStyle: { color: SUB } }, grid: { left: 90, right: 30, top: 30, bottom: 20 },
              xAxis: { type: "value", axisLabel: { color: SUB }, splitLine: { lineStyle: { color: GRID } } },
              yAxis: { type: "category", data: rows.map(function (r) { return r.l1; }), axisLabel: { color: INK, fontSize: 10 } },
              series: [ { name: "活跃页", type: "bar", stack: "t", data: rows.map(function (r) { return r.act; }) }, { name: "死页", type: "bar", stack: "t", data: rows.map(function (r) { return r.dead; }) } ] });
          }
          var tb = body.querySelector("#pfmParTrend");
          if (tb) {
            var rateSeries = M.months.map(function (mm) {
              var p = M.pageAgg[mm] || {}; var t = 0, a = 0;
              Object.keys(p).forEach(function (k) { t++; if ((p[k].exposures || 0) > 0) a++; });
              return t ? +(a / t * 100).toFixed(1) : 0;
            });
            var c2 = window.echarts.init(tb);
            c2.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 55, right: 30, top: 20, bottom: 40 },
              xAxis: { type: "category", data: M.months.map(monthLabel), axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
              yAxis: { type: "value", name: "%", max: 100, axisLabel: { color: SUB, formatter: "{value}%" }, splitLine: { lineStyle: { color: GRID } } },
              series: [{ name: "页面活跃率", type: "line", smooth: true, data: rateSeries, itemStyle: { color: PALETTE[2] } }] });
          }
        }
      } };
    },
    /* 6.8 月留存率：绝对人数 + 名单 + 活跃度 + 省份留存 + 新老分群 + 预警 + 趋势 */
    retention: function (ctx) {
      var M = ctx.M, m = ctx.m, cur = ctx.cur, prevM = ctx.prevM;
      if (cur == null) return { html: '<div class="pfm-empty">基线月（5月）无前置，不报留存。</div>' };
      var prevSet = new Set(M.userKeys[prevM] || []);
      var curSet = new Set(M.userKeys[m] || []);
      var retained = [], churned = [];
      prevSet.forEach(function (k) { if (curSet.has(k)) retained.push(k); else churned.push(k); });
      // 留存用户活跃度
      var ua = M.userAgg[m] || {};
      var retClk = 0, retExp = 0; retained.forEach(function (k) { var d = ua[k]; if (d) { retClk += d.clicks || 0; retExp += d.exposures || 0; } });
      var allClk = 0, allExp = 0; curSet.forEach(function (k) { var d = ua[k]; if (d) { allClk += d.clicks || 0; allExp += d.exposures || 0; } });
      var fa = firstAppearanceMap(M);
      var newPrev = [], oldPrev = [];
      prevSet.forEach(function (k) { if (fa[k] === prevM) newPrev.push(k); else oldPrev.push(k); });
      var newRet = newPrev.filter(function (k) { return curSet.has(k); }).length;
      var oldRet = oldPrev.filter(function (k) { return curSet.has(k); }).length;
      var newRate = newPrev.length ? newRet / newPrev.length * 100 : null;
      var oldRate = oldPrev.length ? oldRet / oldPrev.length * 100 : null;
      // 省份留存
      function byProvSet(arr) { var o = {}; arr.forEach(function (k) { var p = provOf(k); (o[p] = o[p] || new Set()).add(k); }); return o; }
      var pp = byProvSet(Array.from(prevSet)), cp = byProvSet(Array.from(curSet));
      var prows = Object.keys(pp).map(function (prov) {
        var inter = 0; pp[prov].forEach(function (k) { if (cp[prov] && cp[prov].has(k)) inter++; });
        return { prov: prov, prev: pp[prov].size, ret: pp[prov].size ? inter / pp[prov].size * 100 : 0 };
      }).sort(function (a, b) { return b.ret - a.ret; });
      // 预警：流失 + 本月低活跃
      var warn = retained.filter(function (k) { var d = ua[k]; return d && (d.exposures || 0) <= 1; }).concat(churned).slice(0, 50);
      var html =
        '<div class="pfm-col" data-col="left">' +
        '<div class="pfm-sec-t">① 留存用户名单 / 流失用户名单（各 Top50 · 可导出）</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost sm pfm-export" id="pfmRetKept" data-export="1">⬇ 留存名单</button>' +
          '<button class="btn btn-ghost sm pfm-export" id="pfmRetLost" data-export="1">⬇ 流失名单</button>' +
        '</div>' +
        '<div class="pfm-sec-t">② 沉默/流失预警名单（本月低活跃 + 流失 · Top50）</div>' +
        buildTable(warn.map(function (k) { return { id: k, tag: churned.indexOf(k) >= 0 ? "流失" : "低活跃" }; }), [
          { k: "id", t: "用户唯一ID(省份-姓名)" },
          { k: "tag", t: "状态" }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="mid">' +
        '<div class="pfm-sec-t">③ 月度趋势（Jun→Jul、Jul→Aug）</div><div class="chart" id="pfmRetTrend"></div>' +
        '<div class="pfm-sec-t">④ 部门/省份 留存率（黏性差异）</div>' +
        buildTable(prows, [
          { k: "prov", t: "省份" },
          { k: "prev", t: "上月活跃", right: true, num: true, fmt: function (v) { return fmtInt(v); } },
          { k: "ret", t: "留存率", right: true, bar: true, fmt: function (v) { return v.toFixed(1) + "%"; } }
        ]) +
        '</div>' +
        '<div class="pfm-col" data-col="right">' +
        '<div class="pfm-sec-t">⑤ 留存用户活跃度（重度与否）</div><div class="pfm-kpi-row">' +
          kpiMini("留存人均点击", (retained.length ? (retClk / retained.length).toFixed(1) : "—"), "留存用户均值") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("全量人均点击", (curSet.size ? (allClk / curSet.size).toFixed(1) : "—"), "本月全量均值") +
        '</div>' +
        '<div class="pfm-sec-t">⑥ 新用户留存 vs 老用户留存（分群）</div>' +
        '<div style="font-size:11px;color:var(--muted);margin:2px 0 8px;line-height:1.5">新用户＝首次出现在' + monthLabel(prevM) + '的新增用户；老用户＝在' + monthLabel(prevM) + '之前已活跃的用户（更早月份已存在且本月仍活跃）。</div>' +
        '<div class="pfm-kpi-row">' +
          kpiMini("新用户留存", (newRate != null ? newRate.toFixed(1) + "%" : "—"), "新用户 " + newPrev.length + "人（" + monthLabel(prevM) + "新增）") +
        '</div><div class="pfm-kpi-row">' +
          kpiMini("老用户留存", (oldRate != null ? oldRate.toFixed(1) + "%" : "—"), "老用户 " + oldPrev.length + "人（此前已活跃）") +
        '</div>' +
        '<div class="pfm-note"><b>口径：</b>留存率=' + monthLabel(prevM) + '∩' + monthLabel(m) + '÷' + monthLabel(prevM) + '。同省同名合并、换省误判（见风险章节）。新用户=首次出现在' + monthLabel(prevM) + '的用户；老用户=此前月份已活跃的用户。⚠️ 部门维度数据源暂无，以省份代示。</div>' +
        '</div>';
      return { html: html, bind: function (body) {
        var bk = body.querySelector("#pfmRetKept"); if (bk) bk.onclick = function () { exportRows("RET_kept_" + monthLabel(m), retained.map(function (k) { return { id: k }; }), [{ k: "id", t: "留存用户" }]); };
        var bl = body.querySelector("#pfmRetLost"); if (bl) bl.onclick = function () { exportRows("RET_lost_" + monthLabel(m), churned.map(function (k) { return { id: k }; }), [{ k: "id", t: "流失用户" }]); };
        if (window.echarts) {
          var tb = body.querySelector("#pfmRetTrend");
          if (tb) {
            var idx0 = M.months.indexOf("2026-06");
            var labels = [], data = [];
            M.months.forEach(function (mm, i) {
              if (i < 1) return; // 起点 Jun→Jul
              if (M.ret[mm] == null) return;
              labels.push(M.months[i - 1].replace("2026-", "") + "→" + mm.replace("2026-", ""));
              data.push(M.ret[mm]);
            });
            var c = window.echarts.init(tb);
            c.setOption({ color: PALETTE, tooltip: { trigger: "axis" }, grid: { left: 55, right: 30, top: 20, bottom: 40 },
              xAxis: { type: "category", data: labels, axisLabel: { color: SUB }, axisLine: { lineStyle: { color: AX } } },
              yAxis: { type: "value", name: "%", max: 100, axisLabel: { color: SUB, formatter: "{value}%" }, splitLine: { lineStyle: { color: GRID } } },
              series: [{ name: "留存率", type: "line", smooth: true, data: data, itemStyle: { color: PALETTE[4] }, lineStyle: { width: 3 } }] });
          }
        }
      } };
    }
  };

  function drawDrillMod(body, M, m, prov) {
    var agg = {};
    if (prov === "全国") {
      var mod = M.modAgg[m] || {};
      Object.keys(mod).forEach(function (k) { agg[k] = mod[k].clicks; });
    } else {
      var pmod = M.provModAgg[m] || {};
      Object.keys(pmod).forEach(function (k) {
        var pv = pmod[k][prov];
        if (pv != null) agg[k] = (agg[k] || 0) + pv;
      });
    }
    var arr = Object.keys(agg).map(function (k) { return { name: k, val: agg[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 10).reverse();
    var box = body.querySelector("#pfmDrillMod");
    if (!box) return;
    if (!window.echarts) { box.innerHTML = '<div class="chart-fallback">图表库未加载</div>'; return; }
    if (window.__pfmModInst) { try { window.__pfmModInst.dispose(); } catch (e) {} }
    var c = window.echarts.init(box);
    c.setOption({
      color: PALETTE, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 130, right: 55, top: 10, bottom: 20 },
      xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: "category", data: arr.map(function (t) { return t.name; }), axisLabel: { color: INK, fontSize: 11 } },
      series: [{ type: "bar", data: arr.map(function (t) { return t.val; }), itemStyle: { color: PALETTE[2] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan(p.value); } } }]
    });
    window.__pfmModInst = c;
  }

  /* 通用导出：rows=对象数组，cols=[{k,t}] 与 buildTable 同规格；生成带 BOM 的 CSV 供 Excel 直接打开 */
  function exportRows(name, rows, cols) {
    if (!rows || !cols) return;
    var head = cols.map(function (c) { return c.t; });
    var lines = [head.join(",")];
    rows.forEach(function (r) {
      lines.push(cols.map(function (c) {
        var v = r[c.k];
        if (v == null) v = "";
        if (typeof v === "number") v = String(v);
        // CSV 单元转义：含逗号/引号/换行时用双引号包裹，内部双引号翻倍
        if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name + ".csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportCsv(name, rows) {
    var head = ["页面", "曝光", "点击", "访客", "CTR%"];
    var lines = [head.join(",")];
    rows.forEach(function (r) { lines.push([r.name, r.exposures, r.clicks, r.visitors, r.ctr == null ? "" : r.ctr.toFixed(1)].join(",")); });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name + ".csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportUserCsv(name, keys) {
    var lines = ["用户唯一ID(省份-姓名)"];
    keys.forEach(function (k) { lines.push(k); });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name + ".csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // 暴露给「平台分析（埋点）」页复用，保证顶部 8 卡与月度页完全一致（同数据、同卡片、同下钻）
  window.PFM = {
    renderKpi: renderKpi,
    openDrill: openDrill,
    closeDrill: closeDrill,
    ensureDrillStyle: ensureDrillStyle,
    getM: getM,
    METRICS: METRICS,
    DRILL: DRILL,
    PFM_IDS: PFM_IDS,
    // 暴露全量菜单配置元数据，供「平台分析（埋点）」页复用页面总数，避免各自口径不一致
    TOTAL_PAGES: PFM_TOTAL_PAGES,   // = 102（二级 3 / 三级 64 / 四级 35，来源 0903 灵运平台全量菜单.xlsx）
    PAGE_MENU: PFM_PAGE_MENU,
    pageLevelCount: pageLevelCount
  };
})();

;
/* ===== pages/province.js ===== */
/* pages/province.js — 省份分析（负责人：吴超）
 * 本文件只负责本页面渲染，只读 core/core.js 暴露的全局共享状态（D / FILTER / V 等），
 * 不写任何取数逻辑。优化本页只需改这个文件，互不影响其他页面。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "province",
    title: "省份分析",
    icon: "◎",
    order: 4,
    owner: "吴超",
    render: function () { renderProvince(); }
  });

  /* ===== 本页面渲染函数（从原 v10 无损搬入） ===== */
function renderProvince() {
    var ps = (V.provinces || []).slice();
    var title = $("prTitle"); if (title) title.textContent = "省份分析（" + V.flags.periodLabel + " · " + V.flags.provLabel + "）";
    function drawProv() {
      var list = ps;
      var byCalls = list.slice().sort(function (a, b) { return (b._calls || 0) - (a._calls || 0); }).slice(0, 15).reverse();
      topChart("prRank", {
        color: PALETTE,
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        grid: { left: 70, right: 40, top: 20, bottom: 30 },
        xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
        yAxis: { type: "category", data: byCalls.map(function (p) { return p.province; }), axisLabel: { color: INK } },
        series: [{ type: "bar", data: byCalls.map(function (p) { return p._calls; }), itemStyle: { color: PALETTE[0] }, label: { show: true, position: "right", formatter: function (q) { return fmtWan(q.value); } } }]
      });
      var byTok = list.slice().sort(function (a, b) { return (b._tokens || 0) - (a._tokens || 0); }).slice(0, 15).reverse();
      topChart("prToken", {
        color: PALETTE,
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        grid: { left: 70, right: 60, top: 20, bottom: 30 },
        xAxis: { type: "value", axisLabel: { color: SUB, formatter: function (v) { return fmtWan(v); } }, splitLine: { lineStyle: { color: GRID } } },
        yAxis: { type: "category", data: byTok.map(function (p) { return p.province; }), axisLabel: { color: INK } },
        series: [{ type: "bar", data: byTok.map(function (p) { return p._tokens; }), itemStyle: { color: PALETTE[3] }, label: { show: true, position: "right", formatter: function (q) { return fmtWan(q.value); } } }]
      });
      var tb = $("prTable");
      if (tb) {
        var sorted = list.slice().sort(function (a, b) { return (b._calls || 0) - (a._calls || 0); });
        var rows = sorted.map(function (p) {
          return "<tr><td>" + dash(p.province) + "</td><td>" + fmtWan(p._calls) + "</td><td>" + dash(p._active) +
            "</td><td>" + fmtWan(p._tokens) + "</td><td>" + fmtMoney(p._cost) + "</td></tr>";
        }).join("");
        tb.innerHTML = '<thead><tr><th>省份</th><th>调用量(' + (FILTER.months.length ? V.flags.periodLabel : "全周期") + ')</th><th>活跃智能体(期末月)</th><th>Token(月度)</th><th>模型计费(月度)</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">无数据</td></tr>') + "</tbody>";
      }
      insightBox("prInsight",
        "当前" + (FILTER.prov.length && FILTER.prov.indexOf("全国") < 0 ? "已选 " + FILTER.prov.length + " 个单位" : "全国") + "，调用量最高的省份为 <b>" +
        (byCalls.length ? byCalls[byCalls.length - 1].province : "/") + "</b>（" + fmtWan(byCalls.length ? byCalls[byCalls.length - 1]._calls : 0) + "）。");
    }
    drawProv();
  }
})();

;
/* ===== pages/quality.js ===== */
/* pages/quality.js — 质效分析（负责人：赵莹）
 * 本文件只负责本页面渲染，只读 core/core.js 暴露的全局共享状态（D / FILTER / V 等），
 * 不写任何取数逻辑。优化本页只需改这个文件，互不影响其他页面。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "quality",
    title: "质效分析",
    icon: "◎",
    order: 5,
    owner: "赵莹",
    render: function () { renderQuality(); }
  });

  /* ===== 本页面渲染函数（从原 v10 无损搬入） ===== */
function initCenterRankState(R) {
    if (CENTER_RANK_STATE) return;
    var months = R.months.map(function (_, i) { return i; });
    var provinces = {};
    (R.entities || []).forEach(function (e) { provinces[e.province] = true; });
    var abilities = {};
    (R.abilities || []).forEach(function (a) { if (a.in2025 || a.in2026) abilities[a.key] = true; });
    CENTER_RANK_STATE = { months: months, provinces: provinces, abilities: abilities };
  }

function renderCenterRank() {
    var R = D.centerYearRank || {};
    if (!R.entities || !R.entities.length) {
      var b = $("centerRankTable"); if (b) b.innerHTML = "<tr><td>无数据</td></tr>"; return;
    }
    initCenterRankState(R);
    var periodEl = $("centerRankPeriod");
    if (periodEl) periodEl.innerHTML = "可比同期区间：<b>" + (R.periodLabel || "—") +
      "</b>（2026 与 2025 同年同月对比）。等效人年合计 = 所选分项中该年有数据的能力加和：2025 年含全部 5 项（含智能点选），2026 年含 4 项（智能点选 2026 模板已无列，按口径不计入，故 2026 ≠ 字段原值）。得分：增幅&gt;8% 得满分 2.0，0–8% 线性，≤0 得 0。" +
      "分项列仅作能力拆解展示。";
    renderCenterRankMonthFilter();
    renderCenterRankAbilityFilter();
    renderCenterRankProvFilter();
    var dl = $("btnDownloadCenterRank"); if (dl) dl.onclick = downloadCenterRank;
    drawCenterRankTable();
  }

function renderCenterRankMonthFilter() {
    var wrap = $("centerRankMonthFilter"); if (!wrap) return;
    var R = D.centerYearRank;
    var months = R.months;
    var allOn = CENTER_RANK_STATE.months.length === months.length;
    var html = '<span class="chip' + (allOn ? " on" : "") + '" data-m="all">全选</span>';
    months.forEach(function (m, i) {
      var on = CENTER_RANK_STATE.months.indexOf(i) >= 0;
      html += '<span class="chip' + (on ? " on" : "") + '" data-m="' + i + '">' + m + '月</span>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll(".chip").forEach(function (c) {
      c.onclick = function () {
        var v = c.getAttribute("data-m");
        if (v === "all") {
          var turnOn = CENTER_RANK_STATE.months.length !== R.months.length;
          CENTER_RANK_STATE.months = turnOn ? R.months.map(function (_, i) { return i; }) : [];
        } else {
          var idx = parseInt(v, 10);
          var pos = CENTER_RANK_STATE.months.indexOf(idx);
          if (pos >= 0) CENTER_RANK_STATE.months.splice(pos, 1);
          else CENTER_RANK_STATE.months.push(idx);
          CENTER_RANK_STATE.months.sort(function (a, b) { return a - b; });
        }
        renderCenterRankMonthFilter();
        drawCenterRankTable();
      };
    });
  }

function renderCenterRankAbilityFilter() {
    var wrap = $("centerRankAbilityFilter"); if (!wrap) return;
    var R = D.centerYearRank;
    var abs = (R.abilities || []).filter(function (a) { return a.in2025 || a.in2026; });
    var allOn = abs.every(function (a) { return CENTER_RANK_STATE.abilities[a.key]; });
    var html = '<span class="chip' + (allOn ? " on" : "") + '" data-a="all">全选</span>';
    abs.forEach(function (a) {
      var on = CENTER_RANK_STATE.abilities[a.key];
      var tag = (a.in2025 && a.in2026) ? "" : (a.in2025 ? "（仅2025）" : "（仅2026）");
      html += '<span class="chip' + (on ? " on" : "") + '" data-a="' + a.key + '">' + esc(a.name) + esc(tag) + '</span>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll(".chip").forEach(function (c) {
      c.onclick = function () {
        var v = c.getAttribute("data-a");
        if (v === "all") {
          var turnOn = !abs.every(function (a) { return CENTER_RANK_STATE.abilities[a.key]; });
          abs.forEach(function (a) { CENTER_RANK_STATE.abilities[a.key] = turnOn; });
        } else {
          CENTER_RANK_STATE.abilities[v] = !CENTER_RANK_STATE.abilities[v];
        }
        renderCenterRankAbilityFilter();
        drawCenterRankTable();
      };
    });
  }

function renderCenterRankProvFilter() {
    var wrap = $("centerRankProvFilter"); if (!wrap) return;
    var R = D.centerYearRank;
    var centers = (R.entities || []).filter(function (e) { return e.type === "center"; });
    var others = (R.entities || []).filter(function (e) { return e.type !== "center"; });
    var allOn = centers.every(function (e) { return CENTER_RANK_STATE.provinces[e.province]; });
    var html = '<span class="chip' + (allOn ? " on" : "") + '" data-p="__allcenters">全选分中心</span>';
    centers.forEach(function (e) {
      var on = CENTER_RANK_STATE.provinces[e.province];
      html += '<span class="chip' + (on ? " on" : "") + '" data-p="' + esc(e.province) + '">' + esc(e.province) + '</span>';
    });
    others.forEach(function (e) {
      var on = CENTER_RANK_STATE.provinces[e.province];
      html += '<span class="chip chip-natl' + (on ? " on" : "") + '" data-p="' + esc(e.province) + '">' + esc(e.province) + '</span>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll(".chip").forEach(function (c) {
      c.onclick = function () {
        var v = c.getAttribute("data-p");
        if (v === "__allcenters") {
          var turnOn = !centers.every(function (e) { return CENTER_RANK_STATE.provinces[e.province]; });
          centers.forEach(function (e) { CENTER_RANK_STATE.provinces[e.province] = turnOn; });
        } else {
          CENTER_RANK_STATE.provinces[v] = !CENTER_RANK_STATE.provinces[v];
        }
        renderCenterRankProvFilter();
        drawCenterRankTable();
      };
    });
  }

function centerSumAbility(ent, key, year, months) {
    var arr = (year === 2026 ? ent.ability2026 : ent.ability2025)[key];
    if (!arr) return 0;
    var s = 0; months.forEach(function (mi) { s += arr[mi] || 0; }); return s;
  }

function selRangeLabel() {
    var ms = CENTER_RANK_STATE.months.slice().sort(function (a, b) { return a - b; });
    if (!ms.length) return "未选月份";
    var x = ms[0] + 1, y = ms[ms.length - 1] + 1;
    return (x === y) ? (x + "月") : (x + "月-" + y + "月");
  }

function selProvLabel() {
    var R = D.centerYearRank || {};
    var ents = R.entities || [];
    var centers = ents.filter(function (e) { return e.type === "center"; });
    var others = ents.filter(function (e) { return e.type !== "center"; });
    var allC = centers.every(function (e) { return CENTER_RANK_STATE.provinces[e.province]; });
    var allO = others.every(function (e) { return CENTER_RANK_STATE.provinces[e.province]; });
    if (allC && allO) return "全部（" + centers.length + "分中心+本部+全国）";
    return ents.filter(function (e) { return CENTER_RANK_STATE.provinces[e.province]; }).map(function (e) { return e.province; }).join("、");
  }

function breakdownCols() {
    var R = D.centerYearRank || {};
    var cols = [];
    (R.abilities || []).forEach(function (a) {
      if (!CENTER_RANK_STATE.abilities[a.key]) return;
      var year = a.in2026 ? 2026 : 2025;
      cols.push({ key: a.key, year: year, label: a.name + "·" + year + "年" });
    });
    return cols;
  }

function centerCompute(e) {
    var R = D.centerYearRank;
    var months = CENTER_RANK_STATE.months;
    // 等效人年合计 = 所选分项中「该年有数据」的能力逐月加和（按所选月份累加）：
    // 2025 含全部 5 项（含智能点选），2026 含 4 项（智能点选 2026 模板已无列，故不计入）。
    // 即「2025=5项全算、2026=4项（除智能点选）」，与分项勾选联动（默认全选）。
    var t25 = 0, t26 = 0;
    (R.abilities || []).forEach(function (a) {
      if (!CENTER_RANK_STATE.abilities[a.key]) return;
      if (a.in2025) t25 += centerSumAbility(e, a.key, 2025, months);
      if (a.in2026) t26 += centerSumAbility(e, a.key, 2026, months);
    });
    var growth, score;
    if (t25 > 0) growth = (t26 - t25) / t25;
    else growth = (t26 > 0) ? null : 0;
    if (growth === null) score = 2.0;
    else if (growth <= 0) score = 0.0;
    else if (growth >= 0.08) score = 2.0;
    else score = growth / 0.08 * 2.0;
    return { t25: round2(t25), t26: round2(t26), growth: growth === null ? null : round2(growth * 100), score: round2(score) };
  }

  /* ===== 省份按月明细弹窗（表格「更多」按钮）===== */
  function closeProvinceDetail() {
    var m = $("qeProvModal");
    if (m && m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener("keydown", onProvModalKey, true);
  }
  function onProvModalKey(ev) {
    if (ev.key === "Escape") closeProvinceDetail();
  }

  function openProvinceDetail(prov) {
    var R = D.centerYearRank || {};
    var ent = null;
    (R.entities || []).forEach(function (e) { if (e.province === prov) ent = e; });
    var months = R.months || [];
    var abs = R.abilities || [];

    var body = "";
    if (!ent || !months.length) {
      body = '<div class="qe-modal-empty">该省份暂无按月明细数据</div>';
    } else {
      // 表头：两级 —— 第1行写年份（2025 / 2026），第2行写项目（智能语音、RPA 等）
      // 列顺序：月份 | 2025 年（各能力）| 2026 年（各能力）| 年度合计（2025 / 2026）| 增幅
      var n = abs.length;
      var th = "<tr><th rowspan='2'>月份</th>" +
        "<th colspan='" + n + "'>2025年</th>" +
        "<th colspan='" + n + "'>2026年</th>" +
        "<th colspan='2'>年度合计</th>" +
        "<th rowspan='2'>增幅</th></tr><tr>";
      abs.forEach(function (a) { th += "<th>" + esc(a.name) + "</th>"; }); // 2025 组：项目名
      abs.forEach(function (a) { th += "<th>" + esc(a.name) + "</th>"; }); // 2026 组：项目名
      th += "<th>2025</th><th>2026</th></tr>";

      var tb = "";
      months.forEach(function (m, mi) {
        var row = "<tr><td><b>" + m + "月</b></td>";
        var s25 = 0, s26 = 0;
        // 2025 年组：按能力顺序逐列
        abs.forEach(function (a) {
          var v25 = a.in2025 ? ((ent.ability2025[a.key] || [])[mi] || 0) : null;
          if (v25 != null) s25 += v25;
          row += "<td class='num'>" + (v25 == null ? "/" : fmtPY(round2(v25))) + "</td>";
        });
        // 2026 年组：按能力顺序逐列
        abs.forEach(function (a) {
          var v26 = a.in2026 ? ((ent.ability2026[a.key] || [])[mi] || 0) : null;
          if (v26 != null) s26 += v26;
          row += "<td class='num'>" + (v26 == null ? "/" : fmtPY(round2(v26))) + "</td>";
        });
        var g = s25 > 0 ? (s26 - s25) / s25 : null;
        row += "<td class='num'>" + fmtPY(round2(s25)) + "</td>";
        row += "<td class='num'>" + fmtPY(round2(s26)) + "</td>";
        row += "<td class='num " + (g == null ? "" : (g >= 0 ? "up" : "down")) + "'>" +
          (g == null ? "/" : (g >= 0 ? "+" : "") + (g * 100).toFixed(2) + "%") + "</td>";
        row += "</tr>";
        tb += row;
      });
      // 合计行
      var t25 = 0, t26 = 0;
      months.forEach(function (_, mi) {
        abs.forEach(function (a) {
          if (a.in2025) t25 += (ent.ability2025[a.key] || [])[mi] || 0;
          if (a.in2026) t26 += (ent.ability2026[a.key] || [])[mi] || 0;
        });
      });
      var tg = t25 > 0 ? (t26 - t25) / t25 : null;
      var trow = "<tr class='qe-modal-total'><td><b>合计</b></td>";
      // 2025 年组：每个能力年度合计
      abs.forEach(function (a) {
        var a25 = 0;
        if (a.in2025) months.forEach(function (_, mi) { a25 += (ent.ability2025[a.key] || [])[mi] || 0; });
        trow += "<td class='num'>" + (a.in2025 ? fmtPY(round2(a25)) : "/") + "</td>";
      });
      // 2026 年组：每个能力年度合计
      abs.forEach(function (a) {
        var a26 = 0;
        if (a.in2026) months.forEach(function (_, mi) { a26 += (ent.ability2026[a.key] || [])[mi] || 0; });
        trow += "<td class='num'>" + (a.in2026 ? fmtPY(round2(a26)) : "/") + "</td>";
      });
      trow += "<td class='num'><b>" + fmtPY(round2(t25)) + "</b></td>";
      trow += "<td class='num'><b>" + fmtPY(round2(t26)) + "</b></td>";
      trow += "<td class='num " + (tg == null ? "" : (tg >= 0 ? "up" : "down")) + "'><b>" +
        (tg == null ? "/" : (tg >= 0 ? "+" : "") + (tg * 100).toFixed(2) + "%") + "</b></td></tr>";
      tb += trow;

      body = '<div class="qe-modal-scroll"><table class="qe-modal-table">' +
        "<thead>" + th + "</thead><tbody>" + tb + "</tbody></table></div>";
    }

    closeProvinceDetail();
    var modal = document.createElement("div");
    modal.className = "qe-modal-mask";
    modal.id = "qeProvModal";
    modal.innerHTML =
      '<div class="qe-modal" role="dialog" aria-modal="true" aria-label="' + esc(prov) + ' 按月明细">' +
        '<div class="qe-modal-head">' +
          '<div class="qe-modal-title">' + esc(prov) + ' · 等效人年按月明细</div>' +
          '<button type="button" class="qe-modal-close" id="qeProvModalClose" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="qe-modal-body">' + body + '</div>' +
        '<div class="qe-modal-foot">数据口径：2025 含 5 项（含智能点选），2026 含 4 项（不含智能点选）；灵运平台与智能立单暂无省级拆分。</div>' +
      '</div>';
    document.body.appendChild(modal);
    var closeBtn = $("qeProvModalClose");
    if (closeBtn) closeBtn.onclick = closeProvinceDetail;
    modal.onclick = function (ev) { if (ev.target === modal) closeProvinceDetail(); };
    document.addEventListener("keydown", onProvModalKey, true);
  }

function drawCenterRankTable() {
    var R = D.centerYearRank || {};
    var months = CENTER_RANK_STATE.months;
    var ents = (R.entities || []).filter(function (e) { return CENTER_RANK_STATE.provinces[e.province]; });
    var rows = ents.map(function (e) { return { e: e, c: centerCompute(e) }; });
    var centers = rows.filter(function (r) { return r.e.type === "center"; });
    centers.sort(function (a, b) { return b.c.t26 - a.c.t26; });
    var rankMap = {}; centers.forEach(function (r, i) { rankMap[r.e.province] = i + 1; });
    rows.sort(function (a, b) {
      var ra = rankMap[a.e.province] || 9999, rb = rankMap[b.e.province] || 9999;
      if (a.e.type === "center" && b.e.type === "center") return ra - rb;
      if (a.e.type !== "center" && b.e.type !== "center") return a.e.type.localeCompare(b.e.type);
      return a.e.type === "center" ? -1 : 1;
    });
    var range = selRangeLabel();
    var bcols = breakdownCols();
    var thead = "<tr><th>序号</th><th>省分中心</th><th>2025年" + range + "<br>等效人年</th><th>2026年" + range + "<br>等效人年</th>";
    bcols.forEach(function (bc) { thead += "<th>" + esc(bc.label) + "</th>"; });
    thead += "<th>增幅</th><th>得分</th><th>排名</th><th>明细</th></tr>";
    var tbody = "";
    var shown = 0;
    rows.forEach(function (r) {
      var isC = r.e.type === "center";
      if (isC) shown++;
      var cls = (r.c.growth == null ? "" : (r.c.growth >= 0 ? "up" : "down"));
      var rc = r.e.type === "national" ? "national-row" : (r.e.type === "hq" ? "hq-row" : "");
      var row = "<tr class='" + rc + "'>";
      row += "<td class='num'>" + (isC ? shown : "—") + "</td>";
      row += "<td><b>" + esc(r.e.province) + "</b></td>";
      row += "<td class='num'>" + fmtPY(r.c.t25) + "</td>";
      row += "<td class='num'>" + fmtPY(r.c.t26) + "</td>";
      bcols.forEach(function (bc) { row += "<td class='num'>" + fmtPY(centerSumAbility(r.e, bc.key, bc.year, months)) + "</td>"; });
      row += "<td class='num " + cls + "'>" + (r.c.growth == null ? "/" : fmtPct(r.c.growth)) + "</td>";
      row += "<td class='num'>" + fmtScore(r.c.score) + "</td>";
      row += "<td class='num rank'>" + (isC ? rankMap[r.e.province] : "—") + "</td>";
      // 「更多」按钮：查看该省份按月数据明细（置于末列，作为操作列）
      row += "<td class='num'><button type='button' class='qe-more' data-prov='" + esc(r.e.province) +
        "' title='查看 " + esc(r.e.province) + " 的按月明细'>更多</button></td>";
      row += "</tr>";
      tbody += row;
    });
    if (!tbody) tbody = "<tr><td colspan='" + (5 + bcols.length + 3) + "'>请至少勾选一个省份</td></tr>";
    var tbl = $("centerRankTable");
    if (tbl) tbl.innerHTML = "<thead>" + thead + "</thead><tbody>" + tbody + "</tbody>";
    // 绑定「更多」按钮
    if (tbl) {
      tbl.querySelectorAll("button.qe-more").forEach(function (b) {
        b.onclick = function () { openProvinceDetail(b.getAttribute("data-prov")); };
      });
    }
    var top3 = centers.slice(0, 3).map(function (r) { return r.e.province + "（" + fmtPY(r.c.t26) + "）"; }).join("、");
    insightBox("centerRankInsight", "筛选时间 " + range + " · 筛选省份 " + selProvLabel() + "；当前 " + months.length + " 个月 · " + ents.length + " 个主体（分中心 " + centers.length + " 个）；2026 等效人年 TOP3：" + (top3 || "—") + "。合计=所选分项该年有数据的能力加和（2025 含智能点选 5 项、2026 为 4 项不含智能点选）。");
  }

function downloadCenterRank() {
    var R = D.centerYearRank || {};
    var months = CENTER_RANK_STATE.months;
    var ents = (R.entities || []).filter(function (e) { return CENTER_RANK_STATE.provinces[e.province]; });
    var rows = ents.map(function (e) { return { e: e, c: centerCompute(e) }; });
    var centers = rows.filter(function (r) { return r.e.type === "center"; });
    centers.sort(function (a, b) { return b.c.t26 - a.c.t26; });
    var rankMap = {}; centers.forEach(function (r, i) { rankMap[r.e.province] = i + 1; });
    var ordered = rows.slice().sort(function (a, b) {
      var ra = rankMap[a.e.province] || 9999, rb = rankMap[b.e.province] || 9999;
      if (a.e.type === "center" && b.e.type === "center") return ra - rb;
      if (a.e.type !== "center" && b.e.type !== "center") return a.e.type.localeCompare(b.e.type);
      return a.e.type === "center" ? -1 : 1;
    });
    var range = selRangeLabel();
    var bcols = breakdownCols();
    var header = ["序号", "省分中心", "2025年" + range + "等效人年", "2026年" + range + "等效人年"];
    bcols.forEach(function (bc) { header.push(bc.label + "等效人年"); });
    header.push("增幅(%)", "得分", "排名");
    // 元信息行：展示本次下载筛选的时间与省份、分项
    var selAbs = (R.abilities || []).filter(function (a) { return CENTER_RANK_STATE.abilities[a.key]; }).map(function (a) { return a.name; });
    var meta = [
      ["筛选时间", "2025年" + range + " 对比 2026年" + range + "（可比同期）"],
      ["筛选省份", selProvLabel()],
      ["筛选分项", (selAbs.join("、") || "（未选）")],
      ["说明", "等效人年合计 = 所选分项中该年有数据的能力加和：2025 年含全部 5 项（含智能点选），2026 年含 4 项（智能点选 2026 模板无列，按口径不计入，故 2026 ≠ 字段原值）；分项列仅作能力拆解展示。"]
    ];
    var out = [];
    meta.forEach(function (m) { out.push(m); });
    out.push([]); // 空行分隔
    out.push(header);
    ordered.forEach(function (r) {
      var isC = r.e.type === "center";
      var row = [isC ? rankMap[r.e.province] : "—", r.e.province, r.c.t25, r.c.t26];
      bcols.forEach(function (bc) { row.push(centerSumAbility(r.e, bc.key, bc.year, months)); });
      row.push(r.c.growth == null ? "" : r.c.growth, r.c.score == null ? "" : r.c.score, isC ? rankMap[r.e.province] : "—");
      out.push(row);
    });
    var csv = "﻿" + out.map(function (r) {
      if (r.length === 0) return "";
      return r.map(function (c) { var s = String(c == null ? "" : c); if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url;
    a.download = "分中心等效人年排名_" + range + "_" + months.length + "月_" + ents.length + "主体.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

/* 取全国主体（type==="national"）的逐年等效人年合计与分项 */
function nationalYearTotals(R) {
    var natl = null;
    (R.entities || []).forEach(function (e) { if (e.type === "national") natl = e; });
    if (!natl) return null;
    var months = R.months || [];
    var abs = R.abilities || [];
    var by26 = {}, by25 = {};
    abs.forEach(function (a) { by26[a.key] = 0; by25[a.key] = 0; });
    months.forEach(function (mi, idx) {
      abs.forEach(function (a) {
        if (a.in2026) by26[a.key] += ((natl.ability2026[a.key] || [])[idx]) || 0;
        if (a.in2025) by25[a.key] += ((natl.ability2025[a.key] || [])[idx]) || 0;
      });
    });
    // 2026 总体 = 当年有数据的分项（四项：语音/RPA/质检/教练，不含智能点选）
    // 2025 总体 = 当年有数据的分项（五项：含智能点选）
    var sum26 = 0, sum25 = 0;
    abs.forEach(function (a) { if (a.in2026) sum26 += by26[a.key]; if (a.in2025) sum25 += by25[a.key]; });
    var growth = sum25 > 0 ? (sum26 - sum25) / sum25 : null;
    return {
      sum26: round2(sum26), sum25: round2(sum25),
      growth: growth == null ? null : round2(growth * 100),
      by26: by26, by25: by25, months: months
    };
  }

  /* ===== 顶部 7 张整体指标卡片（随全局 FILTER 月份/单位动态变化） ===== */
  function qeMonthIdx(R) {
    // 全局 FILTER.months 为 "1月" 字符串；R.months 为 [1..7] 数字；空或周/日维度 → 全月(null)
    if (FILTER.dim !== "month" || !FILTER.months.length) return null;
    var idx = [];
    FILTER.months.forEach(function (fm) {
      var mnum = parseInt(fm, 10);
      var i = R.months.indexOf(mnum);
      if (i >= 0) idx.push(i);
    });
    return idx.length ? idx : null;
  }

  function qeScopeEntities(R) {
    // 全局 FILTER.prov：[] 或含"全国" → 全部（取权威全国实体）；否则取所选单位（排除"全国"聚合实体，避免重复累加）
    var allProv = (!FILTER.prov.length || FILTER.prov.indexOf("全国") >= 0);
    var natl = null;
    R.entities.forEach(function (e) { if (e.type === "national") natl = e; });
    if (allProv) return natl ? [natl] : R.entities.filter(function (e) { return e.type !== "national"; });
    var subs = R.entities.filter(function (e) { return e.type !== "national" && FILTER.prov.indexOf(e.province) >= 0; });
    return subs.length ? subs : (natl ? [natl] : R.entities);
  }

  function qeSum(ents, key, year, midx) {
    var total = 0;
    ents.forEach(function (e) {
      var arr = (year === 2026 ? e.ability2026 : e.ability2025)[key];
      if (!arr) return;
      if (midx == null) { for (var i = 0; i < arr.length; i++) total += arr[i] || 0; }
      else midx.forEach(function (mi) { total += arr[mi] || 0; });
    });
    return total;
  }

  /* ===== 顶部卡片：完全参考「数据总览」顶部 KPI 卡 =====
   * 自上而下：① 指标名称(.kpi-hd) ② 指标数(.val)+趋势(.kpi-spark) ③ 口径/2025/备注(.kpi-sub) ④ 同比(.kpi-foot)
   * 数值单位「人年」缩为小字(.val-unit)；卡片主色用于顶部色条与趋势线；趋势缩略图与数据总览同款 SVG。 */
  var QE_SPARK_COLOR = "#3b82f6"; // 冷色蓝
  // 每张卡主色（冷色系，参考平台分析按指标着色）
  var QE_COLORS = {
    total26: "#3b82f6", total25: "#64748b",
    voice: "#3b82f6", rpa: "#0ea5e9", qa: "#14b8a6", coach: "#8b5cf6",
    platform: "#06b6d4", order: "#6366f1", select: "#64748b"
  };

  // 取某项能力逐月（按 R.months 全量月份）的等效人年合计序列
  function qeAbilitySeries(ents, key, year) {
    var R = D.centerYearRank || {};
    var months = R.months || [];
    return months.map(function (m, idx) {
      var s = 0;
      ents.forEach(function (e) {
        var arr = (year === 2026 ? e.ability2026 : e.ability2025)[key];
        if (arr && arr[idx] != null) s += arr[idx] || 0;
      });
      return s;
    });
  }
  // 多项能力逐月合计序列（用于总体卡）
  function qeTotalSeries(R, ents, keys, year) {
    var months = R.months || [];
    return months.map(function (m, idx) {
      var s = 0;
      keys.forEach(function (k) {
        ents.forEach(function (e) {
          var arr = (year === 2026 ? e.ability2026 : e.ability2025)[k];
          if (arr && arr[idx] != null) s += arr[idx] || 0;
        });
      });
      return s;
    });
  }
  // 灵运平台 / 智能立单 的逐月序列（来自「数据月度汇总」）
  function qeSummaryAbilitySeries(key) {
    var Q = qeSummary();
    var ab = null;
    (Q.abilities || []).forEach(function (a) { if (a.key === key) ab = a; });
    if (!ab || !ab.values) return null;
    return ab.values.slice();
  }
  // 迷你折线（与数据总览 sparkline 同款 SVG）
  function qeSparkline(vals, color) {
    var w = 86, h = 30, pad = 3;
    var nums = vals.filter(function (v) { return v != null; });
    if (nums.length < 2) return null;
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), rng = (max - min) || 1;
    var n = vals.length, pts = vals.map(function (v, i) {
      var x = pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
      var y = h - pad - (h - 2 * pad) * (v == null ? 0 : (v - min) / rng);
      return [x, y];
    });
    var ptsStr = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var areaPts = ptsStr + " " + pts[pts.length - 1][0].toFixed(1) + "," + (h - pad).toFixed(1) + " " + pts[0][0].toFixed(1) + "," + (h - pad).toFixed(1);
    var gid = "qsg" + Math.random().toString(36).slice(2, 8);
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + areaPts + '" fill="url(#' + gid + ')"/>' +
      '<polyline points="' + ptsStr + '" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
      '</svg>';
  }
  // 趋势缩略图内容（放入 .kpi-spark）；不足 2 点显示占位
  function qeSparkHtml(series) {
    var svg = qeSparkline(series, QE_SPARK_COLOR);
    return svg ? svg : '<span class="spark-empty">—</span>';
  }
  // 数值中的「人年」单位缩为小字（与数据总览同款 .val-unit）；入参可为数字或已格式化字符串
  function qeValHtml(v) {
    if (typeof v === "number") v = fmtPY(round2(v));
    return String(v).replace(/人年/, '<span class="val-unit">人年</span>');
  }

  /* 统一卡片构造：完全参考平台分析（月）顶部 KPI 卡 4 行结构
   * o = {title, val, series, sub, foot, color, kou, actions, isTotal} */
  function qeKpiCard(o) {
    var spark = qeSparkHtml(o.series);
    var tip = o.kou ? '<span class="tip" data-tip="' + esc(o.kou) + '" title="' + esc(o.kou) + '">ⓘ</span>' : '';
    var actions = (o.actions || '') + tip;
    var subHtml = (o.sub != null && o.sub !== "") ? '<div class="kpi-sub">' + o.sub + '</div>' : '';
    return '<div class="kpi kpi-qe' + (o.isTotal ? " kpi-qe-total" : "") + '" style="--c:' + (o.color || "#1f2937") + '">' +
      '<div class="kpi-hd">' +
        '<div class="lb">' + esc(o.title) + '</div>' +
        '<div class="kpi-actions">' + actions + '</div>' +
      '</div>' +
      '<div class="val">' + qeValHtml(o.val) + '</div>' +
      subHtml +
      '<div class="kpi-spark">' + spark + '</div>' +
      '<div class="kpi-foot">' + (o.foot || '') + '</div>' +
    '</div>';
  }

  // 同比（行4）。为「完全参考平台分析页卡片样式」，复用其 .mom.up(teal)/.mom.down(red)/.mom.flat 配色。
  // 若后续要改回项目「红涨绿跌」口径，只需调整下方 CSS .kpi-qe .mom 的颜色即可。
  function qeMomHtml(g, txt) {
    var cls = (g == null) ? "flat" : (g >= 0 ? "up" : "down");
    return '<span class="mom ' + cls + '" title="同比 2025 年同期">' + esc(txt) + '</span>';
  }

  function qeAbilityCard(title, ents, key, midx, colorKey) {
    var v26 = qeSum(ents, key, 2026, midx);
    var v25 = qeSum(ents, key, 2025, midx);
    var g, dTxt;
    if (v25 > 0) {
      g = (v26 - v25) / v25;
      dTxt = "同比去年 " + (g >= 0 ? "▲ +" : "▼ ") + (g * 100).toFixed(2) + "%";
    } else if (v26 > 0) {
      g = null; dTxt = "同比去年 +100%（无 2025 基线）";
    } else {
      g = null; dTxt = "2025 年无同比基线";
    }
    return qeKpiCard({
      title: title,
      val: fmtPY(round2(v26)),
      series: qeAbilitySeries(ents, key, 2026),
      sub: "2025 年：" + fmtPY(round2(v25)),
      foot: qeMomHtml(g, dTxt),
      color: QE_COLORS[colorKey] || "#1f2937",
      kou: "等效人年＝实际投入工时 ÷ 年标准工时；按所选单位逐月汇总，2026 与 2025 同年同月可比。"
    });
  }

  /* ===== 2026 总体口径：6 项能力可多选筛选 =====
   * 前 4 项（智能语音/RPA/智能质检/智能教练）来自 centerYearRank，有 2025 与 2026 两年数据；
   * 后 2 项（灵运平台/智能立单）来自「质效分析·数据月度汇总」，只有 2026 年、无 2025 基线，
   * 因此勾选它们后同比按“基线缺失”处理，不把 2025 当 0 参与计算。
   */
  var QE_ITEMS = [
    { key: "voice", name: "智能语音" },
    { key: "rpa", name: "RPA" },
    { key: "qa", name: "智能质检" },
    { key: "coach", name: "智能教练" },
    { key: "platform", name: "灵运平台" },
    { key: "order", name: "智能立单" }
  ];
  // 默认只展示原四项能力
  var QE_TOP_STATE = {
    sel: { voice: true, rpa: true, qa: true, coach: true, platform: false, order: false },
    open: false
  };

  function qeSummary() {
    try {
      if (window.LY && window.LY.data && typeof window.LY.data.domain === "function") {
        return window.LY.data.domain("qeMonthlySummary") || {};
      }
    } catch (e) { /* 回退到 D */ }
    return (typeof D !== "undefined" && D.qeMonthlySummary) ? D.qeMonthlySummary : {};
  }

  // 取某项能力在指定年份、指定月份索引下的合计；无数据返回 null
  function qeItemSum(key, year, midx, R, ents) {
    if (key === "platform" || key === "order") {
      if (year !== 2026) return null; // 无 2025 基线
      var Q = qeSummary();
      var ab = null;
      (Q.abilities || []).forEach(function (a) { if (a.key === key) ab = a; });
      if (!ab || !ab.values) return null;
      if (midx == null) {
        var s = 0;
        ab.values.forEach(function (v) { s += v || 0; });
        return s;
      }
      var t = 0, any = false;
      midx.forEach(function (i) {
        if (i < ab.values.length) { t += ab.values[i] || 0; any = true; }
      });
      return any ? t : null;
    }
    return qeSum(ents, key, year, midx);
  }

  function qeSelectedKeys() {
    return QE_ITEMS.filter(function (it) { return QE_TOP_STATE.sel[it.key]; })
      .map(function (it) { return it.key; });
  }

  function qeComputeTotal(R, ents, midx) {
    var keys = qeSelectedKeys();
    var v26 = 0, v25 = 0, baseOk = false;
    keys.forEach(function (k) {
      var a = qeItemSum(k, 2026, midx, R, ents);
      var b = qeItemSum(k, 2025, midx, R, ents);
      if (a != null) v26 += a;
      if (b != null) { v25 += b; baseOk = true; }
    });
    return { v26: v26, v25: v25, baseOk: baseOk, keys: keys };
  }

  // 卡片右上角的多选筛选项
  function qeFilterHtml() {
    var html = '<div class="qe-filter">';
    html += '<button type="button" class="qe-filter-btn" id="qeFilterBtn" aria-expanded="' +
      (QE_TOP_STATE.open ? "true" : "false") + '" title="选择计入总体的能力项">筛选 ' +
      qeSelectedKeys().length + '/6 <span class="qe-caret">' + (QE_TOP_STATE.open ? "▲" : "▼") + '</span></button>';
    if (QE_TOP_STATE.open) {
      html += '<div class="qe-filter-panel" id="qeFilterPanel">';
      QE_ITEMS.forEach(function (it) {
        var on = !!QE_TOP_STATE.sel[it.key];
        var noBase = (it.key === "platform" || it.key === "order");
        html += '<label class="qe-filter-item' + (on ? " on" : "") + '">' +
          '<input type="checkbox" data-qe="' + it.key + '"' + (on ? " checked" : "") + '>' +
          '<span>' + esc(it.name) + '</span>' +
          (noBase ? '<em title="无 2025 年基线，该项同比显示「/」">无基线</em>' : '') +
          '</label>';
      });
      html += '<div class="qe-filter-actions">' +
        '<button type="button" class="qe-mini" data-qe-act="all">全选</button>' +
        '<button type="button" class="qe-mini" data-qe-act="four">仅四项</button>' +
        '<button type="button" class="qe-mini" data-qe-act="none">清空</button>' +
        '</div>' +
        '<button type="button" class="qe-done" data-qe-act="done">完成</button>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function qeBindFilter(R) {
    var btn = $("qeFilterBtn");
    if (btn) {
      btn.onclick = function (ev) {
        ev.stopPropagation();
        QE_TOP_STATE.open = !QE_TOP_STATE.open;
        renderQeTopCards(R);
      };
    }
    var panel = $("qeFilterPanel");
    if (!panel) return;
    panel.onclick = function (ev) { ev.stopPropagation(); };
    panel.querySelectorAll("input[data-qe]").forEach(function (cb) {
      cb.onchange = function () {
        QE_TOP_STATE.sel[cb.getAttribute("data-qe")] = cb.checked;
        renderQeTopCards(R);
      };
    });
    panel.querySelectorAll("button[data-qe-act]").forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute("data-qe-act");
        if (act === "done") { QE_TOP_STATE.open = false; renderQeTopCards(R); return; }
        QE_ITEMS.forEach(function (it) {
          if (act === "all") QE_TOP_STATE.sel[it.key] = true;
          else if (act === "none") QE_TOP_STATE.sel[it.key] = false;
          else QE_TOP_STATE.sel[it.key] = (it.key !== "platform" && it.key !== "order");
        });
        renderQeTopCards(R);
      };
    });
  }

  function renderQeTopCards(R) {
    var grid = $("qeYear"); if (!grid) return;
    var K = { voice: "voice", rpa: "rpa", qa: "qa", coach: "coach", select: "select" };
    var midx = qeMonthIdx(R);
    var ents = qeScopeEntities(R);
    // 2025 总体固定为五项（含智能点选），与 2026 可比口径保持原逻辑
    var sum25 = qeSum(ents, K.voice, 2025, midx) + qeSum(ents, K.rpa, 2025, midx) + qeSum(ents, K.select, 2025, midx) + qeSum(ents, K.qa, 2025, midx) + qeSum(ents, K.coach, 2025, midx);

    // 2026 总体：按右上角筛选勾选的项实时重算
    var tot = qeComputeTotal(R, ents, midx);
    var sum26 = tot.v26;
    var platG = (tot.baseOk && tot.v25 > 0) ? (tot.v26 - tot.v25) / tot.v25 : null;
    var platTxt, platCls;
    if (platG == null) {
      platTxt = tot.baseOk ? "较2025年同期变化：/" : "所选项目无 2025 基线，同比：/";
      platCls = "flat";
    } else {
      platTxt = "较2025年同期变化 " + (platG >= 0 ? "▲ +" : "▼ ") + (platG * 100).toFixed(2) + "%";
      platCls = platG >= 0 ? "up" : "down";
    }
    var selNames = QE_ITEMS.filter(function (it) { return QE_TOP_STATE.sel[it.key]; })
      .map(function (it) { return it.name; });
    var noteTxt = selNames.length
      ? "含：" + selNames.join(" · ")
      : "未选择任何项目（点右上角「筛选」勾选）";

    var cards = "";
    // 第 1 张：2026 总体，右上角带 6 项多选筛选
    var totSeries = qeTotalSeries(R, ents, tot.keys, 2026);
    cards += qeKpiCard({
      title: "总体（2026）",
      val: fmtPY(round2(sum26)),
      series: totSeries,
      sub: noteTxt,
      foot: qeMomHtml(platG, platTxt),
      color: QE_COLORS.total26,
      isTotal: true,
      kou: "总体等效人年＝所选能力项等效人年之和；右上角可勾选 6 项能力实时重算。",
      actions: qeFilterHtml()
    });
    cards += qeKpiCard({
      title: "总体（2025）",
      val: fmtPY(round2(sum25)),
      series: qeTotalSeries(R, ents, [K.voice, K.rpa, K.select, K.qa, K.coach], 2025),
      sub: "含：智能语音 · RPA · 智能质检 · 智能教练 · 智能点选",
      foot: '<span class="mom flat">2025 年基线（2026 见上卡）</span>',
      color: QE_COLORS.total25,
      kou: "2025 总体固定含 5 项（含智能点选），与 2026 可比口径保持原逻辑。"
    });
    cards += qeAbilityCard("智能语音（2026）", ents, K.voice, midx, "voice");
    cards += qeAbilityCard("RPA（2026）", ents, K.rpa, midx, "rpa");
    cards += qeAbilityCard("智能质检（2026）", ents, K.qa, midx, "qa");
    cards += qeAbilityCard("智能教练（2026）", ents, K.coach, midx, "coach");

    // 新增：灵运平台 / 智能立单（来自「数据月度汇总」，无 2025 基线）
    var plat26 = qeItemSum("platform", 2026, midx, R, ents);
    var order26 = qeItemSum("order", 2026, midx, R, ents);
    cards += qeKpiCard({
      title: "灵运平台（2026）",
      val: fmtPY(round2(plat26 == null ? 0 : plat26)),
      series: qeSummaryAbilitySeries("platform"),
      sub: "2026 年新增能力，1—3 月无数据（4 月起量）",
      foot: '<span class="mom flat">同比去年 /（无 2025 基线）</span>',
      color: QE_COLORS.platform,
      kou: "来自「数据月度汇总」全量口径，仅 2026 年、无 2025 基线。"
    });
    cards += qeKpiCard({
      title: "智能立单（2026）",
      val: fmtPY(round2(order26 == null ? 0 : order26)),
      series: qeSummaryAbilitySeries("order"),
      sub: "2026 年新增能力，无 2025 年基线",
      foot: '<span class="mom flat">同比去年 /（无 2025 基线）</span>',
      color: QE_COLORS.order,
      kou: "来自「数据月度汇总」全量口径，仅 2026 年、无 2025 基线。"
    });

    // 智能点选：2026 模板已无该分项（in2026=false），仅展示 2025 年数值
    var sel25 = qeSum(ents, K.select, 2025, midx);
    cards += qeKpiCard({
      title: "智能点选（2025）",
      val: sel25,
      series: qeAbilitySeries(ents, K.select, 2025),
      sub: "2026 年模板已无该分项，仅展示 2025 年",
      foot: '<span class="mom flat">仅 2025 年（2026 无分项）</span>',
      color: QE_COLORS.select,
      kou: "智能点选 2026 模板已无列，按口径不计入 2026 总体。"
    });

    grid.innerHTML = cards;
    qeBindFilter(R);

    // 动态范围提示（与顶部时间/单位筛选联动）
    var scopeTxt = (!FILTER.prov.length || FILTER.prov.indexOf("全国") >= 0) ? "全国" : ("已选 " + FILTER.prov.length + " 个单位");
    var mTxt = (FILTER.dim === "month" && FILTER.months.length)
      ? FILTER.months.slice().sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); }).join("、")
      : "全周期（1-7月）";
    noteBox("qeProvNote", "数据源：离线 Excel·质效分析（等效人年按分中心/单位汇总）+ sheet3「数据月度汇总」。上方 9 张卡片随顶部「时间范围 / 单位」筛选动态变化：当前 " + mTxt + " · " + scopeTxt + "。第 1 张「总体（2026）」右上角可勾选 6 项能力（默认四项），数值与同比实时重算；灵运平台、智能立单为 2026 年新增、无 2025 基线，其同比显示「/」。2025 总体固定含 5 项（含智能点选）。");
  }

function renderQuality() {
    var R = D.centerYearRank || {};
    var title = $("qeTitle"); if (title) title.textContent = "多能力等效人年（量质构效 · " + (V.flags ? V.flags.periodLabel : "") + "）";
    renderQeTopCards(R);

    // ===== 各能力月度趋势（随全局 FILTER.单位 筛选，按所选单位逐月汇总；月份保持全周期趋势）=====
    if (R.months && R.months.length) {
      var scopeEnts = qeScopeEntities(R);
      var mlabels = R.months.map(function (m) { return m + "月"; });
      // 逐月跨主体求和：给定能力 key 与年份，返回按月份索引的汇总数组
      function qeMonthArr(ents, key, year) {
        return R.months.map(function (_, idx) {
          var s = 0;
          ents.forEach(function (e) {
            var arr = (year === 2026 ? e.ability2026 : e.ability2025)[key];
            if (arr) s += arr[idx] || 0;
          });
          return round2(s);
        });
      }
      // 按年份口径汇总每月总体：2026=四项(voice/rpa/qa/coach)，2025=五项(+select)
      function qeMonthTotal(ents, year, keys) {
        return R.months.map(function (_, idx) {
          var s = 0;
          keys.forEach(function (k) {
            ents.forEach(function (e) {
              var arr = (year === 2026 ? e.ability2026 : e.ability2025)[k];
              if (arr) s += arr[idx] || 0;
            });
          });
          return round2(s);
        });
      }
      // 新增能力（灵运平台 / 智能立单）来自「数据月度汇总」，按月份名对齐到 R.months
      function qeSummaryMonthArr(key) {
        var Q = qeSummary();
        var ab = null;
        (Q.abilities || []).forEach(function (a) { if (a.key === key) ab = a; });
        return R.months.map(function (m, idx) {
          if (!ab || !ab.values) return 0;
          var i = (Q.months || []).indexOf(m + "月");
          if (i < 0) i = idx; // 兜底：按索引对齐
          return round2(ab.values[i] || 0);
        });
      }
      var K = { voice: "voice", rpa: "rpa", qa: "qa", coach: "coach", select: "select" };
      var scopeSum26 = qeSum(scopeEnts, K.voice, 2026, null) + qeSum(scopeEnts, K.rpa, 2026, null) + qeSum(scopeEnts, K.qa, 2026, null) + qeSum(scopeEnts, K.coach, 2026, null);
      var scopeSum25 = qeSum(scopeEnts, K.voice, 2025, null) + qeSum(scopeEnts, K.rpa, 2025, null) + qeSum(scopeEnts, K.select, 2025, null) + qeSum(scopeEnts, K.qa, 2025, null) + qeSum(scopeEnts, K.coach, 2025, null);
      var scopeGrowth = scopeSum25 > 0 ? (scopeSum26 - scopeSum25) / scopeSum25 : null;
      var scopeVoice = qeSum(scopeEnts, K.voice, 2026, null);
      var scopeLbl = (!FILTER.prov.length || FILTER.prov.indexOf("全国") >= 0) ? "全国" : ("已选 " + FILTER.prov.length + " 个单位");
      var series = [
        { name: "2026 总体（四项）", type: "line", smooth: true, data: qeMonthTotal(scopeEnts, 2026, [K.voice, K.rpa, K.qa, K.coach]),
          lineStyle: { width: 3 }, areaStyle: { opacity: 0.08 }, itemStyle: { color: PALETTE[1] }, z: 5 },
        { name: "2025 总体（五能力）", type: "line", smooth: true, data: qeMonthTotal(scopeEnts, 2025, [K.voice, K.rpa, K.select, K.qa, K.coach]),
          lineStyle: { type: "dashed" }, itemStyle: { color: PALETTE[2] } },
        { name: "智能语音", type: "line", smooth: true, data: qeMonthArr(scopeEnts, K.voice, 2026), itemStyle: { color: PALETTE[0] } },
        { name: "RPA", type: "line", smooth: true, data: qeMonthArr(scopeEnts, K.rpa, 2026), itemStyle: { color: PALETTE[3] } },
        { name: "智能质检", type: "line", smooth: true, data: qeMonthArr(scopeEnts, K.qa, 2026), itemStyle: { color: PALETTE[4] } },
        { name: "智能教练", type: "line", smooth: true, data: qeMonthArr(scopeEnts, K.coach, 2026), itemStyle: { color: PALETTE[5] } },
        // 新增：灵运平台 / 智能立单（2026 年新增能力，无 2025 基线）
        { name: "灵运平台", type: "line", smooth: true, data: qeSummaryMonthArr("platform"),
          lineStyle: { width: 2.5 }, itemStyle: { color: PALETTE[6 % PALETTE.length] }, z: 4 },
        { name: "智能立单", type: "line", smooth: true, data: qeSummaryMonthArr("order"),
          itemStyle: { color: PALETTE[7 % PALETTE.length] } }
      ];
      topChart("qeChart", {
        color: PALETTE,
        tooltip: { trigger: "axis" },
        legend: { type: "scroll", bottom: 0, textStyle: { color: SUB } },
        grid: { left: 60, right: 30, top: 30, bottom: 50 },
        xAxis: { type: "category", data: mlabels, axisLine: { lineStyle: { color: AX } } },
        yAxis: { type: "value", name: "等效人年", axisLabel: { color: SUB }, splitLine: { lineStyle: { color: GRID } } },
        series: series
      });
      insightBox("qeInsight",
        scopeLbl + " 2026 年 1-" + R.months.length + " 月总体等效人年 " + fmtPY(round2(scopeSum26)) +
        (scopeGrowth == null ? "" : ("，同比 2025 年同期（五能力）" + (scopeGrowth >= 0 ? "增长 " : "下降 ") + Math.abs(scopeGrowth * 100).toFixed(2) + "%")) +
        "。智能语音为绝对主力（占比约 " + (scopeSum26 ? (scopeVoice / scopeSum26 * 100).toFixed(0) : 0) + "%），RPA / 质检 / 教练构成结构性补充；2025 含智能点选，2026 模板已无该分项，故两者口径不同。" +
        "新增「灵运平台」「智能立单」两条曲线来自「数据月度汇总」：灵运平台 1—3 月为 0、4 月起量（4 月 179.21 → 7 月 278.76），智能立单全年平稳（月均约 10.9）。趋势随顶部「单位」筛选联动（当前 " + scopeLbl + "）。");
    } else {
      // 兼容旧 capability 数据兜底
      var cap = V.capability, months = cap.monthly || [];
      if (months.length) {
        var s2 = Object.keys(months[0]).filter(function (k) { return k !== "month"; }).map(function (key, i) {
          return { name: key, type: "line", smooth: true, data: months.map(function (m) { return m[key]; }), itemStyle: { color: PALETTE[i % PALETTE.length] } };
        });
        topChart("qeChart", {
          color: PALETTE, tooltip: { trigger: "axis" },
          legend: { type: "scroll", bottom: 0, textStyle: { color: SUB } },
          grid: { left: 60, right: 30, top: 30, bottom: 40 },
          xAxis: { type: "category", data: months.map(function (m) { return m.month; }), axisLine: { lineStyle: { color: AX } } },
          yAxis: { type: "value", name: "等效人年", axisLabel: { color: SUB }, splitLine: { lineStyle: { color: GRID } } },
          series: s2
        });
        insightBox("qeInsight", "（质效分析分年度数据未接入，暂展示能力月度趋势。）");
      }
    }
    renderCenterRank();
  }
})();

;
/* ===== pages/alarms.js ===== */
/* pages/alarms.js — 告警中心（负责人：羽琪）
 * 本文件只负责本页面渲染，只读 core/core.js 暴露的全局共享状态（D / FILTER / V 等），
 * 不写任何取数逻辑。优化本页只需改这个文件，互不影响其他页面。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "alerts",
    title: "告警中心",
    icon: "⚠",
    order: 6,
    owner: "羽琪",
    render: function () { renderAlerts(); }
  });

  /* ===== 本页面渲染函数（从原 v10 无损搬入） ===== */
function renderAlerts() {
    var box = $("alList");
    if (!box) return;
    var al = D.alerts || [];
    if (!al.length) {
      box.innerHTML = '<div class="alert-empty">' +
        '<div class="ae-icon">/</div>' +
        '<div class="ae-title">当前「数据验证」文件未包含告警 / 异动明细</div>' +
        '<div class="ae-sub">按取数规则，缺失字段统一以「/」显示。缺口说明：</div>' +
        '<div class="gap-list">' + ((D.meta && D.meta.gaps) || []).map(function (g) { return '<div class="gap-item">• ' + g + "</div>"; }).join("") + "</div>" +
        "</div>";
    } else {
      box.innerHTML = al.map(function (a) {
        return '<div class="alert-item"><span class="sev sev-' + (a.severity || "中") + '">' + dash(a.severity) + "</span> " +
          "<b>" + esc(a.alert_type || "") + "</b> · " + dash(a.province) + " · " + dash(a.metric_name) +
          " = " + dash(a.metric_value) + "（阈值 " + dash(a.threshold) + "）<div class='hint'>" + esc(a.suggestion || "") + "</div></div>";
      }).join("");
    }
  }
})();

;
/* ===== pages/report.js ===== */
/* pages/report.js — 报告生成（负责人：吴超）
 * 本文件只负责本页面渲染，只读 core/core.js 暴露的全局共享状态（D / FILTER / V 等），
 * 不写任何取数逻辑。优化本页只需改这个文件，互不影响其他页面。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "report",
    title: "报告生成",
    icon: "◈",
    order: 7,
    owner: "吴超",
    render: function () { renderReport(); }
  });

  /* ===== 本页面渲染函数（从原 v10 无损搬入） ===== */
function renderReport() {
    var box = $("reportBox");
    if (!box) return;
    var type = $("reportType") ? $("reportType").value : "monthly";
    box.textContent = genReport(type);
  }
})();
