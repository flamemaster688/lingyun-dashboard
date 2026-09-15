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
    noteBox("qeProvNote", "数据源：金山文档·质效分析（等效人年按分中心/单位汇总）+ sheet3「数据月度汇总」。上方 9 张卡片随顶部「时间范围 / 单位」筛选动态变化：当前 " + mTxt + " · " + scopeTxt + "。第 1 张「总体（2026）」右上角可勾选 6 项能力（默认四项），数值与同比实时重算；灵运平台、智能立单为 2026 年新增、无 2025 基线，其同比显示「/」。2025 总体固定含 5 项（含智能点选）。");
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
