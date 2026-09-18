/*
 * static/decrypt.js —— 看板密码保护引导（方案 B：前端密码解密）
 * ------------------------------------------------------------------
 * 流程：全屏密码遮罩 → 用户输入密码 → fetch data.js.enc(二进制) →
 *       PBKDF2 派生密钥 → AES-GCM 解密 → gzip 解压 → 写入 window.LINGYUN_DATA →
 *       动态顺序加载内核与页面 → 显式调用 window.LY.init()。
 *
 * 性能要点（针对"解密慢"优化）：
 *   - 密文为二进制（非 base64 文本），免去大段 base64 解码；
 *   - 明文先 gzip 压缩，下载体积从 ~36MB 降到 ~5MB，下载大幅加快；
 *   - 带下载进度提示，改善体感。
 *
 * 配合：
 *   - index.html 内设置 window.__DASH_SCRIPTS__（要动态加载的脚本列表）
 *   - core/core.js 暴露 window.LY.init，并在 __LY_DEFER_INIT__ 为真时
 *     不自动初始化，改由本脚本在全部脚本就绪后调用。
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
    ".dash-lock-bar{height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden;margin-top:10px;display:none;}",
    ".dash-lock-bar>i{display:block;height:100%;width:0;background:#2563eb;transition:width .15s linear;}",
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
      '<div class="dash-lock-bar"><i id="dash-bar"></i></div>' +
      '<div class="dash-lock-hint">连续错误 5 次将锁定 60 秒</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var input = overlay.querySelector("#dash-pwd");
  var btn = overlay.querySelector("#dash-go");
  var msg = overlay.querySelector("#dash-msg");
  var bar = overlay.querySelector("#dash-bar");
  var barWrap = overlay.querySelector(".dash-lock-bar");
  var fails = 0;
  var locked = false;

  function setMsg(text, isErr) {
    msg.textContent = text || "";
    msg.style.color = isErr ? "#dc2626" : "#2563eb";
  }
  function setProgress(p) {
    if (p == null) { barWrap.style.display = "none"; return; }
    barWrap.style.display = "block";
    bar.style.width = Math.max(0, Math.min(100, Math.round(p * 100))) + "%";
  }
  input.focus();

  function attempt() {
    if (locked) return;
    var pwd = input.value;
    if (!pwd) { setMsg("请输入密码", true); return; }
    setMsg("正在准备…", false);
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
        setProgress(null);
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
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("脚本加载失败: " + src)); };
      document.head.appendChild(s);
    });
  }

  // 带进度的 fetch（二进制 ArrayBuffer）
  function fetchBinaryProgress(url, onProgress) {
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error("无法获取加密数据 (HTTP " + resp.status + ")");
      var total = parseInt(resp.headers.get("Content-Length") || "0", 10) || 0;
      if (!resp.body || !resp.body.getReader) {
        // 老浏览器：直接读
        return resp.arrayBuffer().then(function (buf) { onProgress && onProgress(1); return buf; });
      }
      var reader = resp.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(received);
            var pos = 0;
            for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], pos); pos += chunks[i].length; }
            onProgress && onProgress(1);
            return out.buffer;
          }
          received += r.value.length;
          chunks.push(r.value);
          if (total) onProgress && onProgress(received / total);
          return pump();
        });
      }
      return pump();
    });
  }

  // gzip 解压（浏览器原生 DecompressionStream）
  function gunzip(buf) {
    if (typeof window.DecompressionStream === "undefined") {
      return Promise.reject(new Error("当前浏览器不支持解压缩，请使用较新版本 Chrome / Edge / Firefox / Safari"));
    }
    var ds = new DecompressionStream("gzip");
    var writer = ds.writable.getWriter();
    writer.write(buf);
    writer.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // ---------- 核心：解密 + 启动 ----------
  function decryptAndBoot(pwd) {
    setMsg("下载加密数据中…", false);
    setProgress(0);
    return fetchBinaryProgress(ENC_URL, function (p) {
      setProgress(p);
      setMsg("下载中 " + Math.round(p * 100) + "%", false);
    }).then(function (buf) {
      var u = new Uint8Array(buf);
      if (u.length < 22 || String.fromCharCode(u[0], u[1], u[2], u[3]) !== "LYE1") {
        throw new Error("加密文件格式不兼容，请重新生成 data.js.enc");
      }
      var dv = new DataView(buf);
      var comp = u[5];
      var iter = dv.getUint32(6, false);
      var saltLen = dv.getUint32(10, false);
      var ivLen = dv.getUint32(14, false);
      var tagLen = dv.getUint32(18, false);
      var off = 22;
      var salt = u.subarray(off, off + saltLen); off += saltLen;
      var iv = u.subarray(off, off + ivLen); off += ivLen;
      var tag = u.subarray(off, off + tagLen); off += tagLen;
      var ct = u.subarray(off); // 密文（tag 已单独取出）
      // 重要：浏览器 Web Crypto 没有 setAuthTag，要求 authTag 必须拼在密文尾部一起传入；
      // 而加密文件格式把 tag 单独放在密文之前，因此这里必须手动拼接回去，否则校验永远失败。
      var ctWithTag = new Uint8Array(ct.length + tag.length);
      ctWithTag.set(ct, 0);
      ctWithTag.set(tag, ct.length);

      setMsg("解密中…", false);
      setProgress(null);
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
          return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ctWithTag);
        })
        .then(function (plainBuf) {
          var bytes = (comp === 1) ? null : new Uint8Array(plainBuf);
          return (comp === 1) ? gunzip(new Uint8Array(plainBuf)) : bytes;
        })
        .then(function (bytes) {
          var obj = JSON.parse(new TextDecoder().decode(bytes));
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
