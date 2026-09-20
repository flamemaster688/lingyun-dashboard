# 灵运 BI 看板 · 跑起来说明（基座包）

> 给所有人的「怎么本地跑、怎么开发、怎么部署」一份讲清。
> 角色：赵莹=基座负责人；吴超/羽琪=页面开发。

---

## 一、本地预览（最简单）

直接用浏览器打开 `static/index.html` 即可（双击或拖进浏览器）。
- 数据来自同目录的 `static/data.js`（已含真实数据快照）。
- 中国地图、ECharts 均为本地文件，离线可用，无需联网。

> 若浏览器对 `file://` 加载 JS 有限制，用本地服务器更稳：
> ```
> cd lingyun_dashboard/static
> python -m http.server 8080
> # 浏览器打开 http://localhost:8080
> ```

## 二、目录与「我能改什么」

| 你想做的事 | 改哪个文件 | 谁有权 |
|------------|-----------|--------|
| 开发/优化「数据总览」 | `static/pages/overview.js` | 吴超 |
| 开发/优化「智能体」 | `static/pages/agents.js` | 羽琪 |
| 开发/优化「平台分析(埋点)」 | `static/pages/tracking.js` | 赵莹 |
| 开发/优化「省份分析」 | `static/pages/province.js` | 吴超 |
| 开发/优化「质效分析」 | `static/pages/quality.js` | 赵莹 |
| 开发/优化「告警中心」 | `static/pages/alarms.js` | 羽琪 |
| 开发/优化「报告生成」 | `static/pages/report.js` | 吴超 |
| 改通用能力/配色/筛选/内核 | `static/core/core.js`、`core/data.js`、`style.v6.css` | 仅赵莹 |
| 改入口/导航/加 tab | `static/index.html` | 仅赵莹 |
| 更新数据 | 由赵莹跑取数脚本生成 `data.js` | 仅赵莹 |

## 三、开发自检命令（每人都要会）

```bash
# 1) 语法校验（全量）
node build/check.js
# 只校验自己一个文件：
node build/check.js static/pages/overview.js

# 2) 冒烟测试：用真实 data.js 在 Node 里渲染 7 页，抓运行期异常
node build/smoke.js static
# 部署态（合并单文件）也测一遍：
node build/smoke.js dist

# 3) 打包部署（赵莹）：合并 core+7页 → dist/
node build/bundle.js
```

## 四、数据：只有离线 Excel，没有离线 Excel

> 2026-09-18 起项目**彻底脱钩离线 Excel**。数据源只有 `build/sources/` 下的 Excel，构建时固化进 `static/data.js`，运行时不联网。

- **默认**：`static/data.js` 已是 Excel 生成的真实数据快照，直接开发即可。
- **更新数据（替换 Excel 后按序重跑）**：
  ```bash
  python build/build_from_xlsx.py     # 终版 Excel -> data.js 主数据
  python build/build_extra.py         # 质效分析 + 用户行为记录 -> 覆盖质效/埋点块
  python build/fix_data_sept18.py     # 重建省份域 + 回填智能体服务环节（补丁）
  python build/strip_kdocs.py         # 清除任何离线 Excel痕迹（幂等兜底）
  node build/encrypt_data.js          # 加密 -> dist/data.js.enc（密码 12345678）
  node build/bundle.js                # 打包 -> dist/
  ```
- **mock 仅供本地开发**：`build/mock/*.json`、`static/data.dev.js` 不要覆盖线上 `data.js`。
- 早期从离线 Excel取数的脚本（`build_real.py`、`kdocs_*.py`、`(已删除)`、`parse_kdocs_month.py`、`build/build_from_xlsx.py`）已删除或标注**已废弃**，不要重跑，否则 `data.js` 会回退到旧数据。

## 五、数据源清单（build/sources/）

| Excel | 供给看板的哪些内容 |
| --- | --- |
| 《【合】灵运BI重要数据（终版）.xlsx》 | 总览 / 分省总览 / 智能体明细 / 应用聚合（主数据） |
| 《【合】灵运BI重要数据_智能体分类_20260902.xlsx》 | 智能体服务环节 / 应用场景分类 |
| 《质效分析.xlsx》 | 质效月度汇总、31 分中心等效人年排名 |
| 《用户行为记录.xlsx》 | 平台埋点（周 / 月：点击 · 访客 · 曝光） |

- 脚本按「工作表名 + 表头名」匹配：改工作表名或列标题会导致该列取数为空。
- `pages/<id>.data-source.json` 只是字段契约说明，其中 `fileId` 已作废，只看 `xlsx` 字段。
> 页面**永远不写取数逻辑**——数据全部由 `build/` 下的脚本离线生成。

## 六、协作方式（二选一，见决策结论表）

### A. Git 私有仓【推荐】
- 赵莹建私有仓，三人 clone。
- 每人只在自己 `pages/<id>.js` 上提交（物理隔离，零冲突）。
- 赵莹负责 `pull`、合并、跑 `build/bundle.js` + 部署。

### B. 打包 zip 分发【备选，不熟 git 时用】
1. 赵莹把 `lingyun_dashboard/` 打包 `base.zip` 发给两人。
2. 两人解压，只改自己 `pages/<id>.js`，把改好的文件回传。
3. 赵莹把回传的文件按名覆盖进自己的 `lingyun_dashboard/pages/`，跑校验+打包+部署。
> 打包时务必只回传 `pages/<id>.js`，不要覆盖 `data.js` / `core/` / `index.html`。

## 七、部署（赵莹）

```bash
node build/bundle.js          # 生成 dist/

# 首选：腾讯云 COS 静态网站托管（国内稳，需你提供桶+密钥，我可配一键同步）
#   建桶 → 开「静态网站托管」→ 默认首页 index.html → 把 dist/ 同步上桶

# 备选（不想开云账号，接受国内偶发慢）：Cloudflare Pages / Vercel（纯静态，拖 dist/ 即可）
# 兜底：CloudStudio 静态托管（既往有抖动）
```
部署后把 URL 发全员，打开即看、无需登录。数据更新 = 赵莹重跑取数 → 重新部署。
