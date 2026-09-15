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
