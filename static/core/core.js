/* core/core.js — 灵运 BI 看板·共享内核（全局脚本）
 * 由 build/split.py 从 lingyun.app.v10.js 自动拆分生成，请勿手工搬动页面渲染函数。
 * 职责：共享状态(D/FILTER/V)、工具函数、金山文档取数管线、tab 注册表与分发。
 * 页面渲染函数全部位于 static/pages/*.js，通过 window.registerPage 注册。
 */
/* v20260817.0 页面级筛选 + 页面级数据源，各 Tab 互不干扰 */
/* 灵运平台 BI 看板 · 渲染逻辑（真实数据·金山文档「数据验证」）
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

  /* ---------- 数据源：本地上传 / 金山文档（保留原逻辑，重置筛选） ---------- */
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
    if ($("btnCopyLink")) $("btnCopyLink").onclick = function () {
      var u = (D.meta && D.meta.fileUrl) || "";
      if (u && navigator.clipboard) { navigator.clipboard.writeText(u).then(function () { showUploadMsg("✅ 已复制文档链接", false); }, function () { showUploadMsg("复制失败，请手动复制：" + u, true); }); }
      else if (u) { showUploadMsg("链接：" + u, false); }
    };
    if ($("kdMeta")) { var m = D.meta || {}; $("kdMeta").textContent = "数据截至 " + (m.period || "—") + " · 生成于 " + (m.generatedAt || "—"); }
    if ($("srcLink")) $("srcLink").href = (D.meta && D.meta.fileUrl) || "#";
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
            '<button class="seg-btn' + (srcType === "kdoc" ? " active" : "") + '" id="srcKdoc-' + tab + '" type="button">金山文档</button></div>' +
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
            '<div class="src-line">金山文档 · <b>' + docName + '</b></div>' +
            '<a class="src-link" id="srcLink-' + tab + '" href="' + (m.fileUrl || "#") + '" target="_blank" rel="noopener">打开在线文件 ↗</a>' +
            '<div class="kd-status"><span class="kd-dot"></span>已连接 · 维护端同步</div>' +
            '<div class="btn-row"><button class="btn btn-ghost" id="btnCopyLink-' + tab + '" type="button">复制文档链接</button>' +
              '<button class="btn btn-ghost" id="btnRefresh-' + tab + '" type="button">重新渲染</button></div>' +
            '<div class="hint">更新在线文件后，由维护端重新取数部署；部署后点「重新渲染」生效。</div>' +
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
      var u = (D.meta && D.meta.fileUrl) || "";
      if (u && navigator.clipboard) { navigator.clipboard.writeText(u).then(function () { showUploadMsgForTab(tab, "✅ 已复制文档链接", false); }, function () { showUploadMsgForTab(tab, "复制失败，请手动复制：" + u, true); }); }
      else if (u) { showUploadMsgForTab(tab, "链接：" + u, false); }
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
            '<button class="seg-btn' + (srcType === "kdoc" ? " active" : "") + '" id="srcKdoc-' + tab + '" type="button">金山文档</button></div>' +
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
            '<div class="src-line">金山文档 · <b>平台分析</b></div>' +
            '<a class="src-link" id="srcLink-' + tab + '" href="' + (pt.fileUrl || "#") + '" target="_blank" rel="noopener">打开在线文件 ↗</a>' +
            '<div class="kd-status"><span class="kd-dot"></span>已连接 · 周度埋点（' + weeks.length + ' 周）</div>' +
            '<div class="btn-row"><button class="btn btn-ghost" id="btnCopyLink-' + tab + '" type="button">复制文档链接</button>' +
              '<button class="btn btn-ghost" id="btnRefresh-' + tab + '" type="button">重新渲染</button></div>' +
            '<div class="hint">更新在线文件后，由维护端重新取数部署；部署后点「重新渲染」生效。</div>' +
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
      var u = pt.fileUrl || "";
      if (u && navigator.clipboard) { navigator.clipboard.writeText(u).then(function () { showUploadMsgForTab(tab, "✅ 已复制文档链接", false); }, function () { showUploadMsgForTab(tab, "复制失败，请手动复制：" + u, true); }); }
      else if (u) { showUploadMsgForTab(tab, "链接：" + u, false); }
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

