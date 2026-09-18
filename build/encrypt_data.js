#!/usr/bin/env node
// -*- coding: utf-8 -*-
// 加密看板数据：static/data.js -> static/data.js.enc
//
// 设计（方案 B：AES-256-GCM + PBKDF2，前端密码解密）：
//   - 密码从环境变量 DASH_PWD 读取，绝不写死进仓库/产物。
//   - 用 PBKDF2(SHA-256, 150000 次) 从密码派生 32 字节密钥。
//   - 用 AES-256-GCM 加密 data.js 里的 JSON 明文；authTag 拼到密文尾部（与浏览器 Web Crypto 默认约定一致）。
//   - 产物 data.js.enc 仅含 salt/iv/密文(base64)，不含明文。
//
// 用法：
//   DASH_PWD=你的密码 node build/encrypt_data.js
//
// 注意：重新加密（如更换密码）只需换 DASH_PWD 再跑一次即可。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, "static");
const pwd = process.env.DASH_PWD;
if (!pwd) {
  console.error("✗ 缺少密码。用法: DASH_PWD=你的密码 node build/encrypt_data.js");
  process.exit(1);
}

const src = path.join(STATIC, "data.js");
const raw = fs.readFileSync(src, "utf8");
// 提取 window.LINGYUN_DATA = {...}; 中的 JSON 文本（保留原始对象，避免二次序列化改变结构）
const m = raw.match(/window\.LINGYUN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
if (!m) {
  console.error("✗ 无法从 data.js 解析 window.LINGYUN_DATA");
  process.exit(1);
}
const plaintext = Buffer.from(m[1], "utf8");

const salt = crypto.randomBytes(16);
const ITER = 150000;
const key = crypto.pbkdf2Sync(pwd, salt, ITER, 32, "sha256");
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

// c = 密文 + authTag（Web Crypto 的 AES-GCM 期望密文尾部带 16 字节 tag）
const payload = {
  v: 1,
  kdf: "pbkdf2",
  hash: "sha256",
  iter: ITER,
  s: salt.toString("base64"),
  i: iv.toString("base64"),
  c: Buffer.concat([enc, tag]).toString("base64")
};

fs.writeFileSync(path.join(STATIC, "data.js.enc"), JSON.stringify(payload));
console.log("✓ 已生成 static/data.js.enc");
console.log("  明文大小 :", (plaintext.length / 1024 / 1024).toFixed(1), "MB");
console.log("  密文大小 :", (Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(1), "MB");
console.log("  提醒     : 明文 data.js 请勿随站点发布；如需换密码，换 DASH_PWD 重跑即可。");
