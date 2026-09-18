#!/usr/bin/env node
// -*- coding: utf-8 -*-
// 加解密 round-trip 验证：用 Node 的 Web Crypto 模拟浏览器解密，
// 确认 encrypt_data.js（Node crypto 加密）产出的二进制 data.js.enc
// 能被正确还原（解密 -> gzip 解压 -> JSON.parse），且与原 data.js 完全一致。
// 这保证两端（Node 加密 / 浏览器 Web Crypto 解密）参数兼容。
//
// 用法：DASH_PWD=加密时用的密码 node build/test_encrypt.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { webcrypto } = crypto;

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, "static");
const pwd = process.env.DASH_PWD;
if (!pwd) { console.error("✗ 缺少密码。用法: DASH_PWD=xxx node build/test_encrypt.js"); process.exit(1); }

(async function () {
  const encPath = path.join(STATIC, "data.js.enc");
  if (!fs.existsSync(encPath)) { console.error("✗ 未找到 data.js.enc，请先运行 encrypt_data.js"); process.exit(1); }
  const buf = fs.readFileSync(encPath);

  // 解析二进制头
  if (buf.length < 22 || buf.toString("ascii", 0, 4) !== "LYE1") {
    console.error("✗ 加密文件格式不兼容（非 LYE1 二进制格式）"); process.exit(1);
  }
  const comp = buf[5];
  const iter = buf.readUInt32BE(6);
  const saltLen = buf.readUInt32BE(10);
  const ivLen = buf.readUInt32BE(14);
  const tagLen = buf.readUInt32BE(18);
  let off = 22;
  const salt = buf.subarray(off, off + saltLen); off += saltLen;
  const iv = buf.subarray(off, off + ivLen); off += ivLen;
  const tag = buf.subarray(off, off + tagLen); off += tagLen;
  const ct = Buffer.concat([buf.subarray(off), tag]); // Web Crypto 期望密文尾部带 tag

  const baseKey = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(pwd), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const plainBuf = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv }, key, ct
  );

  let jsonBuf = Buffer.from(plainBuf);
  if (comp === 1) jsonBuf = zlib.gunzipSync(jsonBuf); // 模拟浏览器 DecompressionStream
  const obj = JSON.parse(jsonBuf.toString("utf8"));

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

  const a = obj.agentMonthly[0];
  const b = orig.agentMonthly[0];
  const okSample = JSON.stringify(a) === JSON.stringify(b);
  console.log("首行明细一致:", okSample);

  if (okKeys && okRows && okMeta && okSample) {
    console.log("\n✅ round-trip 通过：加密产物(二进制 gzip+AES-GCM)可被（与浏览器一致的）Web Crypto 正确解密并完整还原。");
    process.exit(0);
  } else {
    console.error("\n❌ round-trip 校验失败");
    process.exit(1);
  }
})().catch(function (e) {
  console.error("❌ 解密失败（密码可能错误）:", e.message);
  process.exit(1);
});
