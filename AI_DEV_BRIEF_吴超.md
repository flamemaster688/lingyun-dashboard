# AI_DEV_BRIEF · 吴超（数据总览 + 省份分析 + 报告生成）

> 这是给「吴超的 WorkBuddy」的开发简报。你负责三个页面，且**只改下面这三个文件**。

## 你只动的文件（物理隔离，合并零冲突）
- `static/pages/overview.js` —— 数据总览
- `static/pages/province.js` —— 省份分析
- `static/pages/report.js` —— 报告生成（功能设计页，**不连数据源**）

## 你不要碰（除非赵莹同意）
- `core/` 目录、`index.html`、`style.v6.css`、`data.js`、赵莹/羽琪的 `pages/*.js`。

## 怎么开发
1. 本地预览：`cd lingyun_dashboard/static && python -m http.server 8080`，浏览器开 `http://localhost:8080`。
2. 改你负责的 `pages/*.js`：页面是独立 IIFE，通过 `window.registerPage({id,title,icon,render})` 注册，**不要引用其他页面文件**。
3. 取数：用 `LY.data` 或计算视图 `V`（已按筛选过滤）。例如：
   - 数据总览：`var ov = V.overview, cap = V.capability, ags = V.agents, ps = V.provinces;`
   - 省份分析：`var ps = V.provinces;`
   - 报告生成：可引用其它页已加载的数据做汇总，自身不声明数据源。
4. 配色：只用 `STYLE_GUIDE.md` 的 token（冷色为主；异常才用珊瑚红）。

## 提交前自检
```bash
node build/check.js static/pages/overview.js
node build/check.js static/pages/province.js
node build/check.js static/pages/report.js
# 或全量： node build/check.js
```
- 自己页面在浏览器无 console 报错。
- 未引入粉/暖色块；异常才用珊瑚红。
- 未改动 `core/`、`index.html`、`style.v6.css`、`data.js`。

## 接你的金山文档（取数）
1. 拿到你的金山文档后，编辑 `static/pages/overview.data-source.json` 和 `province.data-source.json`，
   填 `fileId` / 各 `feeds[].sheet` / `range` / `fields`（模板已给，含 overview/capability/agents/provinces 等域）。
2. 把填好的 json 发给赵莹（她统一取数生成 `data.js`）。**你不在页面里写取数逻辑**。
3. `report` 页不连数据源，无需填声明。

## 注意
- 总览/省份/质效为全国汇总（数据源无分省明细），省份筛选当前不生效——这是数据限制，不是 bug，页面已标注缺口。
- 模型成功率/耗时无字段，相关处显「/」。
