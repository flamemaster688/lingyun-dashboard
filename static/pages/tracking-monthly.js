/* pages/tracking-monthly.js — 平台分析（月度）
 * 设计依据：《埋点数据看板·指标口径与下钻设计方案》（2026-08-28）
 * 数据源：V.platformMonthly（金山文档「平台分析-月」· 用户级埋点）
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
      calc: function (M, m) { return Object.keys(M.active[m]).length; },
      fmt: function (v) { return fmtInt(v); },
      kou: "本月曝光>0 的三级页去重（快照）",
      note: "本月曝光>0 的三级页数量（真有人用的页面）。",
      sub: function (M, m) {
        var tot = M.totalCum[m] || 0; if (!tot) return "—";
        return "页面活跃率：" + (Object.keys(M.active[m]).length / tot * 100).toFixed(1) + "%";
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
      ["pfmKpi", "pfmTrend", "pfmModTree", "pfmInsight"].forEach(function (id) { var b = $(id); if (b) b.innerHTML = '<div class="chart-fallback">暂无平台月度数据（请确认「平台分析-月」在线文件已取数并 build）。</div>'; });
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
    var srcTxt = (pm.source || "金山文档·平台分析-月") + (pm.isSample ? "（⚠ 样本验证数据，非真实全量；运行全量 dump 后替换）" : "");
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
