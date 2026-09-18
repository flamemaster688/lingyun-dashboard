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
