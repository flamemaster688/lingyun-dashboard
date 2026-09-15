# 灵运 BI 看板 · 多人协作命令手册

> 基座已拆好：共享内核 `static/core/core.js` + 7 个相互独立、可单独优化的页面模块 `static/pages/*.js`。
> 本手册定义三件事：**七页同优 / 单文件优** 的命令、**三人合并** 流程、**部署发布** 命令。
> 原单文件版 `lingyun.app.v10.js` 完整保留，由 `static/index.legacy.html` 兜底引用，功能不受影响。

---

## 一、目录与分工（已落地）

```
static/
├─ core/core.js          # 共享内核（全局脚本）：状态 D/FILTER/V、工具函数、金山文档取数管线、tab 注册表
├─ pages/
│  ├─ overview.js        # 数据总览        —— 负责人：吴超
│  ├─ agents.js          # 智能体          —— 负责人：羽琪
│  ├─ tracking.js        # 平台分析（埋点） —— 负责人：赵莹
│  ├─ province.js        # 省份分析        —— 负责人：吴超
│  ├─ quality.js         # 质效分析        —— 负责人：赵莹
│  ├─ alarms.js          # 告警中心        —— 负责人：羽琪
│  └─ report.js          # 报告生成        —— 负责人：吴超
├─ index.html            # 模块版入口（加载 core + 7 个 pages）
├─ index.legacy.html     # 原单文件版兜底（加载 lingyun.app.v10.js）
├─ data.js / vendor/ / style.v6.css / metrics_catalog.*
```

**关键设计（保证可单文件优化、互不冲突）：**
- 每个页面文件只挂自己的 `render`，只读 `core` 暴露的全局共享状态，**不写任何取数逻辑**。
- 页面之间零耦合：一个文件出错/改写，**绝不会**影响其他页面（这是相对原 v10 单文件巨石的最大改进）。
- `core` 只有赵莹能改（取数管线、注册表）；其余 3 人每人只碰自己名下的 `pages/*.js`。

---

## 二、在主对话下发「优化命令」

> 「主页面」= 赵莹的 WorkBuddy 主对话。以下两类指令直接粘贴即可，我会按指令执行。

### 模式 A：七个页面同时优化
适合定期统一提质。指令示例：

```
优化灵运 BI 看板全部 7 个页面（static/pages/*.js）：
- 在保持现有数据与交互不变的前提下，优化可视化与文案；
- 吴超负责 overview/province/report，羽琪负责 agents/alarms，我（赵莹）负责 tracking/quality；
- 各自只改自己名下的 pages/*.js，不要改 core；
- 改完跑 node build/check.js 自检，最后 node build/bundle.js 合并打包。
```
我会并行派 3 个子代理分别处理三人名下文件，再统一 `check` + `bundle`。

### 模式 B：单独文件单独优化
适合只改某一页。指令示例：

```
只优化 static/pages/quality.js（质效分析页）：
- 把“分中心等效人年排名”表默认按得分降序，并在表头加单位说明；
- 不要动其他文件，改完跑 node build/check.js pages/quality.js。
```
只改这一个文件，互不影响其他 6 页，可立即 `check` 验证。

---

## 三、三人合并流程（文件夹隔离，零冲突）

1. 赵莹把 `static/`（含 `core/`、`pages/`、取数脚本 `build/`、本手册）打包发给吴超、羽琪。
2. 两人各自只编辑自己负责的 `pages/*.js`：
   - 吴超：`pages/overview.js` `pages/province.js` `pages/report.js`
   - 羽琪：`pages/agents.js` `pages/alarms.js`
   - 赵莹：`pages/tracking.js` `pages/quality.js`
3. 收回后放进同一 `static/pages/`，**因文件名物理隔离，几乎不会冲突**（除非两人改了同一文件才需人工 merge）。
4. 赵莹统一把各人提供的金山文档用 kdocs 取数、写入 `data.js`（页面只读，不碰取数逻辑）。
5. 赵莹执行「部署发布」命令生成共享链接。

---

## 四、确定性命令（人人可跑，无需 AI）

| 命令 | 作用 |
|------|------|
| `node build/check.js` | 语法校验 **全部** 8 个模块（core + 7 pages） |
| `node build/check.js pages/quality.js` | 只校验 **单个** 文件（单文件优化后用） |
| `node build/bundle.js` | 合并 core + 7 pages → `dist/lingyun.bundle.js` + `dist/index.html` |

> 运行环境：仓库已自带 Node（managed）。示例（在 `lingyun_dashboard/` 下）：
> `C:\Users\赵莹\.workbuddy\binaries\node\versions\22.22.2\node.exe build/check.js`

---

## 五、部署发布（共享链接）

合并产物在 `dist/`，纯静态、打开即看、无需登录：
- 双击 `dist/index.html` 本地预览；
- 或部署到 CloudStudio / Vercel / Cloudflare Pages / 腾讯云 COS 拿到共享网址发给团队。
- 数据更新：赵莹重跑取数脚本刷新 `data.js` → 重新 `node build/bundle.js` → 重新部署即可。

---

## 六、数据源约定（避免重复踩坑）

- **前 6 个页面需连数据源**（数据总览/智能体/平台分析/省份分析/质效分析/告警中心）：各负责人提供自己的金山文档，由赵莹统一经 kdocs 取数写入 `data.js`。页面**只读 `data.js`**，浏览器不能直连金山文档（CORS+鉴权）。
- **报告生成**为功能页，不单独配数据源，基于 `data.js` 已算好的视图 `V` 生成结论。
- **告警中心**当前显示“数据验证未包含告警明细”占位；待羽琪提供告警/异动明细文档、赵莹取数写入 `data.js.alerts` 后自动渲染。
