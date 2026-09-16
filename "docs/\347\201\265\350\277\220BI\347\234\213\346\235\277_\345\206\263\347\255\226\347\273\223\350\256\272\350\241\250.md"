# 灵运 BI 看板 · 6 项决策结论表

> 用途：基座负责人（赵莹）在分发「基座包」前，把关键决策定下来、写清楚。
> 标注【待确认】的条目需要你（或对应同事）最终拍板；标注【推荐】的是我的建议值。
> 配套文件：`lingyun_dashboard/STYLE_GUIDE.md`、`data-contract.json`、`RUN.md`、各人 `AI_DEV_BRIEF_*.md`。

---

## 1. Tab 名称（已定）

| # | Tab | 页面 id | 是否连数据源 | 负责人 |
|---|-----|---------|--------------|--------|
| 1 | 数据总览 | `overview` | 是 | 吴超 |
| 2 | 智能体 | `agents` | 是 | 羽琪 |
| 3 | 平台分析（埋点） | `tracking` | 是 | 赵莹 |
| 4 | 省份分析 | `province` | 是 | 吴超 |
| 5 | 质效分析 | `quality` | 是 | 赵莹 |
| 6 | 告警中心 | `alarms` | 是（暂无数据，先占位） | 羽琪 |
| 7 | 报告生成 | `report` | 否（功能设计，不连数据源） | 吴超 |

---

## 2. 每个 Tab 对应金山文档 / sheet / 范围

> ⚠️ **【待确认】各页对应的金山文档尚未提供，由个人提供。**
> 下面给出「标准声明模板」，每位同事拿到自己的金山文档后，填到 `lingyun_dashboard/pages/<页面id>.data-source.json`，
> 基座负责人用 `build/fetch-data.py` 统一取数、生成 `data.js`。页面本身**不写取数逻辑**。

标准声明模板（`pages/<id>.data-source.json`）字段：

```json
{
  "page": "overview",
  "owner": "吴超",
  "docName": "金山文档文件名（待填）",
  "fileId": "金山文档 file_id（待填，kdocs 连接器需要）",
  "sheet": "工作表名（待填）",
  "range": "A1:Z100（取数范围，待填）",
  "fields": ["month", "calls", "personYear", "activeAgents"],
  "refresh": "daily",
  "note": "该页取数说明"
}
```

| Tab | 该页数据来自哪个业务域（见 `data-contract.json`） | 个人需提供的金山文档 |
|-----|--------------------------------------------------|----------------------|
| 数据总览 | `overview`(kpis/monthly) + `capability` + `agents` + `provinces` | 吴超：总览/能力/智能体/省份相关表 |
| 智能体 | `agents` + `tracking` | 羽琪：智能体清单 + 埋点(调用)表 |
| 平台分析(埋点) | `tracking` | 赵莹：埋点日志/页面点击表 |
| 省份分析 | `provinces` | 吴超：各省调用量/Token/费用表 |
| 质效分析 | `centerYearRank` + `capability` | 赵莹：等效人年汇总/多能力表 |
| 告警中心 | `alerts`（当前为空，先占位） | 羽琪：告警/异动明细表（数据源待建设） |
| 报告生成 | 不连数据源 | 无 |

> 注意：当前真实数据来自**单一**金山文档「数据验证」(`fileId` 见 `data.js` 的 meta)。未来若每页独立文档，
> 取数脚本会把多份 JSON 合并进同一个 `data.js`（顶层键 `overview/agents/provinces/tracking/capability/centerYearRank/alerts`）。

---

## 3. 3 人分工（已定）

| 角色 | 姓名 | 负责页面 | 在仓库里只动的文件 |
|------|------|----------|--------------------|
| 基座负责人 | 赵莹 | 平台分析(埋点)、质效分析 + 统一取数/部署 | `core/core.js`、`core/data.js`、`build/*`、`data.js`、部署 |
| 成员 A | 吴超 | 数据总览、省份分析、报告生成 | `pages/overview.js`、`pages/province.js`、`pages/report.js` |
| 成员 B | 羽琪 | 智能体、告警中心 | `pages/agents.js`、`pages/alarms.js` |

> 物理隔离：每人只改自己 `pages/<id>.js`，合并基本零冲突。共享文件（index.html / core / 契约 / 样式）只有赵莹能改。

---

## 4. 部署平台【**已定**：GitHub Pages（免费·首选）/ 腾讯云 COS · Cloudflare Pages（备选）】

> Netlify 信用额度已耗尽（无法再免费部署）。改用 **GitHub Pages**：仓库已经在 GitHub 上，纯免费、**无额度上限**，自动部署、生成可分享链接。

| 候选 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **GitHub Pages** | 纯免费、无信用额度上限、与 GitHub 仓库同源、push 即自动部署、打开即看无需登录 | 国内访问偶有不稳（GitHub CDN 在大陆非全程优化） | **【已定·首选】** |
| 腾讯云 COS 静态网站托管 | 国内稳（31 分中心访问快） | 需一个腾讯云账号 + 建桶（一次性） | 【备选，若国内访问太慢则切】 |
| Cloudflare Pages | 纯静态、免费、拖 zip 即部署、CDN 对国内比 GitHub 友好 | 需 Cloudflare 账号（免费） | 【备选，国内访问更稳时切】 |
| Netlify | 之前在用 | **信用额度已耗尽，不可再免费部署** | ❌ 弃用 |
| Vercel / CloudStudio | — | 国内偶发慢 / 历史抖动 | 兜底，不推荐 |

> **部署动作（赵莹）**：已写好 `.github/workflows/deploy.yml`——只要往 `main` push，就自动 `build/bundle.js` 生成 `dist/` 并发布到 GitHub Pages。
> **赵莹仅需 3 步**：① 把仓库 `git push` 到 GitHub（见《GitHub操作流程》）；② 仓库 Settings → Pages → Source 选「GitHub Actions」；③ 之后任意 push 自动出链接 `https://<用户名>.github.io/lingyun-dashboard/`。
> 共享链接打开即看、无需登录。数据是「最近一次构建的快照」，更新 = 赵莹重跑取数 → push → 自动重新部署。

---

## 5. 协作方式【**已定**：Git 私有仓（GitHub）已采用 / 打包 zip 分发（备选）】

| 方式 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **Git 私有仓（GitHub）** | 赵莹建私有仓 `lingyun-dashboard`，三人 clone，各自提交自己 `pages/`（分支 `dev-wuchao`/`dev-yuqi` → PR 合入 `main`） | 版本可追溯、一处汇总、可回滚、可审查、实时连通 | 需基本 git 操作（已用 GitHub Desktop 降低门槛） | **【已定·采用】** |
| 打包 zip 分发 | 赵莹把 `灵运BI看板_基座包.zip` 发两人；两人改完把自己负责的 `pages/*.js` 回传，赵莹合并 | 零工具门槛、适合临时/对外演示 | 无版本历史 | 【备选，演示/应急时用】 |

> **合并都由赵莹做**（文件夹隔离≈零冲突）。详细 GitHub 操作流程见 `灵运BI看板_GitHub操作流程.md`。
> 本地仓库已 `git init`（分支 `main` + `dev-wuchao` + `dev-yuqi`，2 个 commit），赵莹建好空私有仓后 `git remote add` + `push` 即可（见操作流程第 6 节）。
> zip 分发仍可随时用 `build/make_zip.py` 打快照，与 git 并存。

---

## 6. 配色基线【冷色为主 + 图表用鲜艳冷调强调色】

> 依据：你偏好冷色系（蓝/雾蓝/薄荷绿），不喜欢粉/暖色；异常状态用克制的珊瑚红。

**基础 token（写入 `STYLE_GUIDE.md`，全站统一）：**

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色 Primary | `#2F6FED` / 雾蓝 `#5B8FF9` | 导航、标题、主按钮 |
| 次色 Secondary | `#2FC4B2` 薄荷绿 / `#36CFC9` 青绿 | 辅助图形、成功态 |
| 背景 Surface | `#FFFFFF`，页面底 `#F5F8FC` | 浅色主题 |
| 文字 Text | 主 `#1F2A3D`，次 `#5A6B82` | — |
| 异常/告警 Alert | `#FF6B6B` 珊瑚红（克制使用） | **仅**告警、异常、缺口标记 |
| 图表调色板（顺序取用） | `#2F6FED #2FC4B2 #5B8FF9 #36CFC9 #7C6FF0 #F2A33C #FF6B6B #4CAF87` | 前 5 为冷调，后 3 为暖强调（橙/红/绿）按需点缀 |

> 规则：常规图表优先用前 5 个冷色调；只有「异常/告警/缺口」才允许出现珊瑚红；禁止大面积粉/暖色块。

---

## 决策状态汇总（赵莹 2026-08-18 拍板）

| # | 决策项 | 结论 | 状态 |
|---|--------|------|------|
| 1 | Tab 名称 / 页面 id / 负责人 | 7 个 tab，分工见第 3 节 | ✅ 已定 |
| 2 | 各 tab 金山文档映射 | 用 `pages/<id>.data-source.json` 模板，个人填 fileId | ✅ 模板已就绪，待个人回填 |
| 3 | 3 人分工 | 赵莹(埋点/质效+基座)、吴超(总览/省份/报告)、羽琪(智能体/告警) | ✅ 已定 |
| 4 | 部署平台 | **腾讯云 COS 静态网站托管**（首选）；Cloudflare Pages 备选 | ✅ 已定（待你提供账号/密钥） |
| 5 | 协作方式 | **Git 私有仓（GitHub）** 已采用；打包 zip 分发备选 | ✅ 已定（2026-08-21 改为 GitHub） |
| 6 | 配色基线 | 冷色为主 + 珊瑚红仅用于异常 | ✅ 已定 |

### 剩余 1 件需你做的事（卡点）
- **提供腾讯云账号或 COS 桶访问密钥**（SecretId / SecretKey，或桶名 + 地域）。给我后，我会把 `build/bundle.js` 产物自动同步到桶并开静态网站托管，给你一条可分享的链接。
  - 若你不想开腾讯云账号 → 改用 **Cloudflare Pages**：你把 `dist/` 文件夹拖到 Cloudflare Pages 即可，无需给我任何密钥（国内偶发慢，可接受则最省事）。

### 剩余流程性待办（不卡决策，按节奏推进）
- 吴超 / 羽琪 把各自的 `pages/<id>.data-source.json` 填好 `fileId/sheet/range` 回传 → 赵莹跑 `build/fetch-data.py merge` 接真实数据 → `bundle.js` 打包 → 部署发链接。
