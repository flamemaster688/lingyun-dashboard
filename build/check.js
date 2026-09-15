// -*- coding: utf-8 -*-
// 校验命令：node build/check.js [文件...]
//   不传参：语法校验 core/core.js + 全部 pages/*.js
//   传参  ：只校验指定的文件（如 node build/check.js pages/quality.js）
// 用于「单独文件单独优化」或「七个页面同时优化」后的快速自检。
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NODE = process.execPath;
const STATIC = path.join(__dirname, "..", "static");

function listPages() {
  return fs.readdirSync(path.join(STATIC, "pages"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join("pages", f));
}

let targets;
if (process.argv.length > 2) {
  targets = process.argv.slice(2).map((p) =>
    path.isAbsolute(p) ? p : path.join(STATIC, p)
  );
} else {
  targets = [path.join("core", "core.js")].concat(listPages()).map((p) =>
    path.join(STATIC, p)
  );
}

let failed = 0;
for (const t of targets) {
  try {
    execFileSync(NODE, ["--check", t], { stdio: "pipe" });
    console.log("  ✓ " + path.relative(STATIC, t));
  } catch (e) {
    failed++;
    console.error("  ✗ " + path.relative(STATIC, t));
    console.error("    " + (e.stderr ? e.stderr.toString().trim() : e.message));
  }
}
if (failed) {
  console.error("\n校验未通过：" + failed + " 个文件有语法错误。");
  process.exit(1);
}
console.log("\n✅ 全部 " + targets.length + " 个文件语法校验通过。");
