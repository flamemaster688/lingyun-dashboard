# AI_DEV_BRIEF · 赵莹（基座负责人 / 埋点 + 质效）

> 这是给「赵莹的 WorkBuddy」的开发简报。你负责：维护基座 + 开发「平台分析(埋点)」「质效分析」两个页面。

## 你的权限（你能改）
- `static/core/core.js`、`static/core/data.js`：全局内核与统一数据接口（通用能力/筛选/tab 分发/取数管线）。
- `static/style.v6.css`、`static/index.html`：全局样式与入口（加 tab、改导航）。
- `static/pages/tracking.js`、`static/pages/quality.js`：你自己的两个页面。
- `build/*`（fetch-data.py / check.js / bundle.js / smoke.js）：取数与构建工具。
- `data.js` 生成：跑取数脚本覆盖（勿手改内容）。

## 你不能改（除非协调）
- 吴超的 `pages/overview.js`、`pages/province.js`、`pages/report.js`
- 羽琪的 `pages/agents.js`、`pages/alarms.js`

## 开发规范
- 配色只用 `STYLE_GUIDE.md` 的 token（冷色为主，异常才用珊瑚红）。
- 页面通过 `LY.data` 或计算视图 `V` 取数，**不要直接 fetch 离线 Excel**。
- 两人并行时，你只动自己 `pages/*.js`，合并零冲突。

## 七页同优 vs 单页优化
- 「所有页面统一…」（配色/筛选条/通用组件）→ 改 `core/core.js` 或 `style.v6.css`，7 页同时生效。
- 「只改埋点页/质效页」→ 改 `pages/tracking.js` / `pages/quality.js`，只影响那页。

## 本地预览 / 校验
```bash
cd lingyun_dashboard/static && python -m http.server 8080   # 浏览器开 http://localhost:8080
node build/check.js                                           # 全量语法校验
node build/smoke.js static                                    # 冒烟：渲染 7 页
node build/bundle.js                                          # 打包 dist/ 供部署
```

## 接真实离线 Excel（取数）
1. 收齐吴超/羽琪填好的 `static/pages/<id>.data-source.json`（fileId/sheet/range/fields）。
2. 用 Excel 连接器按声明取数，落盘 `build/sources/<id>.json`（顶层键 = 对应 domain）。
3. `python build/fetch-data.py merge` → 覆盖 `static/data.js`。
4. 重新部署。

## 重要约束（来自历史踩坑）
- 离线 Excel**不能浏览器直连**（CORS+鉴权）→ 取数必须由你统一走 Excel，页面只读 `data.js`。
- 中国地图已本地注册（`vendor/china-register.js`），勿改回 fetch 远程地图。
- JS 改动后若部署有缓存，给文件加版本号（如 `style.v7.css`）。
