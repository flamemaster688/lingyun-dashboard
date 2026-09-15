# 灵运 BI 看板 · 前端规范（`STYLE_GUIDE`）

> **本文件是「执行优化指令时，必须一并喂给 WorkBuddy 的约束文档」**。
> 适用范围：赵莹（基座）/ 吴超 / 羽琪 三人并行开发 7 个页面。
> 目标：三人改出的页面**视觉、交互、代码结构完全一致**，合并零冲突。
> 配套：`data-contract.json`（数据契约）、`RUN.md`、`AI_DEV_BRIEF_*.md`（各人简报）。

---

## 0. 这份规范怎么喂给 WorkBuddy（重要）

下达任何优化指令时，请把**本文件 + 你负责的页面文件 + `AI_DEV_BRIEF_*.md`** 一起发给 WorkBuddy，并加一句：

> 「请先读 `STYLE_GUIDE.md` 的「红线」和「可用资源」，然后只改我指定的页面文件，改完跑 `node build/check.js <文件>` 自检，并说明是否触碰了红线。」

WorkBuddy 必须把它当作**不可违反的边界**，而不是建议。

---

## 1. 红线（HARD RULES · 违反即退回重做）

以下任何一条都**绝对禁止**，无论用 natural language 怎么绕：

1. **只改你自己负责的 `pages/<你的页>.js`**。
   - 吴超：`overview.js`、`province.js`、`report.js`
   - 羽琪：`agents.js`、`alarms.js`
   - 赵莹：全部（含 `core/`、`index.html`、`style.v6.css`、`data.js`）
2. **禁止改动** `core/core.js`、`core/data.js`、`index.html`、`style.v6.css`、`data.js`、`metrics_catalog.*`、`vendor/`。这些是基座，由赵莹维护。
3. **禁止 `fetch` / `XMLHttpRequest` 直接连金山文档或其它外部接口**。数据只能从 `LY.data`（见第 6 节）读。取数由赵莹统一用 `build/fetch-data.py` 走 kdocs 连接器完成。
4. **禁止直接读 `window.LINGYUN_DATA`**。一律走 `LY.data.*` 接口。
5. **禁止新增 `<style>` 或内联 style 写样式**。所有样式必须复用第 9 节已有的 CSS 类；需要新视觉先把诉求告诉赵莹，由赵莹在 `style.v6.css` 加类。
6. **禁止引入粉色 / 大面积暖橙色 / 玫红等暖色块**。配色只允许冷色系（蓝 / 雾蓝 / 薄荷绿 / 青绿 / 紫色）+ 克制珊瑚红（仅异常/告警/缺口）。
7. **禁止在页面文件里互相 import 或引用对方页面的变量**。需要复用就放进 `core/core.js` 或 `core/data.js`（但改 core 需赵莹同意）。
8. **禁止把图表容器高度写成 0 / auto 塌缩**。每个 ECharts 实例必须挂在固定高度的 div 上（`height:320px` 或 `.tall` 380px）。
9. **禁止数据缺失时抛错**。字段为 `null`/空数组时必须渲染成「/」或「数据未接入」占位，不得 `NaN`、`undefined` 直接进 DOM。

---

## 2. 项目结构与「你能碰的文件」

```
lingyun_dashboard/
├─ index.html                 ← 基座入口（勿改结构）
├─ static/
│  ├─ core/
│  │  ├─ core.js              ← 全局内核：状态/注册表/tab分发/筛选/取数/所有共享工具（勿改）
│  │  └─ data.js              ← 统一数据接口 LY.data（勿改）
│  ├─ pages/                  ← ★ 你只碰自己这里
│  │  ├─ overview.js          # 数据总览（吴超）
│  │  ├─ agents.js            # 智能体（羽琪）
│  │  ├─ tracking.js          # 平台分析/埋点（赵莹）
│  │  ├─ province.js          # 省份分析（吴超）
│  │  ├─ quality.js           # 质效分析（赵莹）
│  │  ├─ alarms.js            # 告警中心（羽琪）
│  │  └─ report.js            # 报告生成（吴超，不连数据源）
│  ├─ vendor/                 # echarts / china-register / xlsx（勿改）
│  ├─ data.js                 # 数据 bundle（自动生成，勿手改）
│  ├─ data.dev.js             # 离线 mock 数据（开发态 index.dev.html 用）
│  ├─ style.v6.css            # 全局样式（勿改；版本号避缓存）
│  └─ metrics_catalog.*       # 指标字典（勿改）
├─ build/                     # 校验/打包/取数脚本（赵莹）
└─ pages/<id>.data-source.json # 各页金山文档声明（个人填 fileId 回传赵莹）
```

**预览方式**：双击 `static/index.html`（用真实 `data.js`）或 `static/index.dev.html`（用 mock `data.dev.js`）。两者都是纯本地 `file://` 打开，无需起服务器。

---

## 3. 页面模块契约（registerPage）

每个页面是一个**独立 IIFE 文件**，通过 `window.registerPage(cfg)` 注册。`cfg` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 与文件名、`index.html` 里的 `data-tab`、panel 的 `id` 一致 |
| `title` | string | 顶部 toolbar 标题 |
| `icon` | string | 导航图标（用单个字符/符号，如 `◆` `◎`）|
| `order` | number | 元数据，仅记录；tab 顺序由 `index.html` 导航固定 |
| `owner` | string | 负责人姓名 |
| `render` | function | 渲染函数，无参数；内部从 `V` 取已过滤的视图数据 |

### 标准骨架（复制即用，把标注处替换成你的逻辑）

```js
/* pages/xxx.js — <页面名>（负责人：<你>）
 * 本文件只负责本页面渲染，只读 core 暴露的全局（V / D / FILTER / LY.data / 全局工具），
 * 不写任何取数逻辑。优化本页只需要改这一个文件，互不影响其它页面。
 */
(function () {
  if (!window.LY) window.LY = { pages: {} };
  window.registerPage({
    id: "xxx",          // 必须与 index.html 的 data-tab 一致
    title: "页面名",
    icon: "◆",
    order: 1,
    owner: "你的名字",
    render: function () { renderXxx(); }
  });

  /* ===== 渲染函数 ===== */
  function renderXxx() {
    // 1) 取当前已按全局筛选(时间/省份)过滤好的视图 V
    var view = V;                       // 或 LY.data.view()
    // 2) 取该页关心的业务域（已在 data-contract.json 声明）
    var myData = LY.data.domain("agents");   // 例如 agents / provinces / tracking / alerts
    // 3) 用全局工具填 DOM（见第 5 节），用 topChart 绘 ECharts
    // 4) 缺数一律 dash() / kpiGap() 兜底
  }
})();
```

**渲染触发**：core 在切换 tab / 改筛选 / 上传数据后自动调用对应页面的 `render()`。页面**不要自己绑定 DOMContentLoaded**，也不要自己调 `echarts.init`（统一用全局 `topChart`）。

---

## 4. 注册表与全局状态（只读，勿改）

core 暴露的全局（页面可直接用，但**不要重新声明同名变量**）：

- `window.LY.pages`：注册表 `id -> cfg`。
- `window.LY.getView()`：返回当前 tab 的**计算视图** `V`（已按时间/省份筛选）。等价全局变量 `V`。
- `window.LY.data`：统一数据接口（见第 6 节）。
- `currentTab`（`curTab()` 取）：当前 tab id，**只读**，勿改。

共享状态（core 内部，页面只读）：
- `V`：当前计算视图，含 `overview / agents / provinces / tracking / capability / centerYearRank / alerts` 各域切片 + `V.flags`（periodLabel、各页备注等）。
- `D`：当前 tab 的原始数据（`LINGYUN_DATA`）。
- `FILTER`：当前筛选 `{dim, months, weeks, days, prov}`。

---

## 5. 页面可调用的全局工具函数（已内置，直接调用，勿重写）

这些都是 `core/core.js` 里的全局函数，页面**直接调用即可，禁止重新定义**：

| 函数 | 签名 | 用途 |
|------|------|------|
| `$` | `$(id)` | `document.getElementById` 简写 |
| `dash` | `dash(v)` | `null/undefined/""` → `"/"`，否则原值 |
| `fmtInt` | `fmtInt(n)` | 整数千分位，非法→`"/"` |
| `fmtWan` | `fmtWan(n)` | 自动「亿/万」缩写，非法→`"/"` |
| `fmtPY` | `fmtPY(n)` | 人年，保留两位小数 + ` 人年` |
| `fmtMoney` | `fmtMoney(n)` | `¥` + 千分位，非法→`"/"` |
| `topChart` | `topChart(id, option)` | **唯一**画 ECharts 的方式：按 id 拿 div、`echarts.init`、自动 `dispose` 旧实例、`setOption`。图表库未加载时自动降级提示。 |
| `insightBox` | `insightBox(id, html)` | 往 `#id` 写入一条 `.insight` 洞察卡片 |
| `noteBox` | `noteBox(id, txt)` | 往 `#id` 写筛选备注小字 |
| `showGap` | `showGap(id, title, note)` | 在 `#id` 渲染「数据未接入」占位块 |
| `kpi` | `kpi(title, val, sub)` | 返回**一个 KPI 卡 HTML 字符串**（顶部色条 `.brand`） |
| `kpiGap` | `kpiGap(title, val, sub)` | 返回**缺口 KPI 卡**（灰字 + 珊瑚红标） |
| `esc` | `esc(s)` | HTML 转义，拼用户/数据文本进 innerHTML 前必用 |

图表配色常量（**直接用，勿改值**）：
- `PALETTE`：`["#3b82f6","#14b8a6","#8b5cf6","#f59e0b","#ef4444","#22c55e","#60a5fa","#a855f7"]`
  - 常规图只用**冷色索引**：`0` 蓝、`1` 薄荷绿、`2` 紫、`6` 雾蓝、`7` 紫。
  - `5`(`#ef4444` 珊瑚红) **仅用于异常/告警/缺口**；`3`(`#f59e0b` 琥珀) 仅用于警告。
- `AX`=`"#9ca3af"`（坐标轴线和刻度）、`GRID`=`"#e5e7eb"`（网格线）、`INK`=`"#1f2937"`（主文字）、`SUB`=`"#6b7280"`（次文字）。

---

## 6. 数据访问规范（只读 `LY.data`）

**唯一合法取数入口**。页面永远不直接碰 `window.LINGYUN_DATA`，也不写任何 `fetch`。

```js
// 全局 meta（省份列表、时间层级、缺口说明）
var meta = LY.data.meta();
// 某业务域原始数组（agents / provinces / tracking / capability / centerYearRank / alerts）
var agents = LY.data.domain("agents");
// 当前 tab 已按筛选过滤的视图（推荐 render 内主用这个）
var view = LY.data.view();          // 等价全局 V
// 取某 tab 关心的多个域（见 data-contract.json 的 PAGE_DOMAINS）
var pkg = LY.data.page("overview"); // { overview, capability, agents, provinces, meta }
// 便捷
LY.data.provinces();   // meta.provinces
LY.data.timeLevels();  // { months:[], weeks:[], days:[] }
LY.data.gaps();        // 缺口说明数组
LY.data.fmtNum(n);     // 千分位
LY.data.fmtPct(n, d);  // (n/d*100).toFixed(1)+"%"，分母为0→"/"
```

数据契约字段详见 `data-contract.json`。**若优化需要新增数据字段，必须同步更新 `data-contract.json` 并告知赵莹**，不要在页面里假设字段存在而不做 `null` 兜底。

---

## 7. 布局规范

- **整体骨架**（已由 `index.html`/`style.v6.css` 固定，勿动）：顶栏（logo+标题，56px）+ 左侧导航（7 tab，200px）+ 右侧内容区（按 tab 切换的 `section.panel`）。
- **每页内容区**：开头统一放 `.page-header > .page-toolbar[data-tab]`（筛选+数据源控件由 core 渲染，页面无需手写）。正文用卡片栅格。
- **卡片栅格**：内容区 `.main` 内用 `.kpi-grid`（KPI 行）或 `.row-2`（两列）等；图表卡 `.chart-card` 内 `.chart`（高 320px）或 `.chart.tall`（高 380px）。
- **响应式**：内容区 `min-width:0` 防溢出；窄屏（≤1100px）`.kpi-5` 自动从 5 列→3 列；≤860px 隐藏侧栏。页面**不要写新的媒体查询**，除非赵莹在 `style.v6.css` 统一加。

---

## 8. 配色系统（真实 CSS 变量，必须使用这些）

定义在 `style.v6.css` 的 `:root`。页面写样式（若赵莹授权新增类）只能引用下列变量，不得写死 hex（珊瑚红除外，按第 6 条语义使用）。

| 变量 | 值 | 语义 |
|------|----|------|
| `--bg` | `#f4f6f9` | 页面底色 |
| `--panel` | `#ffffff` | 卡片/表面底色 |
| `--ink` | `#1f2937` | 主文字 |
| `--muted` | `#6b7280` | 次文字/说明 |
| `--line` | `#e5e7eb` | 描边/分割线 |
| `--brand` | `#3b82f6` | **主色**（导航/标题/主按钮/激活态）|
| `--brand-2` | `#2563eb` | 主色按下/深一点的主色 |
| `--brand-soft` | `#eff6ff` | 主色浅底（选中/提示/缺口块）|
| `--teal` | `#14b8a6` | 辅助主色（薄荷绿，成功/次图形）|
| `--teal-soft` | `#f0fdfa` | 薄荷绿浅底 |
| `--purple` | `#8b5cf6` | 辅助（紫，KPI 色条/图形）|
| `--purple-soft` | `#f5f3ff` | 紫浅底 |
| `--orange` | `#f59e0b` | **仅警告**（KPI 色条/琥珀标）|
| `--green` | `#22c55e` | 成功/正向 |
| `--red` | `#ef4444` | **仅异常/告警/缺口**（珊瑚红语义）|
| `--shadow` | `0 4px 20px rgba(31,41,55,.08)` | 卡片阴影 |
| `--radius` | `12px` | 卡片圆角 |
| `--topbar-h` | `56px` | 顶栏高 |
| `--side-w` | `200px` | 侧栏宽 |

**规则**：常规视觉只用 `--brand / --teal / --purple / 蓝色系`；`--red` 只出现在异常、告警、缺口；`--orange` 只出现在「警告」语义；**禁止粉红/玫红/大面积暖橙装饰块**（契合冷色审美偏好）。

---

## 9. CSS 类名清单（现有可复用类，禁止新造样式）

优化样式时**优先复用下列已有类**。需要新视觉先提给赵莹在 `style.v6.css` 加类，不要页面内联 `<style>`。

- **布局/外壳**：`.topbar .brand .brand-mark .brand-text`、`.layout .sidebar .main`、`.nav-menu .nav-item(.active) .nav-icon .nav-text`、`.panel(.active)`、`.page-header .page-toolbar .page-filter-bar`、`.section-title`、`.block .block-title`、`.row-2`、`.kpi-5`
- **KPI**：`.kpi-grid .kpi(.brand/.teal/.purple/.orange/.red) .kpi::before .ic .lb .val(.warn) .delta(.up/.down/.flat)`
- **图表卡**：`.chart-card .ct`、`.chart(.tall)`、`.chart-gap .gap-block .gap-title .gap-note`、`.kpi-big .ub-val .ub-sub`
- **洞察/提示**：`.insight(.warn/.ok/.info) .i-ic`、`.filter-note`、`.hint`
- **表格**：`.tbl .tbl th/td`、`.hot-row`、`.national-row`、`.hq-row`、`.rank-tbl .num .up .down .rank`、`.sev-高/.sev-中/.sev-低`、`.tag(.优秀/.推广/.活跃/.沉睡/.A/.B/.C/.D)`
- **按钮/分段**：`.btn .btn-primary .btn-ghost .btn.sm .btn-row`、`.seg .seg-btn(.active)`
- **筛选 chip**：`.chips .chip(.on) .chip-natl(.on)`
- **数据源/上传**：`.ds-section .ds-panel`、`.src-line .src-link .kd-status .kd-dot`、`.dropzone(.drag) .dz-ico .dz-main .dz-link .dz-sub .file-list .file-chip .upload-msg(.err)`
- **告警**：`.alert-empty .ae-icon .ae-title .ae-sub`、`.alert-item`
- **报告**：`.report-box(.h2/.h3/ul) .report-actions`
- **其它**：`.empty .chart-fallback .flex-between .cr-filters .cr-fg .cr-fg-title .cr-provs .filter-row .popover-hd`

---

## 10. 字体与字号

- 字体栈（已在 body 设）：`"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif`。页面**不要改 font-family**。
- 字号层级：页面标题 `.section-title` 18px/700；卡片标题 `.ct` 13px/700、`.block-title` 14px/700；正文 13–14px/400；KPI 大数字 `.kpi .val` 23px/800；大数卡 `.ub-val` 46px/900。
- 数字用等宽数字：KPI 值已通过 `.val` 的 `letter-spacing` 接近等宽；表格数字用 `.num`（`font-variant-numeric:tabular-nums`）。需要数字对齐就加 `.num` 类。

---

## 11. 组件约定（照葫芦画瓢）

- **KPI 卡**：用 `kpi(title, val, sub)` / `kpiGap(title, val, sub)` 生成 HTML 字符串，塞进 `.kpi-grid`（或 `.kpi-5` 固定 5 列）。缺数：`kpiGap("模型成功率","数据未接入","数据源无成功率字段")`。
- **图表卡**：`.chart-card` 内 `.ct`(标题) + `<div class="chart" id="xxChart">`。渲染调 `topChart("xxChart", option)`。
- **缺口/未接入**：数据缺失用 `showGap(id, title, note)` 渲染占位块；或在 KPI 用 `kpiGap`。
- **表格**：用 `.tbl`，表头 `.tbl th`、斑马纹由 hover 体现；数字列加 `.num` 右对齐；状态/分级用 `.sev-高/.sev-中/.sev-低` 或 `.tag.*`。拼接行内容前对用户/数据文本用 `esc()`。
- **洞察条**：`insightBox(id, '<span class="i-ic">💡</span> 文字')` 写一条 `.insight`；警告用 `.insight.warn`（珊瑚红左边框），正向用 `.insight.ok`（绿），信息用 `.insight.info`（蓝）。

---

## 12. ECharts 图表规范（option 模板）

**一律用 `topChart(id, option)` 绘制**，不要自己 `echarts.init`。option 遵循以下冷色约定，保证全站图表风格一致：

```js
topChart("ovTrend", {
  color: PALETTE,                       // 全局调色板，常规只用 0/1/2/6/7
  tooltip: { trigger: "axis" },
  legend: { data: ["调用量","等效人年"], textStyle: { color: SUB } },
  grid: { left: 64, right: 30, top: 40, bottom: 30 },
  xAxis: {
    type: "category",
    data: months.map(function(m){ return m.month; }),
    axisLine: { lineStyle: { color: AX } },       // 轴线灰
    axisLabel: { color: SUB }                      // 刻度次文字
  },
  yAxis: [{
    type: "value", name: "调用量",
    axisLabel: { color: SUB, formatter: function(v){ return fmtWan(v); } },
    splitLine: { lineStyle: { color: GRID } }      // 网格线浅灰
  }],
  series: [
    { name:"调用量", type:"bar", data: calls, itemStyle:{ color: PALETTE[0] } },
    { name:"等效人年", type:"line", yAxisIndex:1, data: py, itemStyle:{ color: PALETTE[1] } }
  ]
});
```

规则：
- 轴线/刻度用 `AX`/`SUB`，网格线用 `GRID`，**不要用黑色或深蓝轴线**。
- 系列颜色从 `PALETTE` 取；常规图只用冷色索引（`0`蓝/`1`薄荷绿/`2`紫/`6`雾蓝/`7`紫）；异常系列才用 `PALETTE[5]`（`#ef4444`）。
- 地图：用已注册的 `'china'` map（`china-register.js` 已本地化），省份名用 `PROV_NAME_MAP` 把简称（上海）映射全称（上海市）。
- **缺数兜底**：`data` 为空数组时，`topChart` 仍会渲染空坐标系；若业务上属于「数据未接入」，应在容器外层用 `showGap` 替代图表。
- 响应式：切换 tab / 改筛选后，core 会统一遍历 `instMap` 对全部图表 `resize()`（`core.js` 第 1006 行），页面无需自行监听 resize；图表容器宽度 `100%`、高度固定，重渲染时自动适配。

---

## 13. 数字格式规范

- 大额（调用量/Tokens）：用 `fmtWan`（自动亿/万）或 `fmtInt`（千分位）。
- 人年：`fmtPY`（保留两位小数 + ` 人年`）。
- 金额：`fmtMoney`（`¥` + 千分位）。
- 百分比：`LY.data.fmtPct(n, d)` 或页面内 `(n/d*100).toFixed(1)+"%"`；分母为 0 / 缺数 → `"/"`。
- 缺失值统一 `dash(v)` → `"/"`，**不得**出现 `NaN`、`null`、`undefined` 字面进入 DOM。

---

## 14. 提交前自检清单（WorkBuddy 改完必须逐条执行）

1. **语法**：`node build/check.js`（全量）或 `node build/check.js static/pages/<你的页>.js`（只检自己）。必须 0 错误。
2. **运行**：`node build/smoke.js static` 加载 core+7 页用真实数据渲染，自己页面所在 tab 不得抛错（无 ReferenceError/TypeError）。
3. **红线**：确认未改 `core/`、`index.html`、`style.v6.css`、`data.js`；未 `fetch` 金山文档；未直读 `LINGYUN_DATA`；未写 `<style>`/内联样式；未引入粉/暖色块；未改他人 `pages/*.js`。
4. **预览**：浏览器打开 `index.html`（真实数据）或 `index.dev.html`（mock），切到自己页面确认视觉/交互正常、无 console 报错、图表高度正常、缺数有占位。
5. **数据契约**：若新增字段，已更新 `data-contract.json` 并@赵莹。
6. **回传**：只把**自己改的 `pages/*.js`**（1~3 个文件）发回给赵莹，**不要**发整个包、不要发 `core/`、不要发 `data.js`。

---

## 15. 常见优化任务的「正确写法」示例

**A. 加一张图**（在 render 内，且 HTML 里已有对应 `<div class="chart" id="myChart">`）：
```js
topChart("myChart", { color: PALETTE, tooltip:{trigger:"axis"},
  xAxis:{ type:"category", data:xs, axisLine:{lineStyle:{color:AX}}, axisLabel:{color:SUB} },
  yAxis:{ type:"value", splitLine:{lineStyle:{color:GRID}}, axisLabel:{color:SUB} },
  series:[{ name:"值", type:"bar", data:ys, itemStyle:{color:PALETTE[0]} }] });
```
> 注意：新增图表 div 必须在 `index.html` 对应 `section.panel` 内；若需赵莹加，请提出，勿自己改 HTML。

**B. 改 KPI 文案/数值**：用 `kpi(title, fmtWan(val), sub)` 重新生成字符串塞进 `.kpi-grid`。

**C. 优化配色/间距**：**不要**在页面写 CSS；提出具体诉求（如「KPI 卡片想要薄荷绿顶条」），由赵莹在 `style.v6.css` 调整 `.kpi.teal::before` 之类；或你仅选择已有类（如给卡加 `.teal` 类）。

**D. 加一个洞察结论**：`insightBox("ovInsight", '<span class="i-ic">💡</span> 本月调用量环比 +12%');`

**E. 数据缺失保护**：任何取值先 `dash()` / 判 `null`，再进 DOM 或图表。

---

> 本规范与 `data-contract.json`、`core/data.js`、`style.v6.css` 同源。若发现本规范与代码实际不符，**以代码为准**，并立即告知赵莹修订本文件。
