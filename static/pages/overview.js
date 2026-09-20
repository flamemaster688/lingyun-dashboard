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
