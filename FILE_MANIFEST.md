# 灵运 BI 看板 · 基座包文件清单与使用说明

> 本文件是基座包的「导航图」。发给大家之前，先看 `灵运BI看板_决策结论表.md` 把协作方式/部署平台定下来，再看本文件了解每个文件怎么用。

---

## 一、先会开哪个文件（最重要）

| 你的目的 | 打开文件 | 说明 |
|---|---|---|
| **发给同事的正常版**（真实数据，和现在一模一样） | `static/index.html` | 双击即可（无需服务器），加载真实 `data.js` |
| **同事离线调样式用**（mock 假数据，右上角有「开发态」角标） | `static/index.dev.html` | 双击即可，自动加载 `data.dev.js` |
| **出问题时回退**（拆分前的原版） | `static/index.legacy.html` | 引用旧单文件 `lingyun.app.v10.js`，仅应急 |

> ⚠️ 必须把整个 `static/` 文件夹一起发，因为 `index.html` 要找 `vendor/`、`core/`、`pages/`、`data.js`、`style.v6.css`。只发单个 html 打不开。

---

## 二、看板本体目录 `static/`（双击 index.html 即看，无需改）

| 文件 | 作用 | 谁改 | 使用说明 |
|---|---|---|---|
| `static/index.html` | **正式入口**，加载真实数据 `data.js` + 内核 + 7 页 | 基座方（赵莹） | 日常发布/演示用。新增 tab 才动它 |
| `static/index.dev.html` | **开发态入口**，自动加载 mock 数据 `data.dev.js` | 基座方 | 同事没接离线 Excel时用来调页面；右上角有角标区分 |
| `static/index.legacy.html` | 拆分前原版兜底 | 冻结 | 只有新结构出问题时双击回退，平时别动 |
| `static/data.js` | **真实数据**（当前快照） | 基座方（统一取数生成） | 页面只读它；更新数据由赵莹跑 `build/build_from_xlsx.py merge` 覆盖 |
| `static/data.dev.js` | 离线 mock 数据 | 自动生成 | 由 `build/build_from_xlsx.py mock` 生成；`index.dev.html` 专用 |
| `static/style.v6.css` | 全局样式/冷色主题 | 基座方 | 改视觉风格（配色/间距/字体）统一改这里 |
| `static/lingyun.app.v10.js` | 拆分前旧单文件（原版逻辑全集） | 冻结 | 仅被 `index.legacy.html` 引用，作回退 |
| `static/metrics_catalog.json` / `.js` | 指标字典（口径/单位/说明） | 基座方 | 页面读取指标中文名与单位；新增指标在此登记 |
| `static/vendor/echarts.min.js` | ECharts 图表库（本地化） | 不改动 | 离线/内网可用；CDN 兜底已写进 html |
| `static/vendor/china-register.js` | 注册中国地图 | 不改动 | 省份人年地图依赖；`china.json` 为其源数据（一并保留） |
| `static/vendor/xlsx.full.min.js` | 表格解析库（上传用） | 不改动 | 数据源「本地上传」功能依赖 |

---

## 三、7 个页面模块 `static/pages/`（**每人只动自己负责的**）

> 每个页面 = 一个独立文件，物理隔离 → 三人合并基本零冲突。

| 文件 | 页面 | 负责人 | 数据契约声明文件 | 使用说明 |
|---|---|---|---|---|
| `pages/overview.js` | 数据总览 | 吴超 | `overview.data-source.json` | 只改本页渲染逻辑，不要碰别的文件 |
| `pages/agents.js` | 智能体 | 羽琪 | `agents.data-source.json` | 同上 |
| `pages/tracking.js` | 平台分析/埋点 | 赵莹 | `tracking.data-source.json` | 同上 |
| `pages/province.js` | 省份分析 | 吴超 | `province.data-source.json` | 同上 |
| `pages/quality.js` | 质效分析 | 赵莹 | `quality.data-source.json` | 同上 |
| `pages/alarms.js` | 告警中心 | 羽琪 | `alarms.data-source.json` | 同上（新增页） |
| `pages/report.js` | 报告生成 | 吴超 | 无（不连数据源） | 纯前端功能，读当前筛选产出报告 |

**`pages/*.data-source.json`（6 份模板）**：声明本页对应的离线 Excel `fileId` / `sheet` / `range` / 字段映射。同事拿到自己的文档后，把 `TODO` 处填好回传给赵莹即可。**现在都是占位，未接真实文档。**

---

## 四、共享内核 `static/core/`（所有人依赖，只有赵莹改）

| 文件 | 作用 | 使用说明 |
|---|---|---|
| `core/core.js` | 全局内核：共享状态、tab 注册表、筛选/数据源面板、取数管线 | 通用的「七页同优」改动放这里（配色/筛选/导航/公共组件），所有页面自动受益 |
| `core/data.js` | 统一数据接口（页面只读 `LY.data`，禁直连离线 Excel） | 不要绕过它直接读原始数据；保证页面与数据源解耦 |

---

## 五、构建与脚本 `build/`（赵莹用，同事可选）

需要 **Node**（校验/打包/冒烟）和 **Python**（取数/拆分）。

| 文件 | 作用 | 使用说明 |
|---|---|---|
| `build/build_from_xlsx.py` | 取数脚本，三模式：`extract`(从真实数据拆 6 份 mock) / `mock`(合并出 `data.dev.js`) / `merge`(接真实离线 Excel后覆盖 `data.js`) | 同事只接自己的文件后，赵莹跑 `python build/build_from_xlsx.py merge` |
| `build/mock/*.json` | 6 份 mock 数据（已生成，形状对齐真实 `data.js`） | 离线开发用，勿手改；重生成用上面的 `mock` 模式 |
| `build/check.js` | 语法校验 | `node build/check.js`（全量）；`node build/check.js static/pages/quality.js`（单文件） |
| `build/bundle.js` | 合并 `core+7页` → `dist/` 单文件部署包 | 发布前跑：`node build/bundle.js`，产物在 `dist/` |
| `build/smoke.js` | 用真实数据在 DOM 桩里渲染 7 页，抓运行期异常 | `node build/smoke.js static`（开发态）；`node build/smoke.js dist`（部署态） |
| `build/split.py` | 把旧单文件 `lingyun.app.v10.js` 拆成 core+7页 的脚本（已用过） | 一般不再跑；留档 |

---

## 六、规范与说明文档（必读）

| 文件 | 作用 | 给谁看 |
|---|---|---|
| `灵运BI看板_决策结论表.md`（包根目录） | 6 项决策：tab 名称、各 tab 离线 Excel映射、3 人分工、部署平台、协作方式、配色基线 | 所有人先读，赵莹拍板待定项 |
| `灵运BI看板_多人协作搭建流程.md`（包根目录） | 从搭基座→分发→三人并行→合并→部署的完整流程与防坑 | 所有人 |
| `STYLE_GUIDE.md` | 前端规范：布局/配色 token/字体/组件/JS 模块契约/数据访问/提交自检 | 三人开发时遵守 |
| `data-contract.json` | 数据契约：每个数据页期望的字段结构 | 开发/取数对照 |
| `RUN.md` | 本地预览、目录权限、mock 切换、接离线 Excel、git/打包、部署 | 实操手册 |
| `AI_DEV_BRIEF_赵莹.md` / `_吴超.md` / `_羽琪.md` | 给**各人 WorkBuddy** 的简报：只动哪些文件、怎么取数、自检命令、接文档步骤 | 各自发给自己的 WorkBuddy |

---

## 七、同事拿到包后的标准动作（一句话）

1. 双击 `static/index.dev.html` → 看 mock 版看板，确认导航/布局正常。
2. WorkBuddy 打开本包，读自己那份 `AI_DEV_BRIEF_<名字>.md` → 只改 `pages/<自己页>.js`。
3. 拿到自己的离线 Excel后，填好 `pages/<自己页>.data-source.json` 回传给赵莹。
4. 赵莹统一跑 `build_from_xlsx.py merge` 接真实数据 → `bundle.js` 打包 → 部署发链接。
