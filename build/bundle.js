// -*- coding: utf-8 -*-
// 合并/打包命令：node build/bundle.js
// 把 core/core.js + core/data.js + 各 pages/*.js 合并为单文件 dist/lingyun.bundle.js，
// 并生成 dist/index.html（引用 bundle + vendor/data/style），作为「共享链接」部署产物。
// 这样三人各自改完 pages/*.js 后，赵莹一键合并即可发布，无需手工拼文件。
// 顺序必须与 static/index.html 的脚本块一致：core/core → core/data（统一数据接口）→ 各页面。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, "static");
const DIST = path.join(ROOT, "dist");

const ORDER = [
  "core/core.js",
  "core/data.js",       // 统一数据接口（window.LY.data 适配层，页面只读这里）；缺失会导致 pickDomain 取不到任何域 → 各页空白
  "pages/overview.js",  // 吴超
  "pages/agents.js",    // 羽琪
  "pages/tracking.js",  // 赵莹
  "pages/tracking-monthly.js", // 赵莹：定义 window.PFM，平台分析月度页 8 卡依赖
  "pages/province.js",  // 吴超
  "pages/quality.js",   // 赵莹
  "pages/alarms.js",    // 羽琪
  "pages/report.js"     // 吴超
];

// 1) 合并 JS
const parts = ORDER.map((rel) => {
  const p = path.join(STATIC, rel);
  if (!fs.existsSync(p)) throw new Error("缺少文件：" + rel);
  return "/* ===== " + rel + " ===== */\n" + fs.readFileSync(p, "utf-8");
});
const bundle = parts.join("\n;\n");

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, "lingyun.bundle.js"), bundle, "utf-8");
console.log("✓ 生成 dist/lingyun.bundle.js（" + ORDER.length + " 个模块合并）");

// 1.5) 加密模式下清理可能残留的明文数据，避免仍随站点泄露
const LEGACY_DATA = path.join(DIST, "data.js");
if (fs.existsSync(LEGACY_DATA)) { fs.unlinkSync(LEGACY_DATA); console.log("✓ 清理残留明文 dist/data.js"); }

// 2) 复制静态资源（vendor / data / style / catalog）
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const COPY = [
  ["vendor", "vendor", true],
  ["data.js.enc", "data.js.enc", false],   // 加密数据（替代明文 data.js）
  ["decrypt.js", "decrypt.js", false],     // 密码引导（方案 B）
  ["style.v6.css", "style.v6.css", false],
  ["metrics_catalog.json", "metrics_catalog.json", false],
  ["metrics_catalog.js", "metrics_catalog.js", false]
];
for (const [src, dst, isDir] of COPY) {
  const s = path.join(STATIC, src);
  if (fs.existsSync(s)) {
    const dp = path.join(DIST, dst);
    if (isDir) copyDir(s, dp);
    else fs.copyFileSync(s, dp);
    console.log("✓ 复制 " + src);
  }
}

// 3) 生成 dist/index.html：把 dev 的模块脚本块替换为「密码引导 + 单个 bundle」
let html = fs.readFileSync(path.join(STATIC, "index.html"), "utf-8");
const start = html.indexOf("<!-- 共享内核");
const endMarker = '<script src="decrypt.js"></script>';
const end = html.indexOf(endMarker);
if (start < 0 || end < 0) throw new Error("未在 index.html 找到模块脚本块/decrypt.js");
const replaceTo =
  '  <!-- 共享内核（已加密保护，由 decrypt.js 解密后动态加载） -->\n' +
  '  <script>\n    window.__DASH_SCRIPTS__ = ["lingyun.bundle.js"];\n  </script>\n' +
  '  <script src="decrypt.js"></script>';
html = html.slice(0, start) + replaceTo + html.slice(end + endMarker.length);
fs.writeFileSync(path.join(DIST, "index.html"), html, "utf-8");
console.log("✓ 生成 dist/index.html（密码引导 + lingyun.bundle.js）");

// 4) 校验产物语法
const { execFileSync } = require("child_process");
try {
  execFileSync(process.execPath, ["--check", path.join(DIST, "lingyun.bundle.js")], { stdio: "pipe" });
  console.log("\n✅ 打包完成，dist/ 可直接部署（双击 dist/index.html 或部署到 CloudStudio/Vercel）。");
} catch (e) {
  console.error("\n❌ 合并后语法校验失败：" + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}
