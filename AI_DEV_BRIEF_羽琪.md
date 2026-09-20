# AI_DEV_BRIEF · 羽琪（智能体 + 告警中心）

> 这是给「羽琪的 WorkBuddy」的开发简报。你负责两个页面，且**只改下面这两个文件**。

## 你只动的文件（物理隔离，合并零冲突）
- `static/pages/agents.js` —— 智能体
- `static/pages/alarms.js` —— 告警中心（当前为空占位，需补建）

## 你不要碰（除非赵莹同意）
- `core/` 目录、`index.html`、`style.v6.css`、`data.js`、赵莹/吴超的 `pages/*.js`。

## 怎么开发
1. 本地预览：`cd lingyun_dashboard/static && python -m http.server 8080`，浏览器开 `http://localhost:8080`。
2. 改你负责的 `pages/*.js`：页面是独立 IIFE，通过 `window.registerPage({id,title,icon,render})` 注册，**不要引用其他页面文件**。
3. 取数：用 `LY.data` 或计算视图 `V`：
   - 智能体：`var ags = V.agents;`（agents.js 还会用到 `V.tracking` 作为调用量代理指标）
   - 告警中心：`var al = D.alerts || [];`（当前为空；缺口说明读 `D.meta.gaps`）
4. 配色：只用 `STYLE_GUIDE.md` 的 token（冷色为主；**告警/异常可用珊瑚红 `#FF6B6B`**，这是它唯一合适的场景）。

## 提交前自检
```bash
node build/check.js static/pages/agents.js
node build/check.js static/pages/alarms.js
# 或全量： node build/check.js
```
- 自己页面在浏览器无 console 报错。
- 未改动 `core/`、`index.html`、`style.v6.css`、`data.js`。

## 接你的离线 Excel（取数）
1. 拿到你的离线 Excel后，编辑 `static/pages/agents.data-source.json` 和 `alarms.data-source.json`，
   填 `fileId` / 各 `feeds[].sheet` / `range` / `fields`（模板已给）。
2. 把填好的 json 发给赵莹（她统一取数生成 `data.js`）。**你不在页面里写取数逻辑**。
3. 告警中心当前真实数据无告警明细（`alerts` 为空），你先把页面框架/缺口说明做出来，等数据源建设。

## 注意
- 智能体「活跃度/健康分」真实文件无独立字段，相关维度显「/」。
- 告警中心是新增页，指标字典（metrics_catalog）里还没有告警指标，按需自定义并知会赵莹同步。
