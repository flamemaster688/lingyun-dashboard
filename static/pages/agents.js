/* pages/agents.js — 智能体（负责人：羽琪）
 * 交付红线：只改本文件；不改 core/、index.html、style.v6.css、data.js 或其他页面。
 * 数据红线：只通过 LY.data / V 读取数据，不 fetch、不直连 Excel、不引第三方库。
 * 目标数据契约：『【智能体】灵运BI重要数据模拟-v2.xlsx』→ 智能体清单（各省）。
 * 推荐正式域名：agentMonthly；兼容顶层 agents 及中文原始表头。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "agents", title: "智能体", icon: "◎", order: 2, owner: "羽琪",
    render: function () { renderAgents(); }
  });

  var state = {
    month: "", province: "ALL", type: "ALL",
    focus: "hot", caseType: "promo",
    detailKw: "", detailStatus: "ALL", detailSort: "calls"
  };
  var cache = null;
  var built = false;
  var unified = false;
  var charts = {};

  function byId(id) { return document.getElementById(id); }
  function val(v) { return v == null ? "" : String(v).trim(); }
  function num(v) {
    if (v == null || v === "" || v === "/" || v === "暂无数据") return null;
    var n = Number(String(v).replace(/,/g, "").replace(/%/g, ""));
    return isFinite(n) ? n : null;
  }
  function flag(v) { return v === true || v === 1 || v === "1" || v === "是" || v === "Y" || v === "true"; }
  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) if (o && o[keys[i]] != null && o[keys[i]] !== "") return o[keys[i]];
    return null;
  }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>\"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtInt2(n) { return n == null || isNaN(n) ? "/" : Math.round(n).toLocaleString("zh-CN"); }
  function fmtWan2(n) {
    if (n == null || isNaN(n)) return "/";
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + "亿";
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + "万";
    return fmtInt2(n);
  }
  function fmtPct2(n) { return n == null || !isFinite(n) ? "/" : (n * 100).toFixed(1) + "%"; }
  function deltaSpan(n, text) {
    var color = n > 0 ? "#d94b45" : n < 0 ? "#198f62" : "#64748b";
    return '<span style="color:' + color + ';font-weight:750">' + text + '</span>';
  }
  function fmtMom(n) {
    if (n == null || !isFinite(n)) return "无上月可比";
    return "环比 " + deltaSpan(n, (n >= 0 ? "+" : "") + n.toFixed(1) + "%");
  }
  function monthNo(m) { var x = parseInt(String(m || "").replace(/[^0-9]/g, ""), 10); return isFinite(x) ? x : 99; }
  function ratio(v) { var n = num(v); return n == null ? null : (n > 1 ? n / 100 : n); }

  function normalizeRow(r) {
    var calls = num(pick(r, ["calls", "应用调用量", "月调用量", "J"])); calls = calls == null ? 0 : calls;
    var eff = ratio(pick(r, ["effRatio", "提效比率", "X"]));
    var success = ratio(pick(r, ["success", "应用成功率", "AB"]));
    var response = num(pick(r, ["response", "resp", "respSec", "应用平均响应耗时", "AC"]));
    var status = val(pick(r, ["status", "应用状态", "I"]));
    var type = val(pick(r, ["type", "应用类型", "G"])) || "其他";
    var row = {
      month: val(pick(r, ["month", "月份", "A"])),
      province: val(pick(r, ["province", "省份", "B"])) || "未标注",
      creator: val(pick(r, ["creator", "创建人", "C"])),
      createdAt: val(pick(r, ["createdAt", "创建时间", "D"])),
      name: val(pick(r, ["name", "应用名称", "E"])),
      description: val(pick(r, ["description", "应用说明", "F"])),
      type: type,
      tags: val(pick(r, ["tags", "应用标签", "H"])),
      status: status || "未标注",
      calls: calls,
      effRatio: eff,
      copy: num(pick(r, ["copy", "复制量", "Z"])) || 0,
      success: success,
      response: response,
      isLLM: flag(pick(r, ["isLLM", "是否使用大模型", "AA"])),
      isPromo: flag(pick(r, ["isPromo", "是否推广智能体", "U"])),
      isExcellent: flag(pick(r, ["isExcellent", "isExc", "是否优秀智能体", "V"])),
      isBiweek: flag(pick(r, ["isBiweek", "是否双周优秀智能体", "W"]))
    };
    row.isOnline = row.status !== "已下线";
    row.isActive = calls > 1000;
    row.isHot = calls > 100000;
    row.isHighEff = row.isActive && eff != null && eff > 0.30;
    row.key = [row.province, row.creator, row.name].join("|");
    return row;
  }

  function sourceRows() {
    if (cache) return cache;
    var src = null;
    if (window.LY && LY.data && typeof LY.data.domain === "function") src = LY.data.domain("agentMonthly");
    if (!Array.isArray(src) && window.V && Array.isArray(V.agentMonthly)) src = V.agentMonthly;
    if (!Array.isArray(src) && window.V && Array.isArray(V.agents)) src = V.agents;
    cache = (Array.isArray(src) ? src : []).map(normalizeRow).filter(function (r) { return r.month && r.name; });
    return cache;
  }
  function months() {
    var seen = {}, out = [];
    sourceRows().forEach(function (r) { if (!seen[r.month]) { seen[r.month] = 1; out.push(r.month); } });
    return out.sort(function (a, b) { return monthNo(a) - monthNo(b); });
  }
  function provinces() {
    var seen = {}, out = [];
    sourceRows().forEach(function (r) { if (!seen[r.province]) { seen[r.province] = 1; out.push(r.province); } });
    return out.sort(function (a, b) { return a.localeCompare(b, "zh-CN"); });
  }
  function typesFor(month, province) {
    var seen = {}, out = [];
    sourceRows().forEach(function (r) {
      if (r.month !== month || (province !== "ALL" && r.province !== province)) return;
      if (!seen[r.type]) { seen[r.type] = 1; out.push(r.type); }
    });
    var order = { "智能体": 1, "工作流": 2, "对话流": 3, "其他": 9 };
    return out.sort(function (a, b) { return (order[a] || 8) - (order[b] || 8); });
  }
  function scoped(options) {
    options = options || {};
    var month = options.allMonths ? null : (options.month || state.month);
    var province = options.ignoreProvince ? "ALL" : (options.province || state.province);
    var type = options.ignoreType ? "ALL" : (options.type || state.type);
    return sourceRows().filter(function (r) {
      return (!month || r.month === month) &&
        (province === "ALL" || r.province === province) &&
        (type === "ALL" || r.type === type);
    });
  }
  function uniqueRows(list) {
    /* v2 暂无稳定应用 ID；同名、同省、同创建人仍可能是不同资产，不能擅自合并。 */
    return list.slice();
  }
  function stats(list) {
    var rows = uniqueRows(list), calls = 0, online = 0, active = 0, hot = 0, highEff = 0;
    rows.forEach(function (r) {
      calls += r.calls || 0;
      if (r.isOnline) online++;
      if (r.isActive) active++;
      if (r.isHot) hot++;
      if (r.isHighEff) highEff++;
    });
    return { rows: rows, calls: calls, online: online, active: active, hot: hot, highEff: highEff };
  }
  function previousMonth() {
    var mm = months(), idx = mm.indexOf(state.month); return idx > 0 ? mm[idx - 1] : null;
  }
  function mom(cur, prev) { return prev ? (cur - prev) / Math.abs(prev) * 100 : null; }
  function diffText(cur, prev) {
    if (prev == null) return "无上月可比";
    var delta = cur - prev;
    return "较上月 " + deltaSpan(delta, (delta >= 0 ? "+" : "") + fmtInt2(delta));
  }

  function draw(id, option) {
    var el = byId(id); if (!el || !window.echarts) return null;
    if (charts[id]) { try { charts[id].dispose(); } catch (e) {} }
    var c = echarts.init(el); c.setOption(option, true); charts[id] = c; return c;
  }
  function chartBase() {
    return {
      textStyle: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', color: "#334155" },
      animationDuration: 500
    };
  }
  function merge(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }

  function ensureRoot() {
    var root = byId("agRoot");
    if (root) return root;
    var panel = byId("panel-agents");
    if (!panel) return null;
    var header = panel.querySelector(".page-header");
    Array.prototype.slice.call(panel.children).forEach(function (child) {
      if (child !== header) panel.removeChild(child);
    });
    if (header) {
      var title = header.querySelector(".section-title");
      if (title) title.textContent = "智能体运营分析";
    }
    root = document.createElement("div");
    root.id = "agRoot";
    panel.appendChild(root);
    return root;
  }

  function buildShell() {
    var root = ensureRoot(); if (!root || built) return;
    built = true;
    unified = !!(document.querySelector && document.querySelector('.page-toolbar[data-tab="agents"] .page-filter-bar'));
    var scopeControls = unified
      ? '<div style="color:#64748b;font-size:12px">月份与省份继承顶部全局筛选；本页仅补充应用形态与明细筛选。</div>'
      : '<div class="filter-group"><span class="filter-label">月份</span><select id="agMonth" style="height:34px;min-width:106px;border:1px solid #b9c8da;border-radius:8px;background:#fff;padding:0 10px;color:#1f355e;font-weight:650"></select></div>' +
        '<div class="filter-group"><span class="filter-label">省份</span><select id="agProvince" style="height:34px;min-width:120px;border:1px solid #b9c8da;border-radius:8px;background:#fff;padding:0 10px;color:#1f355e;font-weight:650"></select></div>' +
        '<button type="button" id="agReset" style="height:34px;border:1px solid #b9c8da;border-radius:8px;background:#f8fafc;color:#476078;padding:0 14px;cursor:pointer">重置</button>';
    root.innerHTML =
      '<div class="page-filter-bar" style="margin-bottom:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        scopeControls +
        '<div id="agScope" style="margin-left:auto;color:#64748b;font-size:12px"></div>' +
      '</div>' +

      '<div class="block" style="border-top:none;padding-top:0;margin-top:0">' +
        '<div class="block-title">当月经营驾驶舱</div>' +
        '<div class="kpi-grid" id="agKpis" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:14px"></div>' +
        '<div class="row-2" style="margin-top:16px">' +
          '<div class="chart-card"><div class="ct">调用量应用形态构成</div><div id="agTypeSeg" style="display:flex;gap:7px;flex-wrap:wrap;margin:4px 4px 8px"></div><div class="chart" id="agTypeDonut" style="height:330px"></div><div style="font-size:11px;color:#7b8795;margin-top:4px">点击分类会更新本月指标、案例、清单和下方明细；圆环保留全量结构作为参照。</div></div>' +
          '<div class="chart-card"><div class="ct">重点案例运行表现</div><div class="chart" id="agCaseStack" style="height:372px"></div><div style="font-size:11px;color:#7b8795;margin-top:4px">推广、优秀、双周优秀标签允许交叉，三类数量不可直接相加。</div></div>' +
        '</div>' +
        '<div style="margin-top:16px;border:1px solid #dde5ee;border-radius:10px;background:#fff;padding:15px 16px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><b style="color:#223a57">当月运营关注</b><div id="agFocusTabs" style="display:flex;gap:7px;flex-wrap:wrap"></div><span id="agFocusCount" style="margin-left:auto;color:#64748b;font-size:12px"></span></div>' +
          '<div style="overflow:auto;max-height:390px"><table class="tbl" id="agFocusTable"></table></div>' +
        '</div>' +
      '</div>' +

      '<div class="block"><div class="block-title">全网 1—6月整体趋势 <span style="font-size:12px;font-weight:500;color:#64748b">固定全网口径，不受省份/类型筛选；月份仅高亮</span></div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px">' +
          '<div class="chart-card"><div class="ct">平台规模：调用量与活跃智能体</div><div class="chart" id="agTrendScale" style="height:320px"></div></div>' +
          '<div class="chart-card"><div class="ct">重点运营层级：高热度与活跃高提效</div><div class="chart" id="agTrendQuality" style="height:320px"></div></div>' +
          '<div class="chart-card"><div class="ct">案例活跃率趋势</div><div class="chart" id="agTrendCase" style="height:320px"></div></div>' +
        '</div>' +
      '</div>' +

      '<div class="block"><div class="block-title" id="agProvinceTitle">省份整体概览</div>' +
        '<div class="row-2"><div class="chart-card"><div class="ct" id="agProvinceChartTitle">省份调用量 TOP10</div><div class="chart" id="agProvinceChart" style="height:340px"></div></div>' +
        '<div class="chart-card"><div class="ct" id="agProvinceTableTitle">省份运营简表</div><div style="overflow:auto;max-height:340px"><table class="tbl" id="agProvinceTable"></table></div></div></div>' +
      '</div>' +

      '<div class="block" id="agCaseDetailBlock"><div class="block-title">案例运营明细</div>' +
        '<div id="agCaseTabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>' +
        '<div class="kpi-grid" id="agCaseKpis" style="grid-template-columns:repeat(6,minmax(0,1fr));gap:12px"></div>' +
        '<div id="agCaseOverlap" style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0"></div>' +
        '<div class="row-2">' +
          '<div class="chart-card"><div class="ct">案例省份覆盖 TOP10</div><div class="chart" id="agCaseProvince" style="height:330px"></div></div>' +
          '<div class="chart-card"><div class="ct">案例提效分布</div><div class="chart" id="agCaseEfficiency" style="height:330px"></div></div>' +
        '</div>' +
        '<div style="margin-top:14px;overflow:auto;max-height:480px"><table class="tbl" id="agCaseTable"></table></div>' +
      '</div>' +

      '<div class="block"><div class="block-title">应用查询与完整明细</div>' +
        '<div class="page-filter-bar" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<div class="filter-group"><span class="filter-label">名称</span><input id="agDetailKw" placeholder="应用名称/创建人" style="height:34px;width:230px;border:1px solid #b9c8da;border-radius:8px;padding:0 10px"/></div>' +
          '<div class="filter-group"><span class="filter-label">状态</span><select id="agDetailStatus" style="height:34px;border:1px solid #b9c8da;border-radius:8px;padding:0 10px"><option value="ALL">全部</option><option value="ONLINE">已上线</option><option value="ACTIVE">活跃</option><option value="HOT">高热度</option><option value="HIGHEFF">活跃且高提效</option><option value="CASE">重点案例</option></select></div>' +
          '<div class="filter-group"><span class="filter-label">排序</span><select id="agDetailSort" style="height:34px;border:1px solid #b9c8da;border-radius:8px;padding:0 10px"><option value="calls">调用量</option><option value="eff">提效比率</option><option value="copy">复制量</option><option value="success">成功率</option></select></div>' +
          '<span id="agDetailCount" style="margin-left:auto;color:#64748b;font-size:12px"></span>' +
        '</div>' +
        '<div style="overflow:auto;max-height:520px"><table class="tbl" id="agDetailTable"></table></div>' +
        '<div style="font-size:11px;color:#7b8795;margin-top:8px">名称搜索只影响本明细表，不改变顶部经营指标。</div>' +
      '</div>' +
      '<div id="agDataNote" style="margin:12px 0;color:#64748b;font-size:12px"></div>';
  }

  function pill(active) {
    return 'border:1px solid ' + (active ? '#2f6fed' : '#cbd7e4') + ';background:' + (active ? '#eaf2ff' : '#fff') + ';color:' + (active ? '#1f5ec7' : '#526176') + ';border-radius:16px;padding:5px 11px;cursor:pointer;font-size:12px;font-weight:650';
  }
  function kpiCard(title, value, sub, color) {
    return '<div class="kpi" style="padding:15px 16px;border-top:4px solid ' + color + '"><div class="lb" style="font-size:12px;color:#64748b">' + title + '</div><div class="val" style="font-size:27px;line-height:1.4;color:' + color + '">' + value + '</div><div style="font-size:11px;color:#64748b;min-height:17px">' + sub + '</div></div>';
  }

  function renderControls() {
    var mm = months();
    if (!state.month || mm.indexOf(state.month) < 0) state.month = mm[mm.length - 1] || "";
    if (unified) {
      var globalFilter = window.FILTER || {};
      var selectedMonths = Array.isArray(globalFilter.months) ? globalFilter.months.filter(function (m) { return mm.indexOf(m) >= 0; }) : [];
      if (selectedMonths.length) state.month = selectedMonths[selectedMonths.length - 1];
      state.province = globalFilter.prov && globalFilter.prov !== "全部省份" ? globalFilter.prov : "ALL";
      renderTypeSeg();
      return;
    }
    var monthEl = byId("agMonth"), provEl = byId("agProvince");
    monthEl.innerHTML = mm.map(function (m) { return '<option value="' + escHtml(m) + '">' + escHtml(m) + '</option>'; }).join("");
    monthEl.value = state.month;
    provEl.innerHTML = '<option value="ALL">全国</option>' + provinces().map(function (p) { return '<option value="' + escHtml(p) + '">' + escHtml(p) + '</option>'; }).join("");
    provEl.value = state.province;
    monthEl.onchange = function () { state.month = monthEl.value; state.caseType = "promo"; renderAll(); };
    provEl.onchange = function () { state.province = provEl.value; renderAll(); };
    byId("agReset").onclick = function () {
      state.month = mm[mm.length - 1] || ""; state.province = "ALL"; state.type = "ALL"; state.focus = "hot"; state.caseType = "promo";
      state.detailKw = ""; state.detailStatus = "ALL"; state.detailSort = "calls";
      if (byId("agDetailKw")) byId("agDetailKw").value = "";
      if (byId("agDetailStatus")) byId("agDetailStatus").value = "ALL";
      if (byId("agDetailSort")) byId("agDetailSort").value = "calls";
      renderControls(); renderAll();
    };
    renderTypeSeg();
  }
  function renderTypeSeg() {
    var list = typesFor(state.month, state.province), all = ["ALL"].concat(list);
    byId("agTypeSeg").innerHTML = all.map(function (t) {
      var label = t === "ALL" ? "全部" : t;
      return '<button type="button" data-type="' + escHtml(t) + '" style="' + pill(state.type === t) + '">' + escHtml(label) + '</button>';
    }).join("");
    Array.prototype.forEach.call(byId("agTypeSeg").querySelectorAll("button"), function (b) {
      b.onclick = function () { state.type = b.getAttribute("data-type"); renderTypeSeg(); renderAll(); };
    });
  }

  function renderKpis() {
    var cur = stats(scoped()), pm = previousMonth();
    var prev = pm ? stats(scoped({ month: pm })) : null;
    var activeRate = cur.online ? cur.active / cur.online : null;
    var hotRate = cur.active ? cur.hot / cur.active : null;
    var highRate = cur.active ? cur.highEff / cur.active : null;
    byId("agKpis").innerHTML =
      kpiCard("上线应用总数", fmtInt2(cur.online), diffText(cur.online, prev && prev.online), "#476f9f") +
      kpiCard("月调用量", fmtWan2(cur.calls), fmtMom(mom(cur.calls, prev && prev.calls)), "#2f6fed") +
      kpiCard("活跃智能体", fmtInt2(cur.active), "活跃率 " + fmtPct2(activeRate) + " · " + diffText(cur.active, prev && prev.active), "#16a3a3") +
      kpiCard("高热度智能体", fmtInt2(cur.hot), "占活跃 " + fmtPct2(hotRate) + " · " + diffText(cur.hot, prev && prev.hot), "#7c6fd0") +
      kpiCard("活跃且高提效", fmtInt2(cur.highEff), "占活跃 " + fmtPct2(highRate) + " · " + diffText(cur.highEff, prev && prev.highEff), "#23956b");
    byId("agScope").innerHTML = "当前范围：<b>" + escHtml(state.month) + "｜" + escHtml(state.province === "ALL" ? "全国" : state.province) + "｜" + escHtml(state.type === "ALL" ? "全部应用" : state.type) + "</b>，共 " + fmtInt2(cur.rows.length) + " 个应用";
  }

  function aggregateBy(list, keyFn) {
    var map = {};
    list.forEach(function (r) {
      var k = keyFn(r); if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return map;
  }
  function renderTypeDonut() {
    var base = uniqueRows(scoped({ ignoreType: true })), grouped = aggregateBy(base, function (r) { return r.type; });
    var data = Object.keys(grouped).map(function (k) {
      var s = stats(grouped[k]);
      return { name: k, value: s.calls, apps: s.rows.length, active: s.active, selected: state.type === k };
    }).sort(function (a, b) { return b.value - a.value; });
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    var option = merge(chartBase(), {
      tooltip: { trigger: "item", formatter: function (p) { var d = p.data; return '<b>' + d.name + '</b><br/>调用量：' + fmtInt2(d.value) + '<br/>占比：' + (total ? (d.value / total * 100).toFixed(1) : 0) + '%<br/>应用数：' + fmtInt2(d.apps) + '<br/>活跃数：' + fmtInt2(d.active); } },
      legend: { bottom: 2, icon: "circle" },
      series: [{ type: "pie", radius: ["43%", "70%"], center: ["50%", "45%"], label: { formatter: "{b}\n{d}%", fontSize: 12 },
        itemStyle: { borderColor: "#fff", borderWidth: 3 },
        data: data.map(function (d, i) { return merge(d, { itemStyle: { opacity: state.type === "ALL" || state.type === d.name ? 1 : 0.25, borderColor: d.selected ? "#173e75" : "#fff", borderWidth: d.selected ? 5 : 3 } }); }),
        color: ["#2f6fed", "#20a7a1", "#8b78d7", "#7a8fa8"] }],
      graphic: [{ type: "text", left: "center", top: "38%", style: { text: state.type === "ALL" ? "全部调用\n" + fmtWan2(total) : state.type + "\n" + fmtWan2((data.filter(function (d) { return d.name === state.type; })[0] || {}).value || 0), textAlign: "center", fill: "#27415f", font: "700 16px sans-serif", lineHeight: 23 } }]
    });
    var c = draw("agTypeDonut", option);
    if (c) c.on("click", function (p) { state.type = state.type === p.name ? "ALL" : p.name; renderTypeSeg(); renderAll(); });
  }

  function caseStats(list, kind) {
    var test = kind === "promo" ? function (r) { return r.isPromo; } : kind === "excellent" ? function (r) { return r.isExcellent; } : function (r) { return r.isBiweek; };
    var rows = uniqueRows(list).filter(test), active = rows.filter(function (r) { return r.isActive; }), high = rows.filter(function (r) { return r.isHighEff; });
    var prov = {}; rows.forEach(function (r) { prov[r.province] = 1; });
    return { rows: rows, total: rows.length, active: active.length, high: high.length, coverage: Object.keys(prov).length };
  }
  function renderCaseStack() {
    var list = scoped(), kinds = ["promo", "excellent", "biweek"], names = ["推广案例", "优秀案例", "双周优秀"], all = kinds.map(function (k) { return caseStats(list, k); });
    draw("agCaseStack", merge(chartBase(), {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: function (ps) { var i = ps[0].dataIndex, s = all[i]; return '<b>' + names[i] + '</b><br/>案例总数：' + s.total + '<br/>活跃：' + s.active + '（' + fmtPct2(s.total ? s.active / s.total : null) + '）<br/>活跃且高提效：' + s.high + '（' + fmtPct2(s.total ? s.high / s.total : null) + '）'; } },
      legend: { top: 8 }, grid: { left: 52, right: 22, top: 54, bottom: 42 },
      xAxis: { type: "category", data: names }, yAxis: { type: "value", name: "应用数" },
      series: [
        { name: "未活跃", type: "bar", stack: "case", data: all.map(function (s) { return s.total - s.active; }), itemStyle: { color: "#cbd5e1" } },
        { name: "活跃未高提效", type: "bar", stack: "case", data: all.map(function (s) { return s.active - s.high; }), itemStyle: { color: "#5b8ff9" } },
        { name: "活跃且高提效", type: "bar", stack: "case", data: all.map(function (s) { return s.high; }), itemStyle: { color: "#2fc4b2" }, label: { show: true, position: "top", formatter: function (p) { var s = all[p.dataIndex]; return s.total + "个\n活跃率 " + (s.total ? (s.active / s.total * 100).toFixed(0) : 0) + "%"; }, color: "#334155", lineHeight: 17 } }
      ]
    }));
  }

  function tabButton(key, label, active) { return '<button type="button" data-key="' + key + '" style="' + pill(active) + '">' + label + '</button>'; }
  function renderFocus() {
    var tabs = [{ k: "hot", t: "高热度 TOP10" }, { k: "high", t: "活跃且高提效" }, { k: "promoIdle", t: "推广但未活跃" }, { k: "benchmark", t: "优秀/双周标杆" }];
    byId("agFocusTabs").innerHTML = tabs.map(function (x) { return tabButton(x.k, x.t, state.focus === x.k); }).join("");
    Array.prototype.forEach.call(byId("agFocusTabs").querySelectorAll("button"), function (b) { b.onclick = function () { state.focus = b.getAttribute("data-key"); renderFocus(); }; });
    var rows = uniqueRows(scoped()).filter(function (r) {
      if (state.focus === "hot") return r.isHot;
      if (state.focus === "high") return r.isHighEff;
      if (state.focus === "promoIdle") return r.isPromo && !r.isActive;
      return r.isExcellent || r.isBiweek;
    }).sort(function (a, b) { return b.calls - a.calls; });
    byId("agFocusCount").textContent = "共 " + rows.length + " 个，展示前 10 个";
    byId("agFocusTable").innerHTML = '<thead><tr><th>应用名称</th><th>省份</th><th>形态</th><th class="num">调用量</th><th>活跃</th><th>高热度</th><th>活跃高提效</th><th>案例标签</th><th class="num">成功率</th><th class="num">响应耗时</th></tr></thead><tbody>' +
      rows.slice(0, 10).map(function (r) { return '<tr><td style="text-align:left;max-width:260px;white-space:normal"><b>' + escHtml(r.name) + '</b></td><td>' + escHtml(r.province) + '</td><td>' + escHtml(r.type) + '</td><td class="num">' + fmtInt2(r.calls) + '</td><td>' + (r.isActive ? '是' : '否') + '</td><td>' + (r.isHot ? '是' : '否') + '</td><td>' + (r.isHighEff ? '是' : '否') + '</td><td>' + caseLabels(r) + '</td><td class="num">' + fmtPct2(r.success) + '</td><td class="num">' + (r.response == null ? '/' : r.response.toFixed(2) + '秒') + '</td></tr>'; }).join("") + '</tbody>';
  }
  function caseLabels(r) {
    var a = []; if (r.isPromo) a.push("推广"); if (r.isExcellent) a.push("优秀"); if (r.isBiweek) a.push("双周"); return a.length ? a.join(" / ") : "/";
  }

  function trendMetrics(month) { return stats(sourceRows().filter(function (r) { return r.month === month; })); }
  function trendCaseRate(month, kind) {
    var s = caseStats(sourceRows().filter(function (r) { return r.month === month; }), kind); return s.total ? s.active / s.total : null;
  }
  function itemSeries(values, normal, selected) {
    return values.map(function (v, i) { return { value: v, itemStyle: { color: months()[i] === state.month ? selected : normal } }; });
  }
  function renderTrends() {
    var mm = months(), ss = mm.map(trendMetrics);
    draw("agTrendScale", merge(chartBase(), {
      tooltip: { trigger: "axis" }, legend: { top: 5 }, grid: { left: 58, right: 52, top: 50, bottom: 38 },
      xAxis: { type: "category", data: mm }, yAxis: [{ type: "value", name: "调用量" }, { type: "value", name: "活跃数" }],
      series: [{ name: "调用量", type: "bar", data: itemSeries(ss.map(function (s) { return s.calls; }), "#9ec5ff", "#2f6fed"), barMaxWidth: 30 }, { name: "活跃智能体", type: "line", yAxisIndex: 1, data: ss.map(function (s) { return s.active; }), symbolSize: 7, lineStyle: { width: 3, color: "#16a3a3" }, itemStyle: { color: "#16a3a3" } }]
    }));
    draw("agTrendQuality", merge(chartBase(), {
      tooltip: { trigger: "axis" }, legend: { top: 5 }, grid: { left: 48, right: 24, top: 50, bottom: 38 },
      xAxis: { type: "category", data: mm }, yAxis: { type: "value", name: "应用数" },
      series: [{ name: "高热度", type: "bar", data: itemSeries(ss.map(function (s) { return s.hot; }), "#b9b2e9", "#7c6fd0"), barMaxWidth: 27 }, { name: "活跃且高提效", type: "line", data: ss.map(function (s) { return s.highEff; }), symbolSize: 7, lineStyle: { width: 3, color: "#23956b" }, itemStyle: { color: "#23956b" } }]
    }));
    draw("agTrendCase", merge(chartBase(), {
      tooltip: { trigger: "axis", valueFormatter: function (v) { return v == null ? "/" : (v * 100).toFixed(1) + "%"; } }, legend: { top: 5 }, grid: { left: 52, right: 22, top: 50, bottom: 38 },
      xAxis: { type: "category", data: mm }, yAxis: { type: "value", max: 1, axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + "%"; } } },
      series: [{ name: "推广", type: "line", data: mm.map(function (m) { return trendCaseRate(m, "promo"); }), lineStyle: { width: 3, color: "#2f6fed" }, itemStyle: { color: "#2f6fed" } }, { name: "优秀", type: "line", data: mm.map(function (m) { return trendCaseRate(m, "excellent"); }), lineStyle: { width: 3, color: "#20a7a1" }, itemStyle: { color: "#20a7a1" } }, { name: "双周优秀", type: "line", data: mm.map(function (m) { return trendCaseRate(m, "biweek"); }), lineStyle: { width: 3, color: "#8b78d7" }, itemStyle: { color: "#8b78d7" } }]
    }));
  }

  function provinceGroups() {
    var list = scoped({ ignoreProvince: true }), g = aggregateBy(uniqueRows(list), function (r) { return r.province; });
    return Object.keys(g).map(function (p) { var s = stats(g[p]); return { province: p, rows: s.rows, calls: s.calls, online: s.online, active: s.active, hot: s.hot, highEff: s.highEff, promo: caseStats(g[p], "promo").total, excellent: caseStats(g[p], "excellent").total, biweek: caseStats(g[p], "biweek").total }; }).sort(function (a, b) { return b.calls - a.calls; });
  }
  function renderProvince() {
    var pg = provinceGroups();
    if (state.province === "ALL") {
      byId("agProvinceTitle").textContent = "省份整体概览（简版）"; byId("agProvinceChartTitle").textContent = "省份调用量 TOP10"; byId("agProvinceTableTitle").textContent = "省份运营简表";
      var top = pg.slice(0, 10).reverse();
      draw("agProvinceChart", merge(chartBase(), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, grid: { left: 64, right: 28, top: 20, bottom: 35 }, xAxis: { type: "value" }, yAxis: { type: "category", data: top.map(function (x) { return x.province; }) }, series: [{ type: "bar", data: top.map(function (x) { return x.calls; }), itemStyle: { color: "#5b8ff9", borderRadius: [0, 6, 6, 0] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan2(p.value); } } }] }));
      byId("agProvinceTable").innerHTML = provinceTable(pg.slice(0, 12));
    } else {
      var row = pg.filter(function (x) { return x.province === state.province; })[0] || { rows: [] };
      var apps = (row.rows || []).slice().sort(function (a, b) { return b.calls - a.calls; }).slice(0, 10).reverse();
      byId("agProvinceTitle").textContent = state.province + "运营概览"; byId("agProvinceChartTitle").textContent = state.province + "应用调用量 TOP10"; byId("agProvinceTableTitle").textContent = "运营层级";
      draw("agProvinceChart", merge(chartBase(), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, grid: { left: 150, right: 34, top: 20, bottom: 35 }, xAxis: { type: "value" }, yAxis: { type: "category", data: apps.map(function (x) { return x.name; }), axisLabel: { width: 135, overflow: "truncate" } }, series: [{ type: "bar", data: apps.map(function (x) { return x.calls; }), itemStyle: { color: "#5b8ff9", borderRadius: [0, 6, 6, 0] }, label: { show: true, position: "right", formatter: function (p) { return fmtWan2(p.value); } } }] }));
      var s = stats(row.rows || []), layers = [{ n: "上线应用", v: s.online, r: null }, { n: "活跃", v: s.active, r: s.online ? s.active / s.online : null }, { n: "高热度", v: s.hot, r: s.active ? s.hot / s.active : null }, { n: "活跃且高提效", v: s.highEff, r: s.active ? s.highEff / s.active : null }];
      byId("agProvinceTable").innerHTML = '<thead><tr><th>运营层级</th><th class="num">数量</th><th class="num">转化/占比</th></tr></thead><tbody>' + layers.map(function (x) { return '<tr><td>' + x.n + '</td><td class="num">' + fmtInt2(x.v) + '</td><td class="num">' + fmtPct2(x.r) + '</td></tr>'; }).join("") + '</tbody>';
    }
  }
  function provinceTable(rows) {
    return '<thead><tr><th>省份</th><th class="num">调用量</th><th class="num">上线</th><th class="num">活跃</th><th class="num">活跃率</th><th class="num">高热度</th><th class="num">活跃高提效</th><th class="num">推广</th><th class="num">优秀</th><th class="num">双周</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td><b>' + escHtml(x.province) + '</b></td><td class="num">' + fmtWan2(x.calls) + '</td><td class="num">' + x.online + '</td><td class="num">' + x.active + '</td><td class="num">' + fmtPct2(x.online ? x.active / x.online : null) + '</td><td class="num">' + x.hot + '</td><td class="num">' + x.highEff + '</td><td class="num">' + x.promo + '</td><td class="num">' + x.excellent + '</td><td class="num">' + x.biweek + '</td></tr>'; }).join("") + '</tbody>';
  }

  function renderCaseDetail() {
    var tabs = [{ k: "promo", t: "推广案例" }, { k: "excellent", t: "优秀案例" }, { k: "biweek", t: "双周优秀" }];
    byId("agCaseTabs").innerHTML = tabs.map(function (x) { return tabButton(x.k, x.t, state.caseType === x.k); }).join("");
    Array.prototype.forEach.call(byId("agCaseTabs").querySelectorAll("button"), function (b) { b.onclick = function () { state.caseType = b.getAttribute("data-key"); renderCaseDetail(); }; });
    var list = scoped(), cs = caseStats(list, state.caseType), activeRate = cs.total ? cs.active / cs.total : null, highRate = cs.active ? cs.high / cs.active : null;
    var avgCalls = cs.total ? cs.rows.reduce(function (s, r) { return s + r.calls; }, 0) / cs.total : null;
    byId("agCaseKpis").innerHTML =
      kpiCard("案例总数", fmtInt2(cs.total), "当前筛选范围", "#476f9f") +
      kpiCard("活跃案例", fmtInt2(cs.active), "月调用量 > 1000", "#2f6fed") +
      kpiCard("案例活跃率", fmtPct2(activeRate), "活跃/案例总数", "#16a3a3") +
      kpiCard("活跃且高提效", fmtInt2(cs.high), "调用>1000且提效>30%", "#23956b") +
      kpiCard("活跃高提效率", fmtPct2(highRate), "高提效/活跃案例", "#7c6fd0") +
      kpiCard("覆盖省份", fmtInt2(cs.coverage), "平均调用 " + fmtWan2(avgCalls), "#5b7fa8");
    var allRows = uniqueRows(list), bothPE = allRows.filter(function (r) { return r.isPromo && r.isExcellent; }).length, bothEB = allRows.filter(function (r) { return r.isExcellent && r.isBiweek; }).length, triple = allRows.filter(function (r) { return r.isPromo && r.isExcellent && r.isBiweek; }).length;
    byId("agCaseOverlap").innerHTML = '<span style="padding:7px 12px;border:1px solid #d8e2ed;border-radius:8px;background:#f8fbff;color:#476078">推广 ∩ 优秀：<b>' + bothPE + '</b></span><span style="padding:7px 12px;border:1px solid #d8e2ed;border-radius:8px;background:#f8fbff;color:#476078">优秀 ∩ 双周：<b>' + bothEB + '</b></span><span style="padding:7px 12px;border:1px solid #d8e2ed;border-radius:8px;background:#f8fbff;color:#476078">三类重叠：<b>' + triple + '</b></span>';
    var pg = aggregateBy(cs.rows, function (r) { return r.province; }), pdata = Object.keys(pg).map(function (p) { return { n: p, v: pg[p].length }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10).reverse();
    draw("agCaseProvince", merge(chartBase(), { tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, grid: { left: 62, right: 28, top: 20, bottom: 32 }, xAxis: { type: "value" }, yAxis: { type: "category", data: pdata.map(function (x) { return x.n; }) }, series: [{ type: "bar", data: pdata.map(function (x) { return x.v; }), itemStyle: { color: "#5b8ff9", borderRadius: [0, 6, 6, 0] }, label: { show: true, position: "right" } }] }));
    var bins = [{ n: "未填/0", v: 0 }, { n: "0—30%", v: 0 }, { n: "30—50%", v: 0 }, { n: "50—80%", v: 0 }, { n: "80%以上", v: 0 }];
    cs.rows.forEach(function (r) { var e = r.effRatio; if (e == null || e === 0) bins[0].v++; else if (e <= .3) bins[1].v++; else if (e <= .5) bins[2].v++; else if (e <= .8) bins[3].v++; else bins[4].v++; });
    draw("agCaseEfficiency", merge(chartBase(), { tooltip: { trigger: "item" }, legend: { bottom: 2 }, series: [{ type: "pie", radius: ["38%", "68%"], center: ["50%", "45%"], label: { formatter: "{b}\n{c}个" }, data: bins.map(function (x) { return { name: x.n, value: x.v }; }), color: ["#cbd5e1", "#9fb8d8", "#5b8ff9", "#2fc4b2", "#23956b"] }] }));
    byId("agCaseTable").innerHTML = detailTable(cs.rows.slice().sort(function (a, b) { return b.calls - a.calls; }).slice(0, 100), true);
  }

  function detailTable(rows, caseMode) {
    return '<thead><tr><th>应用名称</th><th>省份</th><th>形态</th><th>状态</th><th class="num">调用量</th><th>活跃</th><th>高热度</th><th>活跃高提效</th><th class="num">提效比率</th><th class="num">成功率</th><th class="num">响应耗时</th><th class="num">复制量</th><th>案例标签</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td style="text-align:left;min-width:210px;max-width:300px;white-space:normal"><b>' + escHtml(r.name) + '</b>' + (caseMode && r.description ? '<div style="font-size:11px;color:#7b8795;margin-top:3px">' + escHtml(r.description.slice(0, 60)) + '</div>' : '') + '</td><td>' + escHtml(r.province) + '</td><td>' + escHtml(r.type) + '</td><td>' + escHtml(r.status) + '</td><td class="num">' + fmtInt2(r.calls) + '</td><td>' + (r.isActive ? '是' : '否') + '</td><td>' + (r.isHot ? '是' : '否') + '</td><td>' + (r.isHighEff ? '是' : '否') + '</td><td class="num">' + fmtPct2(r.effRatio) + '</td><td class="num">' + fmtPct2(r.success) + '</td><td class="num">' + (r.response == null ? '/' : r.response.toFixed(2) + '秒') + '</td><td class="num">' + fmtInt2(r.copy) + '</td><td>' + caseLabels(r) + '</td></tr>'; }).join("") + '</tbody>';
  }

  function renderDetail() {
    var q = state.detailKw.toLowerCase(), rows = uniqueRows(scoped()).filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.creator.toLowerCase().indexOf(q) < 0) return false;
      if (state.detailStatus === "ONLINE" && !r.isOnline) return false;
      if (state.detailStatus === "ACTIVE" && !r.isActive) return false;
      if (state.detailStatus === "HOT" && !r.isHot) return false;
      if (state.detailStatus === "HIGHEFF" && !r.isHighEff) return false;
      if (state.detailStatus === "CASE" && !(r.isPromo || r.isExcellent || r.isBiweek)) return false;
      return true;
    });
    rows.sort(function (a, b) {
      if (state.detailSort === "eff") return (b.effRatio || 0) - (a.effRatio || 0);
      if (state.detailSort === "copy") return b.copy - a.copy;
      if (state.detailSort === "success") return (b.success || 0) - (a.success || 0);
      return b.calls - a.calls;
    });
    byId("agDetailCount").textContent = "匹配 " + rows.length + " 个，展示前 100 个";
    byId("agDetailTable").innerHTML = detailTable(rows.slice(0, 100), false);
  }
  function bindDetailControls() {
    var kw = byId("agDetailKw"), st = byId("agDetailStatus"), so = byId("agDetailSort");
    kw.oninput = function () { state.detailKw = kw.value.trim(); renderDetail(); };
    st.onchange = function () { state.detailStatus = st.value; renderDetail(); };
    so.onchange = function () { state.detailSort = so.value; renderDetail(); };
  }

  function renderAll() {
    if (!sourceRows().length) {
      var root = ensureRoot(); if (root) root.innerHTML = '<div class="gap-card" style="padding:24px"><b>智能体 v2 数据尚未接入</b><div style="margin-top:8px;color:#64748b">请由基座负责人将「智能体清单（各省）」写入 agentMonthly 域；页面不直接读取 Excel。</div></div>';
      return;
    }
    if (state.type !== "ALL" && typesFor(state.month, state.province).indexOf(state.type) < 0) state.type = "ALL";
    renderKpis(); renderTypeDonut(); renderCaseStack(); renderFocus(); renderTrends(); renderProvince(); renderCaseDetail(); renderDetail();
    byId("agDataNote").innerHTML = '数据口径：活跃＝月调用量 &gt; 1000；高热度＝月调用量 &gt; 100000；活跃且高提效＝月调用量 &gt; 1000 且提效比率 &gt; 30%。成功率按百分比、响应耗时按秒展示；空值显示“/”。';
  }

  function renderAgents() {
    cache = null;
    var previewNote = document.querySelector && document.querySelector(".filter-note");
    if (previewNote) previewNote.textContent = "预览数据：来自【智能体】灵运BI重要数据模拟-v2.xlsx · 正式接入由基座统一生成 data.js";
    if (!sourceRows().length) { buildShell(); renderAll(); return; }
    buildShell(); renderControls(); bindDetailControls(); renderAll();
  }

  if (window.addEventListener) window.addEventListener("resize", function () {
    Object.keys(charts).forEach(function (k) { try { charts[k].resize(); } catch (e) {} });
  });
})();
