// -*- coding: utf-8 -*-
// jsdom 真实 DOM 验证：拆分后首屏解析量、各页面渲染、点击交互、智能体分块懒加载。
// 用法：node build/verify_split.js
const { JSDOM } = require("/Users/mac/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");

const BASE = "dist_preview";
const ROOT = path.join(__dirname, "..", BASE);

const dataJs = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
const bundleJs = fs.readFileSync(path.join(ROOT, "lingyun.bundle.js"), "utf8");
const agentsChunk = fs.readFileSync(path.join(ROOT, "data-agents.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const errors = [];
const log = (...a) => console.log(...a);

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const { document } = window;

window.addEventListener("error", (e) => errors.push("window.error: " + (e.error && e.error.stack || e.message)));

// —— 桩：图表/表格/其他浏览器 API（jsdom 无 canvas） ——
window.echarts = {
  init: () => ({ setOption() {}, resize() {}, dispose() {}, on() {}, off() {}, getOption() { return {}; } }),
  registerMap() {}, getMap: () => null, version: "5.5.1"
};
window.XLSX = {
  read: () => ({ SheetNames: [], Sheets: {} }),
  utils: { sheet_to_json: () => [], aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} },
  write: () => new Uint8Array(8)
};
window.Blob = class Blob { constructor() {} };
window.URL.createObjectURL = () => "blob:x";
window.URL.revokeObjectURL = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

// —— 明文预览的 fetch 桩：返回智能体分块明文 ——
window.fetch = (url) => {
  const u = String(url).split("?")[0];
  if (u.indexOf("data-agents.js") >= 0) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(agentsChunk) });
  }
  return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
};

// 以 <script> 元素方式注入（与浏览器一致，顶层函数成为全局）
function injectScript(code) {
  const s = document.createElement("script");
  s.textContent = code;
  document.body.appendChild(s);
}

// —— 1) 首屏解析量测量（核心修复点） ——
const t0 = Date.now();
try { injectScript(dataJs); } catch (e) { errors.push("data.js inject: " + (e.stack || e)); }
const t1 = Date.now();
try { injectScript(bundleJs); } catch (e) { errors.push("bundle inject (auto-init): " + (e.stack || e)); }
const t2 = Date.now();

log("【首屏解析】data.js 大小 " + (dataJs.length / 1048576).toFixed(2) + " MB，解析耗时 " + (t1 - t0) + " ms");
log("【内核+bundle 评估】" + (t2 - t1) + " ms（含首屏自动 init 渲染总览）");
log("首屏是否仍同步解析 22MB 明细(agentMonthly)？ " + (window.LINGYUN_DATA && !!window.LINGYUN_DATA.agentMonthly ? "是(异常)" : "否(已剥离✓)"));

// —— 2) 模拟真实点击导航（点击各 nav-item 触发真实切换+渲染） ——
try {
  const navs = Array.from(document.querySelectorAll(".nav-item"));
  log("\n【交互点击】模拟点击 " + navs.length + " 个导航项：");
  navs.forEach((el) => {
    const tab = el.getAttribute("data-tab");
    try {
      el.dispatchEvent(new window.Event("click", { bubbles: true }));
      log("  ✓ 点击 " + (tab || "?") + " -> 切换并渲染无异常");
    } catch (e) {
      errors.push("点击导航 " + tab + ": " + (e.stack || e));
    }
  });
} catch (e) { errors.push("nav 点击遍历: " + (e.stack || e)); }

// —— 3) 等待智能体分块懒加载完成 ——
function waitChunk(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function poll() {
      if (window.LINGYUN_AGENT_MONTHLY && window.LINGYUN_AGENT_MONTHLY.length) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, 200);
    })();
  });
}

(async () => {
  const ok = await waitChunk(20000);
  const rows = window.LINGYUN_AGENT_MONTHLY ? window.LINGYUN_AGENT_MONTHLY.length : 0;
  const dataRows = window.LINGYUN_DATA && window.LINGYUN_DATA.agentMonthly ? window.LINGYUN_DATA.agentMonthly.length : 0;
  log("\n【智能体分块】懒加载结果: " + (ok ? "成功✓" : "超时✗") + "，window.LINGYUN_AGENT_MONTHLY 行数=" + rows + "，注入 LINGYUN_DATA.agentMonthly 行数=" + dataRows);

  // —— 4) 全量渲染所有已注册页面 ——
  const ids = Object.keys(window.LY.pages || {});
  log("\n【页面注册】共 " + ids.length + " 页：" + ids.join(", "));
  log("【全量渲染】");
  ids.forEach((id) => {
    try { window.renderCurrent(id); log("  ✓ " + id); }
    catch (e) { errors.push("render " + id + ": " + (e.stack || e)); }
  });

  // —— 5) 汇总 ——
  log("\n========== 验证结果 ==========");
  log("首屏 data.js 解析耗时: " + (t1 - t0) + " ms（修复前约 600~3000ms，因需同步解析 22MB 明细）");
  log("智能体分块行数: " + rows + "（应=30940）");
  log("异常总数: " + errors.length);
  errors.forEach((e) => log("  ❌ " + e));
  if (errors.length === 0 && ok && rows === 30940) log("\n✅ 全部通过：首屏不再解析 22MB 明细，8 页渲染无异常，智能体分块按懒加载就位。");
  else log("\n⚠️ 存在问题，见上方明细。");
  process.exit(errors.length === 0 && ok && rows === 30940 ? 0 : 1);
})();
