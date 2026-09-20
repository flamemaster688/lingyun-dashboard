// -*- coding: utf-8 -*-
// 生成《灵运BI看板·项目完全手册（小白版）》Word 文档
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak, Header, Footer, PageNumber, TableOfContents
} = require("docx");

const OUT = path.join(__dirname, "..", "docs", "灵运BI看板_项目完全手册_小白版.docx");

// ---------- 样式与工具 ----------
const A4W = 11906, A4H = 16838, M = 1440;
const CW = A4W - M * 2; // 内容宽度 9026

const border = { style: BorderStyle.SINGLE, size: 1, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMarg = { top: 60, bottom: 60, left: 100, right: 100 };

function h1(t) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true })] });
}
function h2(t) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true })] });
}
function h3(t) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, bold: true })] });
}
function p(t, opts) {
  opts = opts || {};
  return new Paragraph({
    spacing: { after: 120, line: 288 },
    children: [new TextRun({ text: t, size: opts.size || 22, bold: opts.bold || false, color: opts.color || "000000" })]
  });
}
// 多段（数组）段落
function ps(arr, opts) {
  return arr.map(function (t) { return p(t, opts); });
}
function bullets(items) {
  return items.map(function (it) {
    return new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { after: 60, line: 276 },
      children: [new TextRun({ text: it, size: 22 })]
    });
  });
}
function nums(items) {
  return items.map(function (it) {
    return new Paragraph({
      numbering: { reference: "numbers", level: 0 },
      spacing: { after: 60, line: 276 },
      children: [new TextRun({ text: it, size: 22 })]
    });
  });
}
function code(text) {
  return new Paragraph({
    spacing: { before: 60, after: 120, line: 240 },
    shading: { fill: "F2F2F2", type: ShadingType.CLEAR },
    children: [new TextRun({ text: text, font: "Courier New", size: 18 })]
  });
}
function table(headers, rows, widths) {
  const total = widths.reduce(function (a, b) { return a + b; }, 0);
  const headerRow = new TableRow({
    children: headers.map(function (ht, i) {
      return new TableCell({
        borders, width: { size: widths[i], type: WidthType.DXA }, shading: { fill: "2E75B6", type: ShadingType.CLEAR },
        margins: cellMarg,
        children: [new Paragraph({ children: [new TextRun({ text: ht, bold: true, color: "FFFFFF", size: 20 })] })]
      });
    })
  });
  const bodyRows = rows.map(function (r) {
    return new TableRow({
      children: r.map(function (cell, i) {
        return new TableCell({
          borders, width: { size: widths[i], type: WidthType.DXA }, margins: cellMarg,
          children: [new Paragraph({ spacing: { line: 264 }, children: [new TextRun({ text: String(cell), size: 20 })] })]
        });
      })
    });
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow].concat(bodyRows)
  });
}

// ---------- 内容 ----------
const children = [];
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "灵运 BI 看板 · 项目完全手册", bold: true, size: 40 })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: "（写给非技术团队的通俗版）", size: 24, color: "595959" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "更新于 2026-09-18  ·  涵盖：目录 / 前后端架构 / 数据连接 / Excel 改造 / 团队分工 / 协作修改 / Vue 升级路线", size: 18, color: "808080" })] }));

children.push(new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-2" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 第1章
children.push(h1("一、一句话先看懂这个项目"));
children.push(p("这是一个「纯前端静态网站」的数据看板（BI = Business Intelligence，说白了就是把数据画成图表的网页）。请记住三条最关键的结论："));
children.push(...bullets([
  "没有后端：没有任何 7×24 小时在后台跑的服务器程序。",
  "没有数据库：没有 MySQL 之类存数据的软件；数据被打成一个大文件 data.js，跟着网页一起下载到浏览器。",
  "有密码保护：因为数据会完整发给每个打开网页的人，所以加了密码（输入 12345678 才能看），数据即使被下载也是加密的。"
]));
children.push(p("打开方式有两种：① 本地双击 static/index.html 看；② 部署到公网后，把链接（如 GitHub Pages）发给别人，对方输密码即可看。三个人分工，每人负责几个页面文件，最后用一条命令把大家的文件合并打包成一个发布版。"));

// 第2章
children.push(h1("二、前后端架构与框架（有没有后端？用什么框架？）"));
children.push(h2("2.1 前端（你看到的网页）"));
children.push(p("用的是最朴素的「网页三件套」：原生 HTML + CSS + JavaScript。这里没有用 React、Vue 这类前端框架——对小白反而友好，因为代码就是一个个网页文件，不需要学框架概念。"));
children.push(...bullets([
  "图表库：ECharts（百度开源的画图工具，柱状图、饼图、中国地图都是它画的）。",
  "Excel 读取：用 SheetJS / openpyxl（Python 端）把 Excel 转成数据。",
  "自己写的极简「内核框架」：挂在全局变量 window.LY 上，负责三件事——① 页面注册 ② 导航切换 ③ 统一数据接口和筛选计算。"
]));
children.push(h2("2.2 后端（后台程序）"));
children.push(p("没有真正运行网站需要的后端。你会在项目里看到一些 Python 文件（如 app.py、(已删除)、(已删除)），它们不是网站的后台，而是「取数工具」：只在刷新数据时本地跑一次，把表格数据拉下来、转成数据文件。平时打开网页根本不碰它们。"));
children.push(h3("一个小提醒：app.py 是什么？"));
children.push(p("根目录下有个 app.py，是一个用 Streamlit + Plotly 写的「演示小工具」，用来做样例数据演示或上传 Excel 试算。它和正式上线的看板是两套东西——正式交付给你们的、挂在公网链接上的，是下面要讲的「静态网站」，不是这个 app.py。日常不用管它。"));
children.push(h2("2.3 整体架构（一张图看懂）"));
children.push(code(
  "浏览器（你看到的网页）\n" +
  "   ├─ index.html      网页骨架（导航 + 各区块空容器）\n" +
  "   ├─ decrypt.js      密码锁：输对密码才解密数据\n" +
  "   ├─ data.js.enc     ★加密后的数据文件（原 data.js 加密而来）\n" +
  "   ├─ lingyun.bundle.js  内核(core) + 所有页面(pages) 合并后的大文件\n" +
  "   └─ style.v6.css    配色、字体、卡片、表格长相\n" +
  "          │  全部是「静态文件」，没有服务器计算\n" +
  "          ▼\n" +
  "部署平台（GitHub Pages / CloudStudio 等静态托管）：只负责把上面这些文件发给浏览器"
));
children.push(p("要点：网站本身不连数据库、不跑后台；所有计算和画图都在「你的浏览器」里完成。这也是为什么数据要加密——因为整份数据都会发到访客的浏览器里。"));

// 第3章 目录
children.push(h1("三、项目目录逐层解释（你该认识的文件夹）"));
children.push(p("项目文件夹叫 lingyun_dashboard/，结构如下。你平时改代码改的是 static/，发布上线用的是 dist/（由 static/ 自动生成），数据来自 build/ 里的脚本。"));
children.push(code(
  "lingyun_dashboard/\n" +
  "├─ static/          👉 网站源码（你平时改的是这里）\n" +
  "│  ├─ index.html       网页骨架（导航栏 + 区块容器）\n" +
  "│  ├─ style.v6.css     全局样式（配色/字体/卡片/表格）\n" +
  "│  ├─ core/            内核框架\n" +
  "│  │  ├─ core.js         导航切换 + 筛选计算 + 页面调度\n" +
  "│  │  └─ data.js        统一数据接口（页面只通过它读数据）\n" +
  "│  ├─ pages/          各页面（每人负责自己的文件）\n" +
  "│  │  ├─ overview.js     数据总览\n" +
  "│  │  ├─ agents.js       智能体\n" +
  "│  │  ├─ province.js     省份分析\n" +
  "│  │  ├─ tracking.js     平台分析（埋点）\n" +
  "│  │  ├─ quality.js      质效分析\n" +
  "│  │  ├─ alarms.js       告警中心\n" +
  "│  │  └─ report.js       报告生成\n" +
  "│  ├─ data.js          ★数据库（自动生成，千万别手改！）\n" +
  "│  ├─ data.js.enc      ★加密后的数据（上线用这个）\n" +
  "│  ├─ decrypt.js       ★密码锁脚本（解密 data.js.enc）\n" +
  "│  └─ vendor/         第三方库（echarts、xlsx、中国地图）\n" +
  "│\n" +
  "├─ build/           👉 构建 & 数据处理脚本（python/node）\n" +
  "│  ├─ build_from_xlsx.py  ★现在的数据入口：Excel → data.js\n" +
  "│  ├─ build_from_xlsx.py / (已删除) / (已删除)  （已停用·离线 Excel旧链路）\n" +
  "│  ├─ encrypt_data.js    ★把 data.js 加密成 data.js.enc\n" +
  "│  ├─ bundle.js         ★打包：把 core+所有 pages 合成一个文件\n" +
  "│  └─ ...（其它一次性/调试脚本）\n" +
  "│\n" +
  "├─ dist/           👉 发布产物（打包后的单文件版，部署用这个）\n" +
  "├─ docs/           文档（含本手册、分析结论等）\n" +
  "└─ data/           样例 CSV 数据（演示用）"
));
children.push(p("一句话记牢：写代码改 static/；发布上线用 dist/；换数据跑 build/ 里的脚本。带 ★ 的是你现在最该关心的几个文件。"));

// 第4章 数据连接
children.push(h1("四、数据从哪来？（数据连接 / 数据接口）"));
children.push(p("这是整个项目最关键的一条链路。请重点理解「数据接口」这个词——它就是前后端之间、页面和数据之间约定好的「取数规矩」。"));
children.push(h2("4.1 数据流转全链路"));
children.push(code(
  "本地 Excel（终版）\n" +
  "   │  (赵莹跑 build_from_xlsx.py，按表头名读取)\n" +
  "   ▼\n" +
  "static/data.js  =  window.LINGYUN_DATA   （网页内置的「数据库」）\n" +
  "   │  (encrypt_data.js 加密)\n" +
  "   ▼\n" +
  "static/data.js.enc   （加密数据，上线用这个）\n" +
  "   │  (浏览器输密码后 decrypt.js 解密)\n" +
  "   ▼\n" +
  "core/data.js  （统一数据接口 window.LY.data）\n" +
  "   │  (页面只读这里，不直接碰 data.js)\n" +
  "   ▼\n" +
  "pages/<id>.js  （各页面取数 → 画图表 / 填表格）"
));
children.push(h2("4.2 什么是「数据接口」？为什么重要？"));
children.push(p("项目的「数据库」就是 data.js 里的一个大 JSON 对象 window.LINGYUN_DATA。网页一打开就把它读进内存，所有图表都从这里取数。但页面代码不直接读它，而是统一通过 core/data.js 提供的 window.LY.data.xxx() 来取数——这就是「数据接口」。"));
children.push(p("为什么这样设计？因为哪天数据源从 Excel 换成别的（比如数据库、别的表格），只要改 core/data.js 一处，所有页面都不用动。这是项目的核心约定，新人务必遵守：页面里永远用 window.LY.data 取数，不要直接读 window.LINGYUN_DATA。"));
children.push(h2("4.3 数据都分哪几块（数据域）？"));
children.push(table(
  ["数据域（键名）", "是什么", "体量/说明"],
  [
    ["meta", "元信息（数据来源、月份、省份列表）", "小"],
    ["overview", "数据总览页用", "对象"],
    ["overviewByProvince", "各省份逐月关键指标", "33 个单位"],
    ["agentMonthly", "智能体按月×省明细（重点）", "约 3 万行"],
    ["agentCaseCatalog", "推广/优秀/双周优秀案例清单", "约 170 条"],
    ["apps* 系列", "按应用聚合的调用/Token/费用/人年", "新增聚合键"],
    ["tracking", "平台埋点分析", "约 140 条"],
    ["provinces", "省份分析", "33 条"],
    ["capability / centerYearRank / alerts", "质效、能力、告警等", "对象/数组"]
  ],
  [2600, 4226, 2200]
));

// 第5章 Excel vs 离线 Excel（2026-09-18 复核更正版）
children.push(h1("五、重点：数据到底来自哪几份 Excel（2026-09-18 复核）"));
children.push(p("你问的这个问题非常关键，而且我们中途有过误判，这里用最新核实结果说清楚。结论先说：看板不是只用「一份」Excel，而是「多份本地 Excel 离线拼出来」的；2026-09-18 起已彻底脱钩离线 Excel——原先残留「离线 Excel在线」来源标签的 2 个数据块（platformMonthly、meta）也已改为离线固化。下面逐项讲明白。"));
children.push(h2("5.1 现在到底有几份 Excel（已统一收口到 build/sources/）"));
children.push(p("团队维护的数据源目前有 4 份真实业务 Excel，已全部复制到项目的 build/sources/ 目录（不再依赖个人电脑的 Downloads 或微信缓存），由赵莹统一用脚本重新生成数据。另有 3 份「模拟/分类」源 Excel 也放在 build/sources/ 并已提交 git："));
children.push(table(
  ["#", "Excel 文件", "由哪个脚本读取", "喂给看板的哪些内容"],
  [
    ["1", "《【合】灵运BI重要数据（终版）.xlsx》", "build_from_xlsx.py", "总览、各省总览、应用聚合（主数据）"],
    ["2", "《【合】灵运BI重要数据（终版） (1).xlsx》（终版副本）", "extract_province_list.py + merge_province_list.js", "给智能体明细并入“节约金额/是否正向价值”等字段"],
    ["3", "《质效分析.xlsx》", "build_extra.py", "质效月度汇总、31 分中心等效人年排名"],
    ["4", "《用户行为记录.xlsx》", "build_extra.py", "页面×省份×月 点击/访客/曝光埋点（周+月）"]
  ],
  [600, 4626, 3200, 3200]
));
children.push(p("智能体卡片列表（113 条）、生命周期、分类字段，来自 build/sources/ 里的 3 份「模拟/分类」源 Excel（【智能体】模拟-v2、数据总览模拟_v2、智能体分类_20260902），这些已经随 git 提交，团队 pull 即可用。"));
children.push(h2("5.2 数据是怎么拼出来的（全离线，顺序固定）"));
children.push(...nums([
  "python build/build_from_xlsx.py —— 用《终版》生成 data.js 主数据（总览/省份/智能体明细/案例/应用）。",
  "python build/extract_province_list.py —— 从《终版(1)》抽取“正向价值/节约金额”字段表。",
  "node build/merge_province_list.js —— 把上面的字段并回 data.js 的智能体明细（约 3 万行全命中）。",
  "python build/build_extra.py —— 用《质效分析》+《用户行为记录》覆盖质效/埋点块。",
  "node build/encrypt_data.js（密码 12345678）—— 加密成 data.js.enc。",
  "node build/bundle.js —— 打包到 dist/，部署。"
]));
children.push(p("注意：data.js 是「终版 Excel 覆盖 + 旧基底保留」合并出来的；但埋点（tracking/platformTracking）和质效（qeMonthlySummary/centerYearRank）这两类，现在已经明确改由《用户行为记录》《质效分析》两份 Excel 提供，旧的“离线 Excel在线”残留已被消除。"));
children.push(h2("5.3 变化对比表（离线 Excel vs Excel）"));
children.push(table(
  ["对比项", "以前（离线 Excel在线）", "现在（多份本地 Excel）"],
  [
    ["数据在哪", "在线云表格（WPS）", "本地多份 Excel（build/sources/）"],
    ["是否需要联网", "需要", "不需要（离线）"],
    ["取数工具", "连接器 + build_from_xlsx.py", "build_from_xlsx / build_extra 等"],
    ["页面配置", "各 pages/*.data-source.json", "已作废，不用填"],
    ["确定性", "受在线状态/权限影响", "跑一次定一次，稳定"],
    ["团队协同", "每人维护在线一份", "赵莹统一跑脚本，源文件随 git 提交"]
  ],
  [2200, 3413, 3413]
));
children.push(h2("5.4 Excel 注意事项"));
children.push(...bullets([
  "脚本按「工作表名 + 列标题（表头名）」匹配，所以 Excel 的工作表名称和列标题不能随便改，否则该列变空。",
  "4 份真实业务 Excel 已加入 .gitignore（明文敏感，不进库）。团队 pull 代码后本地没有这几份 Excel，需要赵莹同步或单独分发。",
  "3 份模拟/分类源 Excel 已随 git 提交，pull 后即有。",
  "换数据时由赵莹统一跑「5.2 的 6 步」，不要个人手动改 data.js。"
]));
children.push(h2("5.5 数据来源审计（2026-09-18 实测，每个数据块的真实来源）"));
children.push(p("我们直接读了线上 data.js 里每个数据块的 source 标签，结论是：全部数据块均已来自离线 Excel，不再有任何离线 Excel依赖："));
children.push(table(
  ["数据块（看板里的图表）", "真实来源", "状态"],
  [
    ["overview / overviewByProvince / 应用聚合 / 智能体明细 / 案例", "《终版》Excel（离线）", "🟢 已用 Excel"],
    ["agentMonthly 的“正向价值/节约金额”字段", "《终版(1)》Excel（离线）", "🟢 已用 Excel"],
    ["qeMonthlySummary / centerYearRank（质效）", "《质效分析》Excel（离线）", "🟢 已用 Excel"],
    ["tracking / platformTracking（埋点·周）", "《用户行为记录》Excel（离线）", "🟢 已用 Excel"],
    ["platformMonthly（平台分析·月维度）", "《用户行为记录》Excel 派生·已离线固化（2026-05~08 四个月用户级埋点）", "🟢 已离线固化"],
    ["meta（元信息/数据可用性校验）", "构建脚本按 Excel 计算生成（省份列表/月份/可用性）", "🟢 已离线固化"]
  ],
  [3800, 4200, 1600]
));
children.push(...bullets([
  "platformMonthly：2026-05~08 共 4 个月用户级真实数据（MAU 704/810/746、转化率 28.4/32.44/34.26% 等）。数据本来就完整，只是旧版把来源标签写成「离线 Excel在线」。现已由 build/strip_kdocs.py 改为「离线 Excel 固化」标签，链接已清空。",
  "meta：数据校验/元信息（省份列表、月份、数据可用性标记），内容由构建脚本按 Excel 计算生成，来源标签改为「离线 Excel 固化」，无在线链接。",
  "构建链路最后一步 build/strip_kdocs.py 会做兜底清理：任何残留的 Excel 链接置空、「离线 Excel」字眼改写成离线 Excel，可重复运行。"
]));
children.push(h2("5.6 旧文件/代码清理情况（2026-09-18）"));
children.push(...bullets([
  "已删除：build/build_from_xlsx.py、(已删除)、(已删除)、kdocs_range_to_csv.py、parse_kdocs_month.py、离线 Excel接入方案.md —— 离线 Excel在线取数链路整体移除。",
  "各 pages/<id>.data-source.json —— 不再填离线 Excel ID，改为标注对应的离线 Excel 文件名（build/sources/）。",
  "build/mock/*.json —— 离线开发用的“模拟占位”文件，不参与线上数据。",
  "前端运行时（static/）已无任何拉离线 Excel的代码；线上看板打开后不再联网取数，数据源只有打包时固化的 Excel 结果。"
]));
children.push(p("一句话总结：现在完全“离线从多份本地 Excel 读”——所有图表的数据都固化在 data.js 里，项目里不再保留任何离线 Excel入口。"));

// 第6章 分工
children.push(h1("六、团队分工：每个人改什么文件"));
children.push(p("项目是按「文件物理隔离」设计的：每个人只改自己名下的 pages/<id>.js，共享文件只有赵莹动，所以互相几乎不冲突。下面是目前建议的分工（可按实际调整）："));
children.push(table(
  ["角色", "负责文件", "页面内容"],
  [
    ["吴超", "pages/overview.js、pages/province.js、pages/report.js", "数据总览 / 省份分析 / 报告生成"],
    ["羽琪", "pages/agents.js、pages/alarms.js", "智能体 / 告警中心"],
    ["赵莹（基座守护者）", "core/*、index.html、style.v6.css、data.js、build/*、encrypt、部署", "内核 / 配色 / 导航 / 数据管线 / 打包发布"]
  ],
  [2200, 4626, 2200]
));
children.push(h2("6.1 原则（务必遵守）"));
children.push(...bullets([
  "只改自己名下的 pages/<id>.js；共享文件（core、index.html、style.v6.css、data.js）只有赵莹改。",
  "页面代码永远通过 window.LY.data 取数，不要直接读 window.LINGYUN_DATA，也不要在页面里自己连数据源。",
  "数据更新由赵莹统一跑脚本生成，不要自己手改 data.js。"
]));

// 第7章 拉取后改什么
children.push(h1("七、从 git 拉取代码后，要改什么、改哪些文件？"));
children.push(p("团队用 Git 把代码汇总到一处（推荐用工蜂/Gitee 私有仓，或 GitHub）。拉取（clone/pull）之后，日常只会有两类改动："));
children.push(h2("7.1 情况 A：数据更新了（数字变了、月份新增）"));
children.push(...nums([
  "在 Excel《【合】灵运BI重要数据（终版）.xlsx》里更新数据（保持工作表名和列标题不变）。",
  "赵莹本地运行：python build/build_from_xlsx.py  → 重新生成 static/data.js。",
  "再运行：DASH_PWD=12345678 node build/encrypt_data.js  → 重新加密成 data.js.enc。",
  "再运行：node build/bundle.js  → 重新打包 dist/。",
  "部署（推 gh-pages 或重新上传 CloudStudio）。页面代码一行都不用动。"
]));
children.push(p("如果某人只是想在本地换数据预览：改 Excel 后跑第 2、3 步，再用本地服务器打开即可（详见第八章学习路线）。"));
children.push(h2("7.2 情况 B：改页面外观 / 图表 / 计算逻辑"));
children.push(p("改样式（颜色、卡片、表格长相）：改 static/style.v6.css；某个页面内部的小卡片/表格，改对应 pages/<id>.js 里写的 HTML 字符串。"));
children.push(p("改图表类型、配色、KPI 计算：都在对应 pages/<id>.js 里（图表用的是 ECharts 的 option 配置对象）。"));
children.push(p("改完之后，赵莹（或本人）必须重跑 node build/bundle.js 再部署，否则线上看不到改动。"));
children.push(h2("7.3 标准协作流程（推荐）"));
children.push(...nums([
  "三人都 clone 同一仓库；每人切到自己的分支（如 dev-wuchao、dev-yuqi）。",
  "在自己负责的 pages/<id>.js 上改，本地用 index.html 预览。",
  "提交时只勾选自己改的文件（绝不包含 core/、index.html、data.js、style.v6.css）。",
  "push 到自己的分支，在网页上提 Merge Request 给赵莹。",
  "赵莹审查合并到 main → 跑 build/bundle.js → 部署。",
  "数据刷新：赵莹跑 Excel 取数脚本重写 data.js/enc 后重新部署；data.js 不进普通人的分支，避免被覆盖。"
]));
children.push(h2("7.4 ⚠️ 最关键的铁律"));
children.push(...bullets([
  "改了 static/ 但没重跑 bundle.js → 线上永远看不到你的改动（新人最高频踩坑）。",
  "手改 data.js → 它是自动生成的，下次一跑脚本就被覆盖；改数据走 Excel 脚本。",
  "data.js / data.js.enc 已被刻意排除在 git 之外（安全考虑，避免明文数据进仓库）；拉取代码后本地没有数据文件，想本地看真实数据需赵莹单独给，或自己接 Excel 重跑生成。"
]));

// 第8章 学习路线
children.push(h1("八、小白学习路线（循序渐进，照着做）"));
children.push(...nums([
  "先看效果：双击 static/index.html 打开，建立“页面长什么样”的印象。",
  "读骨架：读 static/index.html（看导航和容器），再读 core/core.js（看导航怎么切换、页面怎么被调用）。",
  "读数据接口：读 core/data.js（几十行，看懂“页面只通过 LY.data 取数”这条约定）。",
  "读一个页面：挑你关心的（如 agents.js），看它怎么 registerPage + render + 用 LY.data 取数 + 画 ECharts。",
  "动手闭环：改一行 style.v6.css → 跑 node build/bundle.js → 看 dist/index.html 变化。建立“改 → 打包 → 看”的肌肉记忆。",
  "再看数据脚本：读 build/build_from_xlsx.py，理解 data.js 是怎么从 Excel 变出来的。"
]));

// 第9章 Vue 升级
children.push(h1("九、如果改成 Vue 前端架构，怎么实现？（升级路线）"));
children.push(h2("9.1 现在为什么不用 Vue？"));
children.push(p("因为原生 JS 对小白更友好，打开即看、无需构建复杂环境，目前功能也够用。但原生 JS 的缺点是：页面多了以后，代码组织会散、复用难、多人协作容易乱。"));
children.push(h2("9.2 为什么要换 Vue？"));
children.push(...bullets([
  "组件化：每个页面变成一个 .vue 组件，结构清晰、可复用。",
  "数据响应式：数据一变，页面自动更新，不用手写大量赋值代码。",
  "生态成熟：Vue3 + Vite + ECharts 有现成封装（vue-echarts），团队协作和招人更方便。"
]));
children.push(h2("9.3 怎么落地（分步，不必推倒重来）"));
children.push(...nums([
  "保留数据管线不动：Python → data.js → encrypt_data.js → data.js.enc 这套照旧，数据来源还是那个 Excel。",
  "引入 Vite + Vue3：新建前端工程，把 ECharts 改用 vue-echarts 组件。",
  "把每个 pages/<id>.js 改写成一个 .vue 组件（如 Overview.vue、Agents.vue），把原来的 render() 逻辑搬进组件的 template + script。",
  "把内核 window.LY 改造成一个统一的 composable / store（如 useLingyunData），页面通过它取数，保持“统一接口”的好处。",
  "构建仍产出纯静态 dist/（Vite build 输出），部署方式不变（GitHub Pages / CloudStudio 同样适用）。",
  "先小范围试点：建议先把一个页面（如总览）用 Vue 重写验证，跑通后再逐步迁移其它页面，不要一次性全改。"
]));
children.push(h2("9.4 升级后的目录会变成什么样（示意）"));
children.push(code(
  "lingyun_dashboard/\n" +
  "├─ static/ 或 web/       前端工程（Vue3 + Vite）\n" +
  "│  ├─ src/\n" +
  "│  │  ├─ App.vue          整体布局 + 导航\n" +
  "│  │  ├─ composables/useLingyunData.js   统一数据接口（替代 core/data.js）\n" +
  "│  │  ├─ pages/Overview.vue  Agents.vue  Province.vue ...  各页面组件\n" +
  "│  │  └─ main.js          入口\n" +
  "│  └─ vite.config.js\n" +
  "├─ build/build_from_xlsx.py   数据入口（不变）\n" +
  "├─ build/encrypt_data.js      加密（不变）\n" +
  "└─ dist/                     构建产物（Vite build 输出，部署用这个）"
));
children.push(p("风险与建议：Vue 化是一项中等规模改造，建议安排专人（或外包）先做技术验证，确认 vue-echarts、密码解密、静态部署都跑通后再全面铺开。核心原则不变——保留统一数据接口层和 Excel 取数管线，能大幅降低改造风险。"));

// 第10章 术语表 + 速查
children.push(h1("十、给小白的术语表 & 关键文件速查"));
children.push(h2("10.1 术语对照（看不懂的词来这查）"));
children.push(table(
  ["术语", "大白话解释"],
  [
    ["前端", "你在浏览器里看到、点到的那部分（网页）。"],
    ["后端", "藏在服务器上、你看不到的程序（本项目没有）。"],
    ["数据库", "存数据的地方（本项目没有，数据放在 data.js 里）。"],
    ["框架", "别人写好的现成“轮子”，省得从零写（如 Vue/React；本项目没用）。"],
    ["构建/打包", "把一堆源码合并、压缩成一个发布版的过程（bundle.js）。"],
    ["部署", "把做好的网页放到服务器/平台上，别人才能打开看。"],
    ["数据接口", "页面和数据之间约定好的“取数规矩”（window.LY.data）。"],
    ["JSON", "一种通用的数据格式，本项目的数据就是一大段 JSON。"],
    ["仓库/分支", "Git 里存代码的地方 / 平行的工作线（main 是主线）。"],
    ["加密(enc)", "把数据打乱成密文，只有密码能解开（data.js.enc）。"]
  ],
  [2000, 7026]
));
children.push(h2("10.2 想做某件事，去改/看哪里"));
children.push(table(
  ["我想做的事", "去改 / 看"],
  [
    ["改网站长相（颜色、卡片）", "static/style.v6.css"],
    ["改导航栏 / 页面骨架", "static/index.html"],
    ["改某个页面的图表/表格/计算", "static/pages/<id>.js"],
    ["看数据怎么取、怎么过滤", "static/core/core.js、static/core/data.js"],
    ["刷新/更换底层数据", "改 Excel → build/build_from_xlsx.py → encrypt_data.js"],
    ["打包发布", "node build/bundle.js → 产物在 dist/"],
    ["看分析结论（正向价值等）", "docs/灵运BI_正向价值智能体分析结论.md"]
  ],
  [3413, 5613]
));
children.push(h2("10.3 当前可用链接"));
children.push(...bullets([
  "公网链接（人人可开，输密码 12345678）：https://flamemaster688.github.io/lingyun-dashboard/",
  "CloudStudio 沙箱链接（同款修复）：https://bd1f9779c21c4185b00f645b1f88035f.app.workbuddy.host"
]));
children.push(p("（提示：公网链接的密码和数据都经加密保护，链接可放心外发；但项目里曾用到的 GitHub PAT 建议尽快吊销更换，避免凭据泄露。）", { color: "C00000" }));

// ---------- 文档组装 ----------
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Microsoft YaHei", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Microsoft YaHei", color: "1F3864" },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 27, bold: true, font: "Microsoft YaHei", color: "2E75B6" },
        paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Microsoft YaHei", color: "404040" },
        paragraph: { spacing: { before: 140, after: 100 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  sections: [{
    properties: {
      page: { size: { width: A4W, height: A4H }, margin: { top: M, right: M, bottom: M, left: M } }
    },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "灵运 BI 看板 · 项目完全手册（小白版）", size: 16, color: "A6A6A6" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "第 ", size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: " 页", size: 16 })] })] }) },
    children: children
  }]
});

Packer.toBuffer(doc).then(function (buf) {
  fs.writeFileSync(OUT, buf);
  console.log("OK 已生成:", OUT, "大小:", (buf.length / 1024).toFixed(1), "KB");
}).catch(function (e) {
  console.error("生成失败:", e);
  process.exit(1);
});
