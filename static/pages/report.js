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
