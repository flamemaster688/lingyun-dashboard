> **注（2026-09-18 起）**：本项目已改为**纯离线**——数据源只有 `build/sources/` 下的 Excel，构建时固化进 `data.js`，运行时不联网、不接任何离线 Excel。
> 下文若出现「Excel」且语义偏「在线协作」，均为历史描述，实际以离线 Excel 为准。

# 灵运BI看板 · Git 多人协作指南

> 目标：用 Git 把赵莹、吴超、羽琪三人的工作「连通」到一处，互不覆盖、可回滚、可审查。
> 前提：本项目按「文件物理隔离」设计，每个人只改自己负责的 `pages/*.js`，共享文件只有赵莹动 —— **所以接 git 后几乎不会冲突**。

---

## 0. 一句话原理

| 角色 | 只动的文件 | 不动的文件 |
|------|-----------|-----------|
| **赵莹（你）** | `core/`、`index.html`、`index.dev.html`、`index.legacy.html`、`style.v6.css`、`data.js`、`build/`、`*.md` 文档 | ——（你是守护者） |
| **吴超** | `pages/overview.js`、`pages/province.js`、`pages/report.js`、自己的 `pages/<id>.data-source.json` | 其余全部 |
| **羽琪** | `pages/agents.js`、`pages/alarms.js`、自己的 `pages/<id>.data-source.json` | 其余全部 |

因为「按文件划分 ownership」，git 在这里不是用来「解决冲突」的，而是提供：
- **一处汇总**：三个人最终都汇入 `main`，你那里永远是最新版；
- **版本历史**：谁、哪天、改了什么，随时可查可回滚；
- **可审查**：每人改完提 MR，你先看再合，避免误改共享文件。

---

## 1. 准备工作（一次性）

### 1.1 选一个远程托管平台（国内优先）
| 平台 | 适合场景 |
|------|---------|
| **工蜂**（腾讯内部 Git） | 团队在腾讯体系，内网可达、权限好管 → **推荐** |
| **Gitee**（码云） | 国内公开/私有仓，免费，注册即用 |
| GitLab / GitHub | 若已有账号也可，国内访问略慢 |

赵莹注册/登录，新建一个**私有仓库**，命名为 `lingyun-dashboard`，建好后复制仓库地址（HTTPS 或 SSH）。

### 1.2 三人都装 Git
- Windows：装 **Git for Windows**（自带 Git Bash）。
- 非技术同事（吴超/羽琪）建议额外装一个 **GUI 客户端**，点按钮就能提交，不用敲命令：
  - GitHub Desktop（若用 GitHub）
  - 工蜂客户端 / Gitee 桌面端（对应平台）
  - 或干脆用 WorkBuddy 帮他们跑 git（见第 4 节方式B）

### 1.3 赵莹把本地仓库推到远程（命令见第 3 节）

---

## 2. 推荐的分支模型

```
main            ← 正式基线（赵莹保护 + 维护，禁止直接 push）
├── dev-wuchao  ← 吴超开发分支（只碰 overview/province/report）
└── dev-yuqi    ← 羽琪开发分支（只碰 agents/alarms）
```

- 赵莹改基座：直接在 `main`（或另开 `dev-zhaoying`）。
- 各人改完 → 推自己的分支 → 在网页提 **Merge Request(MR)** 到 `main` → 赵莹审查合并。

> 注：因为文件隔离，其实所有人直接在 `main` 提交也基本不冲突；但「分支 + MR」更稳、可审查、可回滚，非技术同事用 GUI 提 MR 也很轻松。推荐用分支。

---

## 3. 赵莹初始化命令（一次性，本地已完成前两步）

> 下面的 `git init` / `.gitignore` / 首个 commit 我已在本机帮你做好（见仓库根目录）。
> 你只需补上「远程地址」和「推送」两段。

```bash
cd lingyun_dashboard

# —— 以下两步我已帮你做了，你无需重复 ——
git init
git add -A && git commit -m "init: 灵运BI看板基座（core + 7页模块）"

# —— 你来做：接远程仓库 ——
git branch -M main
git remote add origin <远程仓库URL>      # 把 <> 换成工蜂/Gitee 给你的地址
git push -u origin main

# 创建两人的开发分支并推上去
git branch dev-wuchao
git branch dev-yuqi
git push origin dev-wuchao dev-yuqi
```

然后在平台设置两件事：
1. **邀请协作者**：把吴超、羽琪加为 Developer（可推送自己的分支、可提 MR）。
2. **保护 `main` 分支**：设为「禁止直接 push，必须走 MR 合并」。

---

## 4. 吴超 / 羽琪 日常（非技术友好）

### 方式 A：用 GUI 客户端（最省事，推荐非技术同事）
1. **Clone** 仓库（填仓库地址，选保存目录）。
2. 切到**自己的分支**（`dev-wuchao` / `dev-yuqi`）。
3. 用 WorkBuddy 照 `AI_DEV_BRIEF_*.md` 改自己负责的 `pages/*.js`；双击 `index.dev.html` 预览 mock 效果。
4. GUI 里点 **Commit** → 只勾选自己改的那几个文件 → 写一句说明 → **Push**。
5. 网页上点 **New Merge Request** → 目标分支选 `main` → 指派给赵莹。

### 方式 B：让 WorkBuddy 帮他们跑 git（在他们自己电脑上）
开场白模板（吴超示例，羽琪把文件名换掉即可）：

> 我在做「灵运BI看板」项目。请帮我把这次改动提交并推送到我的分支 `dev-wuchao`：
> - 只提交我负责的 `pages/overview.js`、`pages/province.js`、`pages/report.js`；
> - 写清楚我改了什么、为什么改；
> - **不要**碰 `core/`、`index.html`、`data.js`、`style.v6.css` 和羽琪/赵莹的文件；
> - 推送到远程后告诉我结果。

### 红线（和前端规范一致）
- ✅ 只提交自己负责的 `pages/*.js`（+ 自己的 `pages/<id>.data-source.json`）。
- ❌ 绝不提交 `core/`、`index.html`、`data.js`、`style.v6.css`。
- ❌ 不要 `git merge`、不要切到别人分支改东西、不要把别人的文件加进自己的提交。

---

## 5. 赵莹合并与发布

```bash
git checkout main
git pull origin main
git merge dev-wuchao     # 看一眼改动 → 合并
git merge dev-yuqi
git push origin main

# 接真实数据 + 打包部署（只在你这里做）
python build/build_from_xlsx.py merge   # 用两人回填的 data-source.json 接数据 → 生成 data.js
node build/bundle.js               # 生成 dist/
# 部署到 COS / Cloudflare Pages（见决策表第 4 节）
```

- **冲突极少**。万一同一文件同一段被两人改（隔离设计下基本不会发生），git 会标出 `<<<<<<<` 冲突标记，你手动保留正确版本、删掉标记再提交即可。
- 不想敲命令：平台网页点 **Merge** 按钮即可完成合并。

---

## 6. 接真实数据后的协作

- 吴超/羽琪填好 `pages/<id>.data-source.json` 后，**由赵莹统一**跑 `build_from_xlsx.py merge` 生成 `data.js`。
- 这一步只在赵莹本地（或赵莹的 WorkBuddy）做，**不进别人的分支**，避免数据文件被反复覆盖。
- `data.js` 的更新随赵莹的 commit 进 `main`，三人拉取后即是最新数据。

---

## 7. .gitignore（已建好，必含）

```gitignore
dist/            # 部署产物，可重生成，不进库
node_modules/
*.zip            # 基座包不进库（大文件，靠 build/make_zip.py 重打）
.DS_Store
Thumbs.db
*.log
```

> `data.dev.js`（mock）和 `data.js`（真实快照）**都进库**，方便三人共享离线预览与最新数据。

---

## 8. 与 zip 方案的关系

- **git** = 持续连通（实时汇总、可回滚、可审查）—— 适合日常三人协作。
- **zip** = 快照分发（适合临时、对外演示、不想开 git 时）—— `build/make_zip.py` 随时可重打。
- 两者可并存：平时用 git 连通，对外发演示包时仍打 zip。

---

## 9. 已帮你做的事 / 你还需做的事

**已做（本机）**
- `lingyun_dashboard/` 已 `git init` 并首个 commit（基座全量，含 `.gitignore`）。

**你还需做**
1. 在工蜂/Gitee 建私有仓 `lingyun-dashboard`，拿到仓库 URL。
2. 执行第 3 节「接远程仓库」那段（`git remote add` + `git push` + 建两人分支）。
3. 邀请吴超、羽琪为协作者，保护 `main`。
4. 把仓库地址/协作者邀请发两人，他们按第 4 节开工。

> 想让 git 成为「首选协作方式」的话，告诉我，我把决策表第 5 节改成【已定：Git 私有仓（首选）/ zip（备选）】并同步 RUN.md。
