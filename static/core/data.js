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
