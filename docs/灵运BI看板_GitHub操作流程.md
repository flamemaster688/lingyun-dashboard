> **注（2026-09-18 起）**：本项目已改为**纯离线**——数据源只有 `build/sources/` 下的 Excel，构建时固化进 `data.js`，运行时不联网、不接任何离线 Excel。
> 下文若出现「Excel」且语义偏「在线协作」，均为历史描述，实际以离线 Excel 为准。

# 灵运BI看板 · GitHub 多人协作操作流程

> 适用：赵莹（仓库主人）、吴超、羽琪 三人用 **GitHub** 连通文件。  
> 前提：项目已按「文件物理隔离」设计，每人只动自己负责的 `pages/*.js`，共享文件只有赵莹动 —— **接 git 后几乎不会冲突**。

---

## 0. 平台说明（GitHub 注意事项）

- GitHub 是代码托管，**国内访问偶尔偏慢但可用**；不影响日常提交/合并（都是小文件）。
- GitHub 上「合并请求」叫 **Pull Request（PR）**，下面统一用 PR。
- **认证**：GitHub 自 2021 年起不再接受「账号密码」推代码，必须用 **Personal Access Token（令牌）** 或 **SSH 密钥** 或 **GitHub Desktop（浏览器登录，最省事）**。
- 部署仍走之前的决策：**腾讯云 COS / Cloudflare Pages**（GitHub 只管代码，不管看板部署）。

---

## 1. 赵莹一次性准备（约 15 分钟）

### 1.1 注册 / 登录 GitHub

- 打开 <https://github.com> ，用邮箱注册或登录。
- 建议顺手装 **GitHub Desktop**（<https://desktop.github.com> ，Windows 版）——后面你和同事都靠它免令牌提交。

### 1.2 新建私有仓库（关键：不要初始化）

1. 点右上角 **＋ → New repository**。
2. Repository name 填 `lingyun-dashboard`。
3. 选 **Private**（私有，只你们三人可见）。
4. **不要**勾选 "Add a README file" / "Add .gitignore" / "Choose a license" —— 因为我们本地已有完整仓库和提交历史，勾了反而要额外合并。
5. 点 **Create repository**。

### 1.3 把本地仓库推上去（接远程）

> 你本地 `lingyun_dashboard/` 我已经 `git init` 好了（分支 `main` + `dev-wuchao` + `dev-yuqi`）。  
> 把下面 `<你的用户名>` 换成你的 GitHub 用户名：

```bash
cd lingyun_dashboard

# 方式A：HTTPS（配合令牌或 GitHub Desktop）
git remote add origin https://github.com/<BaileyYing>/lingyun-dashboard.git

# 方式B：SSH（需先在 GitHub 加过 SSH 密钥，见第 5 节）
# git remote add origin git@github.com:<你的用户名>/lingyun-dashboard.git

git push -u origin main
git push origin dev-wuchao dev-yuqi
```

- 第一次 push 会弹窗要认证：
  - 用 **GitHub Desktop** 推送 → 自动浏览器登录，无需记令牌；
  - 用命令行 HTTPS → 密码框填 **Personal Access Token**（不是账号密码），令牌在 GitHub → Settings → Developer settings → Personal access tokens 生成，勾 `repo` 权限。
- 推送成功后，GitHub 网页就能看到代码了。

### 1.4 邀请协作者 + 保护 main 分支

1. 仓库页 → **Settings → Collaborators**（或 Access → Collaborators）→ **Add people**，输入吴超、羽琪的 GitHub 账号/邮箱，发邀请，他们接受即可（给 **Write** 权限）。
2. 仓库页 → **Settings → Branches → Add rule**：
   - Branch name pattern 填 `main`
   - 勾选 **Require a pull request before merging**（禁止直接 push，必须走 PR）
   - 保存。

---

## 2. 认证方式三选一（给同事参考）

| 方式                                | 适合          | 做法                                              |
| --------------------------------- | ----------- | ----------------------------------------------- |
| **GitHub Desktop** ✅推荐            | 吴超/羽琪（非技术）  | 装好后浏览器登录 GitHub，之后点按钮就能 Clone/Commit/Push，不用管令牌 |
| **HTTPS + Personal Access Token** | 习惯命令行的你     | push 时密码框填令牌（见 1.3）                             |
| **SSH 密钥**                        | 想一劳永逸、不怕配密钥 | 本地生成密钥对，公钥贴到 GitHub → SSH keys；之后免密             |

---

## 3. 吴超 / 羽琪 日常（非技术，用 GitHub Desktop）

> 以吴超为例，羽琪把分支/文件名换成自己的（`dev-yuqi` / `agents.js` / `alarms.js`）。

1. **Clone（仅第一次）**：打开 GitHub Desktop → File → Clone repository → 选 `lingyun-dashboard` → 选个本地保存目录。
2. **切到自己的分支**：左上角 Current branch → 选 `dev-wuchao`。
3. **改页面**：用 WorkBuddy 照 `AI_DEV_BRIEF_吴超.md` 改 `pages/overview.js`、`pages/province.js`、`pages/report.js`；双击 `index.dev.html` 看 mock 效果。
4. **提交**：GitHub Desktop 会自动列出改动文件 → 在左侧**只勾选自己改的那几个 `pages/*.js`** → 写一句说明（如「优化总览页 KPI 卡片」）→ **Commit to dev-wuchao** → 点 **Push origin**。
5. **提 PR**：去 GitHub 网页 → 仓库 → **Pull requests → New pull request** → base 选 `main`、compare 选 `dev-wuchao` → 写说明 → **Create pull request** → 指派（assign）给赵莹。

> 也可以**让 WorkBuddy 帮他们跑 git**（在他们电脑上），开场白模板：  
> 「我在做灵运BI看板项目。请帮我把这次改动提交并推送到分支 `dev-wuchao`：只提交我负责的 `pages/overview.js`、`pages/province.js`、`pages/report.js`；写清楚改了什么；不要碰 `core/`、`index.html`、`data.js`、`style.v6.css` 和别人的文件；推送后告诉我结果。」

**红线（和前端规范一致）**

- ✅ 只提交自己负责的 `pages/*.js`（+ 自己的 `pages/<id>.data-source.json`）。
- ❌ 绝不提交 `core/`、`index.html`、`data.js`、`style.v6.css`。
- ❌ 不要 `git merge`、不要切到别人分支改东西。

---

## 4. 赵莹合并 PR 与发布

### 4.1 在 GitHub 网页合并（最直观）

- 收到 PR 通知 → 打开 PR → 看 **Files changed**（确认只有对方那几个文件）→ 点 **Merge pull request** → Confirm。
- 合并后 `main` 就是最新版。

### 4.2 命令行合并（可选）

```bash
git checkout main
git pull origin main
git merge dev-wuchao
git push origin main
```

### 4.3 接真实数据 + 打包部署（只在你这里做）

```bash
# 两人回填 pages/<id>.data-source.json 后，由你统一接数据
python build/build_from_xlsx.py merge   # 生成 data.js
node build/bundle.js               # 生成 dist/
# 部署到 COS / Cloudflare Pages（见决策表第 4 节）
git add data.js && git commit -m "data: 接入最新离线 Excel数据" && git push origin main
```

---

## 5. 常见坑

- **push 提示要密码但输了账号密码失败** → GitHub 不接受密码，HTTPS 方式要填 **Personal Access Token**；或直接用 GitHub Desktop 免令牌。
- **国内访问慢** → 不影响小文件提交；若 clone/push 经常超时，可改用 **SSH** 或给 git 配代理；看板本身部署在 COS/Cloudflare，最终用户不受影响。
- **创建仓库时手滑勾了 README/.gitignore** → 本地 push 会报「non-fast-forward」。解决：重新建一个**完全空**的仓库，再 push；或 `git pull origin main --allow-unrelated-histories` 后合并（麻烦，不推荐）。
- **冲突极少**：隔离设计下基本不会发生；万一同一文件同段被两人改，git 标 `<<<<<<<`，你留正确版、删标记、再提交即可。
- **别把大文件/私密文件推上去**：`.gitignore` 已忽略 `dist/`、`*.zip`、`.workbuddy/`、旧版本脚本；`data.js`/`data.dev.js` 正常进库（共享数据）。

---

## 6. 与现有本地仓库的衔接（速查）

你本地 `lingyun_dashboard/` 当前状态：

- 分支：`main`（基线）、`dev-wuchao`、`dev-yuqi` ✅ 已建
- 提交：基座 init + 清理私有文件，共 2 个 commit ✅
- 远程：**尚未添加**（等你建好 GitHub 仓库）

建好空私有仓后，只需：

```bash
cd lingyun_dashboard
git remote add origin https://github.com/<你的用户名>/lingyun-dashboard.git
git push -u origin main
git push origin dev-wuchao dev-yuqi
```

然后走第 1.4 节邀请协作者 + 保护 main，即可开工。
