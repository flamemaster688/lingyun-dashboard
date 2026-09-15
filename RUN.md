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

## 四、数据：离线用真实快照，或切到 mock

- **默认**：`static/data.js` 已是真实数据快照，直接开发即可。
- **想用 mock 数据**（比如真实数据缺失某页）：
  ```bash
  # 生成 6 份 mock（已生成在 build/mock/，一般不用重跑）
  python build/fetch-data.py extract
  # 合并 mock → 写出 data.dev.js（不覆盖真实 data.js）
  python build/fetch-data.py mock
  # 想用 mock 预览：把 data.dev.js 临时改名覆盖 data.js（预览完再恢复真实数据）
  cp static/data.js static/data.real.bak && cp static/data.dev.js static/data.js
  ```
- **恢复真实数据**：赵莹重跑原 `build_real.py`（真实金山文档取数）覆盖 `data.js`。

## 五、把你的金山文档接进来（个人填，赵莹统一取数）

1. 拿到自己的金山文档后，编辑 `pages/<你的页面id>.data-source.json`，填 `fileId` / `sheet` / `range` / `fields`。
2. 把填好的 json 发给赵莹。
3. 赵莹用 `build/fetch-data.py`（对接 kdocs 连接器）把多份取数结果合并进 `data.js`，重新部署。
> 页面**永远不写取数逻辑**——这是规避「金山文档不能浏览器直连」的关键。

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
