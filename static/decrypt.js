/*
 * static/decrypt.js —— 看板密码保护引导（方案 B：前端密码解密）
 * ------------------------------------------------------------------
 * 流程：全屏密码遮罩 → 用户输入密码 → fetch data.js.enc →
 *       PBKDF2 派生密钥 → AES-GCM 解密 → 写入 window.LINGYUN_DATA →
 *       动态顺序加载内核与页面 → 显式调用 window.LY.init()。
 *
 * 配合：
 *   - index.html 内设置 window.__DASH_SCRIPTS__（要动态加载的脚本列表）
 *   - core/core.js 暴露 window.LY.init，并在 __LY_DEFER_INIT__ 为真时
 *     不自动初始化，改由本脚本在全部脚本就绪后调用。
 *
 * 该脚本必须放在 </body> 前（body 已存在），否则无法注入遮罩。
 */
(function () {
  "use strict";

  var ENC_URL = "data.js.enc";
  var SCRIPTS = (window.__DASH_SCRIPTS__ || []).slice();
  var MAX_FAIL = 5;
  var LOCK_MS = 60000;

  // ---------- 注入样式 ----------
  var style = document.createElement("style");
  style.id = "dash-lock-style";
  style.textContent = [
    "#dash-lock{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;",
    "background:rgba(15,23,42,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);",
    "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;}",
    ".dash-lock-card{background:#fff;border-radius:16px;padding:32px 36px;width:340px;max-width:88vw;",
    "box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center;}",
    ".dash-lock-title{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:6px;}",
    ".dash-lock-sub{font-size:13px;color:#64748b;margin-bottom:20px;}",
    ".dash-lock-input{width:100%;box-sizing:border-box;padding:11px 14px;font-size:15px;",
    "border:1px solid #cbd5e1;border-radius:10px;outline:none;margin-bottom:12px;}",
    ".dash-lock-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15);}",
    ".dash-lock-btn{width:100%;padding:11px;font-size:15px;font-weight:600;color:#fff;",
    "background:#2563eb;border:none;border-radius:10px;cursor:pointer;}",
    ".dash-lock-btn:hover{background:#1d4ed8;}",
    ".dash-lock-btn:disabled{background:#94a3b8;cursor:not-allowed;}",
    ".dash-lock-msg{font-size:13px;min-height:18px;margin-top:12px;}",
    ".dash-lock-hint{font-size:11px;color:#94a3b8;margin-top:14px;}"
  ].join("");
  document.head.appendChild(style);

  // ---------- 注入遮罩 ----------
  var overlay = document.createElement("div");
  overlay.id = "dash-lock";
  overlay.innerHTML =
    '<div class="dash-lock-card">' +
      '<div class="dash-lock-title">灵运 BI 看板</div>' +
      '<div class="dash-lock-sub">该看板受密码保护，请输入访问密码</div>' +
      '<input id="dash-pwd" class="dash-lock-input" type="password" placeholder="访问密码" autocomplete="off" />' +
      '<button id="dash-go" class="dash-lock-btn">进入看板</button>' +
      '<div id="dash-msg" class="dash-lock-msg"></div>' +
      '<div class="dash-lock-hint">连续错误 5 次将锁定 60 秒</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var input = overlay.querySelector("#dash-pwd");
  var btn = overlay.querySelector("#dash-go");
  var msg = overlay.querySelector("#dash-msg");
  var fails = 0;
  var locked = false;

  function setMsg(text, isErr) {
    msg.textContent = text || "";
    msg.style.color = isErr ? "#dc2626" : "#2563eb";
  }
  input.focus();

  function attempt() {
    if (locked) return;
    var pwd = input.value;
    if (!pwd) { setMsg("请输入密码", true); return; }
    setMsg("解密中…", false);
    btn.disabled = true;
    input.disabled = true;
    decryptAndBoot(pwd)
      .then(function () {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (style && style.parentNode) style.parentNode.removeChild(style);
      })
      .catch(function (err) {
        console.warn("[decrypt] 解密失败:", err && err.message);
        fails++;
        btn.disabled = false;
        input.disabled = false;
        input.value = "";
        input.focus();
        if (fails >= MAX_FAIL) {
          locked = true;
          setMsg("尝试次数过多，已锁定 60 秒", true);
          btn.disabled = true;
          input.disabled = true;
          setTimeout(function () {
            locked = false;
            fails = 0;
            btn.disabled = false;
            input.disabled = false;
            setMsg("", false);
            input.focus();
          }, LOCK_MS);
        } else {
          setMsg("密码错误，请重试（剩 " + (MAX_FAIL - fails) + " 次）", true);
        }
      });
  }
  btn.addEventListener("click", attempt);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") attempt(); });

  // ---------- 工具 ----------
  function b64ToBytes(b) {
    var bin = atob(b);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("脚本加载失败: " + src)); };
      document.head.appendChild(s);
    });
  }

  // ---------- 核心：解密 + 启动 ----------
  function decryptAndBoot(pwd) {
    return fetch(ENC_URL)
      .then(function (resp) {
        if (!resp.ok) throw new Error("无法获取加密数据 (HTTP " + resp.status + ")");
        return resp.json();
      })
      .then(function (p) {
        var salt = b64ToBytes(p.s);
        var iv = b64ToBytes(p.i);
        var ct = b64ToBytes(p.c);
        var iter = p.iter || 150000;
        return window.crypto.subtle
          .importKey("raw", new TextEncoder().encode(pwd), { name: "PBKDF2" }, false, ["deriveKey"])
          .then(function (baseKey) {
            return window.crypto.subtle.deriveKey(
              { name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
              baseKey,
              { name: "AES-GCM", length: 256 },
              false,
              ["decrypt"]
            );
          })
          .then(function (key) {
            return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
          })
          .then(function (plainBuf) {
            var obj = JSON.parse(new TextDecoder().decode(plainBuf));
            window.LINGYUN_DATA = obj;
            // 关键：阻止 core.js 自动 init，等全部脚本（含页面）加载完成后再显式调用
            window.__LY_DEFER_INIT__ = true;
            if (SCRIPTS.length === 0) {
              throw new Error("未配置 __DASH_SCRIPTS__，无法加载看板脚本");
            }
            var chain = Promise.resolve();
            for (var i = 0; i < SCRIPTS.length; i++) {
              (function (src) { chain = chain.then(function () { return loadScript(src); }); })(SCRIPTS[i]);
            }
            return chain.then(function () {
              if (window.LY && typeof window.LY.init === "function") {
                window.LY.init();
              } else {
                throw new Error("未找到 window.LY.init，看板可能无法初始化");
              }
            });
          });
      });
  }
})();
