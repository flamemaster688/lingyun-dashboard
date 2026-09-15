# 灵运 BI 看板 · 多人协作搭建流程（v2 · 基于现有基础版）

> 基座负责人：你（赵莹）｜协作人：吴超、羽琪｜工具：WorkBuddy
> 路线：纯静态站点（`lingyun_dashboard/static/` 已跑通），发一个链接全员可看。

---

## 一、基础版真实文件清单（这就是「另两人保持一致」的标准）

现有基础版在 `lingyun_dashboard/static/`，**所有文件类型如下，三人必须沿用，不要自创新类型**：

| 文件 / 目录 | 类型 | 作用 | 是否允许个人改 |
|------------|------|------|----------------|
| `index.html` | HTML | 顶栏 + 左侧导航 + 各面板 `<section>` 骨架 + 引用 css/js | ❌ 仅基座负责人 |
| `style.v6.css` | CSS | 冷色系主题、布局、卡片/表格/图表卡样式（**版本号 v6**，改名避 CDN 缓存） | ❌ 仅基座负责人 |
| `lingyun.app.v10.js` | JS（巨石） | 当前所有页面渲染逻辑 + 导航切换 + 全局筛选 | ⚠️ 必须拆模块（见第二节） |
| `data.js` | JS 数据 | 全局数据 bundle（`window.DATA = {...}`），页面只读它 | ❌ 由构建脚本生成 |
| `metrics_catalog.json` / `.js` | JSON/JS | 指标字典：口径(caliber)、状态(已可展示/暂未接入)、来源、字段字典 | ⚠️ 新增页面指标由负责人加，需你汇总 |
| `vendor/echarts.min.js` | 第三方库 | 图表，本地优先 + CDN 兜底 | ❌ 只读 |
| `vendor/china-register.js` | 第三方库 | 同步注册中国地图（省份地图用，**不要 fetch 在线 GeoJSON**） | ❌ 只读 |
| `vendor/xlsx.full.min.js` | 第三方库 | 本地文件上传解析（CSV/Excel） | ❌ 只读 |

**技术栈定死（三人一致）**：纯静态 HTML+CSS+JS，图表统一 ECharts 5（本地引用），中国地图用 `china-register.js` 本地注册，冷色系主题（蓝 `#2B6CB0` / 雾蓝 `#5B8FB9` / 薄荷绿 `#48C9B0` / 背景 `#F5F8FB`，异常珊瑚红 `#FF6B6B`）。

---

## 二、关键改造：把「巨石 JS」拆成「每页一个模块」（合并零冲突的前提）

现状 `lingyun.app.v10.js` 一个人写全部页面，三人同改必冲突。**基座负责人先把它拆掉**：

```
static/
├── index.html              # 只留骨架：导航 + 空 <section id="panel-xxx"> + 引用 core + 各 page
├── core/
│   ├── app.js              # 导航切换、全局筛选(时间/省份)、加载 data.js、按注册表挂载页面
│   └── util.js             # 格式化、颜色、空态/加载态/错误态、KPI 卡、表格渲染（三人共用）
├── data.js                 # 构建脚本产物，页面只读
├── metrics_catalog.js      # 指标字典（全局）
├── vendor/                 # echarts / china-register / xlsx（不变）
└── pages/
    ├── overview.js         # 吴超：数据总览
    ├── agents.js           # 羽琪：智能体
    ├── tracking.js         # 你：平台分析（埋点）
    ├── province.js         # 吴超：省份分析
    ├── quality.js          # 你：质效分析
    ├── alert.js            # 羽琪：告警中心（基础版暂无，需新建）
    └── report.js           # 吴超：报告生成（功能设计，不连数据源）
```

**页面接入契约（三人照写，基座靠它自动挂载）**：每个 page 文件只暴露一个注册对象，不碰取数、不改 core。

```js
// pages/tracking.js（你负责）
window.LingYunPages = window.LingYunPages || {};
window.LingYunPages['tracking'] = {
  meta: { title: '平台分析', order: 3, owner: '赵莹' },
  // container = 基座给的 <section> 节点；data = 该页数据切片
  init(container, data) { /* 用 ECharts 画图，数据只从 data 取 */ }
};
```

> 拆完后：**每人只改自己 `pages/<名字>.js` + 自己的 `data-source.json`**，文件层面不可能冲突。这是能干净合并的根。

---

## 三、7 个 tab 与分工（已按你给的定）

| # | tab | 文件夹/模块 | 负责人 | 是否连数据源 | 备注 |
|---|-----|------------|--------|--------------|------|
| 1 | 数据总览 | `overview.js` | 吴超 | ✅ | 现有最完整 |
| 2 | 智能体 | `agents.js` | 羽琪 | ✅ | 现有有内容 |
| 3 | 平台分析（埋点） | `tracking.js` | **你** | ✅ | 现有 pages 面板 |
| 4 | 省份分析 | `province.js` | 吴超 | ✅ | 现有有内容 |
| 5 | 质效分析 | `quality.js` | **你** | ✅ | 现有有内容（含分中心排名） |
| 6 | 告警中心 | `alert.js` | 羽琪 | ✅（需定） | **基础版缺此页，全新建** |
| 7 | 报告生成 | `report.js` | 吴超 | ❌ 仅功能设计 | 现有有雏形（生成 .md 报告） |

- 你 2 个（埋点、质效）；吴超 3 个（总览、省份、报告）；羽琪 2 个（智能体、告警）。
- **告警中心是第 6 页，规则上需要数据源**，但 catalog 暂无告警指标、基础版也无此页 → 数据源待羽琪定（要么提供自己的金山文档，要么基于现有指标阈值派生告警）。只有第 7 页「报告生成」是纯功能、不连数据源。

---

## 四、每人要产出什么（保持一致的文件清单）

每人接手后，在自己的 page 模块里只产这两类东西：

1. **`pages/<名字>.js`**：页面渲染模块，遵循第二节的注册契约。
   - 图表用 ECharts（本地 echarts.min.js），不引新库。
   - 复用 `core/util.js` 的 KPI 卡 / 表格 / 空态组件，不自造一套样式。
   - 配色只用冷色系变量，异常才用珊瑚红。
2. **`pages/<名字>.data-source.json`**：声明「本页要从哪个金山文档取数」（解决“每人提供自己的金山文档”）。
   ```json
   {
     "owner": "赵莹",
     "sources": [
       { "file": "埋点日志表", "sheet": "0720-0726", "range": "A1:M1001",
         "fields": { "page": "PAGE", "clicks": "点击量" } }
     ]
   }
   ```
   构建脚本读取所有 page 的 `data-source.json` → 逐个用 kdocs 连接器取数 → 拼成 `data.js`。**页面自己不写任何取数逻辑**。

> 报告生成（`report.js`）不连数据源，无需 `data-source.json`，只做功能 UI（选报告类型 → 生成 → 下载 .md）。

---

## 五、数据管线（每人自己的金山文档，统一出包）

```
各人金山文档 ──kdocs连接器──> build/fetch-data.py 读全部 pages/*.data-source.json
        ──> 生成 static/data.js（按 page 名分命名空间）
        ──> 部署静态站（链接即看最新快照）
```

- 取数集中在你这边跑（浏览器不能直连金山文档：CORS + 鉴权），所以数据以「构建快照」形式进 `data.js`。
- 开发期：先放 `mock/<名字>.json` 假数据，三人不用真实文档也能联调预览。
- 真实取数：每人把自有文档的 file_id / sheet / range 填进自己的 `data-source.json`，你统一构建。

---

## 六、分发 → 开发 → 合并 → 部署（更新版流程）

**阶段 0 · 你（基座）做改造**（约 1 天）
1. 按第二节把 `lingyun.app.v10.js` 拆成 `core/` + 7 个 `pages/*.js`，index.html 改引 core + 各 page。
2. 新增空的 `alert.js`（羽琪页占位）、确认 `report.js` 走功能设计。
3. 写 `core/util.js`（KPI 卡 / 表格 / 空态 / 加载态 / 错误态统一组件）。
4. 造 7 份 `mock/*.json`，本地起静态服务自测 7 个 tab 能切换渲染。
5. 写 `AI_DEV_BRIEF.md`（规范摘要 + 契约 + 分工），给吴超/羽琪各一份圈好范围的。

**阶段 1 · 分发**：推荐工蜂/GitHub 私有仓（三人分支，PR 合并，能 review 能回滚）；备选：打包 `static/` 压缩发给两人，叮嘱“只改自己 `pages/<名字>.js` 和自己的 `data-source.json`”。

**阶段 2 · 三人并行**（每人约 1–2 天）：各自 WorkBuddy 粘 `AI_DEV_BRIEF.md` 开发自己页，本地预览，只动自己文件。

**阶段 3 · 合并**（你，约 0.5 天）：git merge 三个分支（因文件夹隔离基本无冲突）；打包方式则把 7 个 page 文件拷进 `pages/`，按 `meta.order` 自动排 tab。

**阶段 4 · 接真实数据 + 部署**：你跑 `build/fetch-data.py`（读各人 `data-source.json`）→ 生成 `data.js` → 部署（Vercel / Cloudflare Pages / Netlify，CloudStudio 既往抖动作备选）→ 发链接。

---

## 七、给吴超 / 羽琪 的「保持一致」要点卡（直接转给他们）

- 文件类型只有：1 个 `pages/<你的页>.js` + 1 个 `pages/<你的页>.data-source.json`（报告生成除外）。
- 不新建 CSS 文件、不引新 JS 库、不改 `index.html` / `core/` / `data.js` / `vendor/` / `metrics_catalog`。
- 页面必须 `window.LingYunPages['xxx'] = { meta, init }` 注册，数据只从 `init(container, data)` 的 `data` 取。
- 图表只用 ECharts；地图用已注册的 `china-register.js`；配色只用冷色变量。
- KPI 卡 / 表格 / 空态用 `core/util.js` 现成组件，别自己写样式。
- 新增指标口径写进 `metrics_catalog`（先本地记，最后由赵莹汇总，避免三人各写一本）。

---

## 八、待你确认 / 下一步

1. **是否现在就把巨石 `lingyun.app.v10.js` 拆成 core + 7 page 模块？** 这是多人协作能零冲突合并的前提，建议你确认后我直接帮你拆（保留现有 6 页逻辑，补 alert 占位）。
2. 告警中心的数据源怎么定（羽琪自有文档 or 阈值派生）？
3. 部署平台选哪个（Vercel / Cloudflare Pages / Netlify）？
4. 确认后我可以一并生成：`core/util.js`、`AI_DEV_BRIEF.md`（吴超/羽琪两份）、7 份 `mock/*.json`、以及 `build/fetch-data.py` 的按页取数版。
