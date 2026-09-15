// -*- coding: utf-8 -*-
// 轻量冒烟测试：用最小 DOM 桩在 Node 里真实加载 core + 7 个 page，逐一渲染，捕捉运行期异常。
// 目的不是验证视觉效果，而是确认「拆分后全局共享/注册表分发」不抛 ReferenceError/TypeError。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BASE = process.argv[2] || "static";
const STATIC = path.join(__dirname, "..", BASE);

function makeStub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "toString") return () => "";
      if (prop === "length") return 0;
      if (prop === "nodeType") return 1;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; }
  });
  return proxy;
}

const document = {
  readyState: "loading",
  getElementById: () => makeStub(),
  querySelector: () => makeStub(),
  querySelectorAll: () => [],
  createElement: () => makeStub(),
  addEventListener: () => {},
  removeEventListener: () => {},
  body: makeStub(),
  documentElement: makeStub(),
  insertAdjacentHTML: () => {}
};

const echarts = {
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
  registerMap() {},
  getMap: () => null,
  version: "5.5.1"
};
const XLSX = {
  read: () => ({ SheetNames: [], Sheets: {} }),
  utils: {
    sheet_to_json: () => [],
    aoa_to_sheet: () => ({}),
    book_new: () => ({}),
    book_append_sheet: () => {}
  },
  write: () => new Uint8Array(8)
};
class Blob { constructor() {} }
const URL = { createObjectURL: () => "blob:x", revokeObjectURL: () => {} };

const sandbox = {
  window: null, document, echarts, XLSX, Blob, URL,
  console, setTimeout: () => 0, clearTimeout: () => {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp,
  parseInt, parseFloat, isNaN, isFinite
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function run(file) {
  const code = fs.readFileSync(path.join(STATIC, file), "utf-8");
  vm.runInContext(code, sandbox, { filename: file });
}

const useBundle = fs.existsSync(path.join(STATIC, "lingyun.bundle.js"));

let failed = false;
try {
  run("data.js");                                   // 注入真实数据
  console.log("[1] data.js 加载，agents/省份/埋点等数据就位");
  if (useBundle) {
    run("lingyun.bundle.js");                       // 合并单文件（部署产物）
    console.log("[2] lingyun.bundle.js 加载，window.registerPage 已就绪");
  } else {
    run("core/core.js");                            // 全局内核 + 注册表基础设施
    console.log("[2] core/core.js 加载，window.registerPage 已就绪");
    ["pages/overview.js", "pages/agents.js", "pages/tracking.js", "pages/province.js",
     "pages/quality.js", "pages/alarms.js", "pages/report.js"].forEach(run);
  }
  console.log("[3] 页面模块加载并注册完成");

  const pages = sandbox.window.LY.pages;
  const ids = Object.keys(pages);
  console.log("    已注册页面：" + ids.join(", "));
  if (ids.length !== 7) throw new Error("页面数量应为 7，实际 " + ids.length);

  // 手动触发 init（模拟 DOMContentLoaded）
  sandbox.init();
  console.log("[4] init() 执行通过（computeView/renderBadges/buildProvinceUI 等无异常）");

  // 逐一渲染 7 个页面
  ids.forEach((id) => {
    sandbox.renderCurrent(id);
    console.log("    ✓ 渲染 " + id + "（" + (pages[id].title || "") + "）通过");
  });

  // 单独调用优化入口
  sandbox.optimizePage("quality");
  console.log("[5] optimizePage('quality') 调用通过");

  console.log("\n✅ 冒烟测试全部通过：拆分后 7 个页面均可独立渲染，未出现全局缺失/作用域错误。");
} catch (e) {
  failed = true;
  console.error("\n❌ 冒烟测试失败：");
  console.error(e && e.stack ? e.stack : e);
}
process.exit(failed ? 1 : 0);
