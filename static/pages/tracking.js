/* pages/tracking.js — 平台分析（埋点）（负责人：赵莹）
 * 只读 core/core.js 暴露的全局状态（D / FILTER / V），不写取数逻辑。
 * 数据源：金山文档·平台分析（atbL8BymF1MWRdUn3wue1xkekdEskSQYj），按周统计埋点 PV/UV/曝光。
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
      var f1 = $("pgKpi"); if (f1) f1.innerHTML = '<div class="chart-fallback">暂无平台埋点数据（请确认「平台分析」在线文件已取数）。</div>';
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
      "数据源：" + (pt.source || "金山文档·平台分析") + "；" + scopeNote +
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
