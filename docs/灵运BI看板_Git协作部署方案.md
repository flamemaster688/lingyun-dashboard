# 灵运 BI 看板 — Git 多人协作 + 零成本部署发版方案

> 目标：把当前本地静态看板迁移到 **Git 仓库**（多人管理源码与数据），托管到 **完全免费** 的静态平台，并通过 **每个分支 / PR 自动生成的预览链接** 进行调试与发版。全程 **0 资金**。

---

## 0. 为什么必须换掉现在的方案

| 现状问题 | 说明 |
|---|---|
| Netlify 额度耗尽（403） | 当前公开站点已无法更新 |
| **Netlify 2026 年改为按提交者收费** | 每个向仓库提交的人按 $19/月计费 → 多人协作 = 直接破费，不符合"没有资金" |
| 本地多副本数据不一致 | `_prod_check/`、`dist/` 等部署中间产物的 `data.js` 是空壳，误打开即全 0 |
| 无版本管理 | 谁改了什么、数据何时变、如何回滚，全靠人脑记 |

→ **结论：迁移到 GitHub（代码）+ Cloudflare Pages（托管+预览）。**

---

## 1. 技术方案总览（零成本）

| 平台 | 用途 | 2026 免费额度 | 是否满足需求 |
|---|---|---|---|
| **GitHub**（公开仓库） | 代码托管 + 多人协作 + PR 评审 | 无限公开仓库、无限协作者、2000 Actions 分钟/月 | ✅ 核心 |
| **Cloudflare Pages** | 静态托管 + **每 PR/分支自动预览链接** + 自动 SSL | 无限带宽/请求、500 构建/月、1 并发、100 自定义域名、单文件 ≤25MiB、PR 预览 | ✅ **首选** |
| GitHub Pages（备选） | 纯静态托管 | 免费、100GB/月带宽 | ⚠️ 无原生 PR 预览，仅做兜底 |
| Gitee Pages（国内备选） | 国内访问更稳的静态托管 | 免费（需实名） | ⚠️ 无原生 PR 预览 |

**为什么选 Cloudflare Pages 而不是 Netlify/Vercel**：Netlify 已按人收费；Vercel 免费层有带宽/席位限制；Cloudflare Pages 免费层"无限带宽 + PR 预览"最契合"多人 + 零资金 + 要预览链接"。

> 注意：Cloudflare Pages 免费层 **CF 后台仅 1 个席位**（只能 1 人登录 CF 控制台改设置）。但这不影响多人协作——**协作全在 GitHub 上发生**（PR、评论、预览链接人人可访问），CF 设置只配一次即可。

---

## 2. 仓库结构设计（推荐 Mode A：提交生成后的 data.js）

当前看板是"纯静态 + 一个由 Python 生成的 `data.js`（10.7MB）"。最省事、对非技术同学最友好的做法是 **直接把生成好的 `data.js` 提交进仓库**，托管平台无需任何构建命令，推上去即上线。

```
lingyun-bi/                         ← Git 仓库根
├── .github/
│   └── workflows/
│       └── refresh-data.yml        ← （可选）定时/手动刷新数据并自动提交
├── build/                          ← 构建脚本与真源数据（纳入版本控制）
│   ├── build_real.py               ← 汇总所有域 → static/data.js（含 platformMonthly）
│   ├── dump_month_full.py         ← 平台分析-月 全量 dump：kdocs JSON → _raw_month_*.csv
│   ├── parse_kdocs_month.py       ← 单 sheet 解析（网格还原 → CSV）
│   ├── gen_agents_overview.py
│   └── sources/                    ← xlsx / csv 原始数据
│       ├── agents_overview.json    ← 22,514 条智能体宽表（11.4MB）
│       ├── _raw_qe_monthly.csv
│       ├── _raw_month_05.csv … _raw_month_08.csv   ← 平台分析-月 4 个月真源（dump_month_full.py 产出）
│       ├── _raw_month_05_sample.csv … _raw_month_08_sample.csv  ← 样本（验证用，isSample 标记）
│       └── 灵运BI重要数据模拟-v2.xlsx
├── static/                         ← 【部署根目录】Cloudflare Pages 的 Publish 目录
│   ├── index.html
│   ├── style.v6.css
│   ├── core/   (core.js, data.js)
│   ├── pages/  (overview.js / agents.js / quality.js / tracking.js / tracking-monthly.js …)
│   ├── vendor/ (echarts.min.js …)
│   └── data.js                    ← 由 build 生成后提交（≤25MiB ✅）
├── README.md                       ← 项目说明 + 本地运行 / 数据更新指引
└── .gitignore
```

**两种数据模式（请见第 11 节决策点）：**
- **Mode A（推荐）**：`data.js` 提交进仓库。任何人 `git clone` 后双击 `static/index.html` 即可看，无需跑 Python。
- **Mode B（更"工程化"）**：`data.js` 加入 `.gitignore`，用 GitHub Actions 跑 `build_real.py` 生成后再部署。优点是不把大文件进历史；缺点是需维护 CI、对非技术同学门槛高。

---

## 2.1 平台分析（月度）页：数据源 / 用户级去重 / 构建链路

「平台分析（月度）」页（注册 id = `pages-monthly`）接入**独立的在线文档「平台分析-月」**，与「平台分析（周）」是两份不同的源：

- **文档**：「平台分析-月」`file_id = e9WB6rKPh1MuxmekMsGdrxBn4VZNyGuTY`（link: https://www.kdocs.cn/l/cv4JlshDWcju）
- **结构**：4 个月 sheet（5 / 6 / 7 / 8 月）；每 sheet 13 列、3 个并排 block：
  - 点击量 cols0-3：`province, NAME, PAGE, COUNT`
  - 访客人数 cols5-7：`province, PAGE, count`（**无 NAME**）
  - 曝光次数 cols9-12：`province, NAME, PAGE, COUNT`
- **关键**：点击量与曝光次数 block 含 **NAME** 字段 → 可构造 `省份-姓名` 作为用户唯一 ID，从而做**真实用户级去重**（而不是用访客求和近似）。

### 用户级去重口径（本页核心）
| 指标 | 口径 |
|---|---|
| 月活跃用户数 **MAU** | 各月 `(省份-姓名)` 去重集合大小（取 点击/曝光 block 的 NAME 并集，覆盖所有真实使用用户） |
| 月新增用户数 | 本月用户 − 此前所有月并集；**基线月 5 月无前置 → 显示 `/`** |
| 月留存率 | 上月活跃 ∩ 本月活跃 ÷ 上月活跃；**首个有效点 6 月→**；5 月显示 `/` |
| 应用转化率（原"应用打开率"已更名） | Σ点击量 ÷ Σ曝光次数（页面级真实，上限 100%） |

> 更名原因：原"应用打开率"在周度数据下只能以「三级页点击 ÷ 三级页曝光」近似；月度文档自带 NAME，转化率改为页面级真实口径（点击 ÷ 曝光）。

### 构建链路（build_real.py 已内置 `parse_month_csv` + `platformMonthly` 域）
1. kdocs `get_range_data` 拉 4 个月 sheet → 落盘 `_raw_month_<mm>.json`（由每日自动化经 `dump_month_full.py` 完成）。
2. `dump_month_full.py` 把 JSON 还原网格 → `_raw_month_05.csv … _raw_month_08.csv`（列：`block,province,name,page,count`）。
3. `build_real.py` 读取上述 CSV，聚合出顶层域 **`platformMonthly`**（含 `userKeysByMonth / mauByMonth / newByMonth / retByMonth / convRate / totalsByMonth / pageByMonth / moduleByMonth / provinceByMonth / provinceModuleByMonth`），写入 `static/data.js`。
4. 前端 `pages/tracking-monthly.js` 经 `core/data.js` 的 `PAGE_DOMAINS["pages-monthly"] = ["platformMonthly"]` 读取该域渲染。

> ⚠️ **真实数据需全量 dump**：仓库内 `_raw_month_0*_sample.csv` 仅为样本（约 16 行/月），用于在超大 Kdocs 结果无法回传时验证管道；此时 `platformMonthly.isSample = true`，页面显示「样本验证数据」徽标。全量 dump 后用 `dump_month_full.py` 覆盖为无 `_sample` 后缀的 `_raw_month_0*.csv` 再跑 `build_real.py`，即转为真实数据（徽标消失）。

---

## 3. 多人协作与发版流程（天然满足"多人链接调试发版"）

```
main 分支 = 生产环境（自动部署到 xxx.pages.dev）
   ▲ 合并即发版
dev / feature/xxx 分支 = 调试环境
   │ 推分支 / 开 PR
   ▼
Cloudflare Pages 自动生成预览链接：<分支名>.xxx.pages.dev
   │ 团队成员点链接调试、在 PR 里评论
   ▼
approve + merge → main → 生产自动更新
```

要点：
- **调试链接零成本自动产生**：每次开 PR 或推新分支，CF 都给一个独立预览 URL，谁有链接谁就能看，无需登录。
- **发版 = 合并 PR**：无需手动部署，合并即上线，且 CF 保留全部历史部署，可一键回滚。
- **代码评审**：数据改错、页面 bug 都在 PR 里被同事看到再合，避免"本地改完直接覆盖"。

---

## 4. Cloudflare Pages 部署步骤清单

| 步 | 操作 | 验证方式 | 常见失败 |
|---|---|---|---|
| 1 | 注册 Cloudflare 账号（免费） | 能进 dashboard | 邮箱验证未过 |
| 2 | 在 GitHub 建好 `lingyun-bi` 公开仓库并 push 代码 | `git ls-remote` 能看到 | 仓库为空 / 权限 |
| 3 | CF 控制台 → Pages → Create a project → 连接 GitHub → 选 `lingyun-bi` | 授权成功 | GitHub 未授权 CF |
| 4 | 构建设置：**Framework = None**；**Build command 留空**；**Publish directory = `static`** | 设置页保存成功 | 目录名写错导致 404 |
| 5 | 首次部署 → 获得 `https://lingyun-bi.pages.dev` | 浏览器打开能看到看板 | data.js 未提交则智能体页空 |
| 6 | 推一个测试分支开 PR → 确认生成 `<分支>.lingyun-bi.pages.dev` 预览 | 预览链接可访问 | 未触发预览（检查仓库连接） |

> 若团队在国内、Cloudflare 访问偶发卡顿：把托管换成 **Gitee Pages**（代码仍可用 GitHub 或 Gitee 仓库），代价是失去"每 PR 自动预览"，需手动开 Pages 服务。

---

## 5. Git 初始化与 .gitignore

```bash
# 在整理好的仓库根目录
git init
git add .
git commit -m "init: 灵运BI看板 静态站点 + 构建脚本"
git branch -M main
git remote add origin https://github.com/<你>/lingyun-bi.git
git push -u origin main
```

`.gitignore`（避免把本地垃圾副本和中间产物带进仓库）：

```gitignore
# Python
__pycache__/
*.pyc
venv/
.env

# 本地部署/构建中间产物（空壳 data.js 来源，切勿入库）
_prod_check/
_deploy_stage/
dist/
0828_delivery/
_smp/                       ← kdocs 样本临时落盘目录（验证用，勿入库）

# 系统
.DS_Store
Thumbs.db
```

> ⚠️ **关键的坑**：务必把 `_prod_check/`、`dist/`、`_deploy_stage/` 排除在仓库外——正是这些目录里的空壳 `data.js` 导致你之前"本地也是 0"。仓库里只留 `static/`（含真实 `data.js`）。

---

## 6. 每日数据自动刷新的衔接

现在 WorkBuddy 的每日自动化（`automation-1786613878719`）会拉金山文档 → 生成 `data.js` → 推 Netlify。迁移后改为 **推 Git**：

**简化版（推荐）：**
1. 自动化拉 **4 份** Kdocs 文档（数据验证 / 质效分析 / 平台分析(周) / **平台分析-月**）→ 更新 `build/sources/` → 跑 `build_real.py` 生成 `static/data.js`
2. 自动 `git add static/data.js build/sources/ && git commit -m "data: 每日刷新" && git push`
3. Git push 触发 Cloudflare Pages 自动部署（无需再单独调 Netlify API）

**平台分析-月 的衔接（第 4 个数据源）：**
- 自动化在取数阶段额外拉「平台分析-月」4 个月 sheet → 落盘 `_raw_month_05.json … _raw_month_08.json`；
- 跑 `python dump_month_full.py`（读取内置 MAP 或同目录 `_month_dump_map.json`）还原网格 → `_raw_month_05.csv … _raw_month_08.csv`；
- `build_real.py` 已内置读取 `_raw_month_*.csv`（优先 `_raw_month_<mm>.csv`，否则回退 `_raw_month_<mm>_sample.csv` 并标记 `isSample`），自动聚合进 `platformMonthly` 域。
- 若某月 sheet 取数失败：跳过该月，不中断整体；页面仅缺少该月数据。

**进阶版（GitHub Actions 定时，无需本地常开）：**
- 在 `build/` 里放带 Kdocs 访问凭证的 Action，仓库 Secrets 存 token，定时跑构建并开 PR/直接推 main。
- 优点是不依赖本地机器；缺点是要把 Kdocs 凭证放进 GitHub Secrets，配置成本略高。

**冲突规避**：数据更新走"单一负责人"或"先开 PR 再合"，避免两人同时改 `data.js` 产生冲突。

---

## 7. 成本确认（逐项 0 元）

| 项目 | 费用 |
|---|---|
| GitHub 公开仓库 + 协作者 | 免费（无限） |
| Cloudflare Pages 托管 + 预览 + SSL | 免费（无限带宽/请求） |
| GitHub Actions（数据刷新 CI） | 免费 2000 分钟/月（公开仓库无限） |
| 默认域名 `*.pages.dev` | 免费 |
| 自定义域名（如自有关联域名） | 域名本身若已有则 0 元；新购才花钱（可选） |

**总投入：0 元。**

---

## 8. 风险与回滚

| 风险 | 应对 |
|---|---|
| Cloudflare 国内访问偶发慢 | 备选 Gitee Pages；或用已备案自定义域名走 CF 优化 |
| 大文件 `data.js` 10.7MB | CF 单文件上限 25MiB、GitHub 单文件 100MB，均远未超限，无需 Git LFS |
| 密钥泄露 | 纯静态站点、无服务端密钥；`NEXT_PUBLIC_` 之类不存在，无暴露面 |
| 多人改 `data.js` 冲突 | PR review + 单一数据负责人 |
| 发版出错 | Cloudflare Pages 保留全部历史部署，**一键回滚**到任意版本；Git 也可 `revert` |
| CF 后台仅 1 席位 | 仅 1 人管 CF 设置；协作全在 GitHub，不受影响 |

---

## 9. 从现状迁移的行动清单

1. **整理权威副本**：确认 `lingyun_dashboard/static/`（已验证 45028 行 `isActive`，数据完整）为唯一真源，删除/隔离 `_prod_check/`、`dist/`、`_deploy_stage/` 等空壳副本。
2. **建仓库 + 搬文件**：按第 2 节结构，把 `static/`、`build/`、`README.md`、`.gitignore` 放进新仓库根。
3. **连 Cloudflare Pages**：按第 4 节 6 步配置（Publish = `static`，无构建命令）。
4. **验证生产 + 预览**：打开 `*.pages.dev` 确认智能体页非 0；开一个测试 PR 确认预览链接可用。
5. **迁移自动化**：把每日自动化从"推 Netlify"改为"commit + push 到 GitHub"，触发 CF 自动部署。
6. **写 README**：记录本地运行（`双击 static/index.html`）、数据更新流程、协作规范。

---

## 10. 权限与访问建议

- 仓库建议设为 **Public**（免费且无限协作者；看板本身无敏感服务端数据）。
- 若因合规必须 Private：GitHub Free 也支持私有仓库，Actions 2000 分钟/月够用，仅 CF 预览链接仍可被任何拿到 URL 的人访问（如需限制访问，可用 Cloudflare Access，免费层含一定额度）。
- 给每位成员配置 **PR 评审权限**，生产分支 `main` 设为受保护分支（需 review 才能合）。

---

## 11. 需要你拍板的决策点

| 决策 | 选项 A（推荐） | 选项 B |
|---|---|---|
| **代码托管** | GitHub（全球，生态最好） | Gitee（国内访问最稳，但功能弱些） |
| **静态托管+预览** | Cloudflare Pages（预览最强，全球） | Gitee Pages（国内稳，无原生 PR 预览） |
| **数据模式** | Mode A：提交 `data.js`（非技术友好） | Mode B：CI 构建（更工程化） |
| **仓库可见性** | Public（免费无限协作） | Private（合规，Actions 有限额但够用） |

拍板后我可以直接帮你把现有 `lingyun_dashboard/static/` 整理成上面的仓库结构、生成 `.gitignore` 与 `README`，并给出连 Cloudflare Pages 的具体操作；要不要我现在就开始搭骨架？
