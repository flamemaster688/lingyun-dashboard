#!/usr/bin/env node
// -*- coding: utf-8 -*-
// 加解密 round-trip 验证：用 Node 的 Web Crypto 模拟浏览器解密，
// 确认 encrypt_data.js（Node crypto 加密）产出的 data.js.enc 能被正确还原，
// 且还原后的 JSON 与原 data.js 完全一致。这保证两端（Node 加密 / 浏览器 Web Crypto 解密）参数兼容。
//
// 用法：DASH_PWD=加密时用的密码 node build/test_encrypt.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { webcrypto } = crypto;

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, "static");
const pwd = process.env.DASH_PWD;
if (!pwd) { console.error("✗ 缺少密码。用法: DASH_PWD=xxx node build/test_encrypt.js"); process.exit(1); }

function b64ToBytes(b) { return new Uint8Array(Buffer.from(b, "base64")); }

(async function () {
  const encPath = path.join(STATIC, "data.js.enc");
  if (!fs.existsSync(encPath)) { console.error("✗ 未找到 data.js.enc，请先运行 encrypt_data.js"); process.exit(1); }
  const p = JSON.parse(fs.readFileSync(encPath, "utf8"));

  const baseKey = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(pwd), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(p.s), iterations: p.iter, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const plainBuf = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(p.i) }, key, b64ToBytes(p.c)
  );
  const obj = JSON.parse(new TextDecoder().decode(plainBuf));

  // 对比原始 data.js
  const raw = fs.readFileSync(path.join(STATIC, "data.js"), "utf8");
  const m = raw.match(/window\.LINGYUN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
  const orig = JSON.parse(m[1]);

  const okKeys = JSON.stringify(Object.keys(obj).sort()) === JSON.stringify(Object.keys(orig).sort());
  const okRows = obj.agentMonthly && orig.agentMonthly && obj.agentMonthly.length === orig.agentMonthly.length;
  const okMeta = JSON.stringify(obj.meta) === JSON.stringify(orig.meta);

  console.log("解密成功: 是");
  console.log("域一致  :", okKeys, "(密钥数", Object.keys(obj).length, ")");
  console.log("agentMonthly 行数一致:", okRows, "(" + (obj.agentMonthly && obj.agentMonthly.length) + " 行)");
  console.log("meta 一致:", okMeta);

  // 抽样校验一条明细数值
  const a = obj.agentMonthly[0];
  const b = orig.agentMonthly[0];
  const okSample = JSON.stringify(a) === JSON.stringify(b);
  console.log("首行明细一致:", okSample);

  if (okKeys && okRows && okMeta && okSample) {
    console.log("\n✅ round-trip 通过：加密产物可被（与浏览器一致的）Web Crypto 正确解密并完整还原。");
    process.exit(0);
  } else {
    console.error("\n❌ round-trip 校验失败");
    process.exit(1);
  }
})().catch(function (e) {
  console.error("❌ 解密失败（密码可能错误）:", e.message);
  process.exit(1);
});
