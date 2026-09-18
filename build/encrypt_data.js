#!/usr/bin/env node
// -*- coding: utf-8 -*-
// 加密看板数据：static/data.js -> static/data.js.enc
//
// 设计（方案 B：gzip + AES-256-GCM + PBKDF2，前端密码解密）：
//   - 密码从环境变量 DASH_PWD 读取，绝不写死进仓库/产物。
//   - 明文 JSON 先用 gzip 压缩（浏览器端用 DecompressionStream 解压），
//     把 27MB 级 JSON 压到约 5MB，大幅降低下载体积（解密慢的主因是下载+base64+解析）。
//   - 用 PBKDF2(SHA-256, 100000 次) 从密码派生 32 字节密钥。
//   - 用 AES-256-GCM 加密【压缩后的字节】；authTag 拼到密文尾部（与浏览器 Web Crypto 约定一致）。
//   - 产物为二进制文件，头部含 magic/kdf/压缩标记/迭代次数/各段长度，避免大段 base64 解码。
//
// 用法：
//   DASH_PWD=你的密码 node build/encrypt_data.js
//
// 注意：重新加密（如更换密码）只需换 DASH_PWD 再跑一次即可。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

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
const jsonText = m[1];
const jsonBuf = Buffer.from(jsonText, "utf8");

// 1) gzip 压缩（级别 9，最大化压缩率以降低下载体积）
const compressed = zlib.gzipSync(jsonBuf, { level: 9 });

// 2) PBKDF2 派生密钥 + AES-256-GCM 加密压缩字节
const salt = crypto.randomBytes(16);
const ITER = 100000;
const key = crypto.pbkdf2Sync(pwd, salt, ITER, 32, "sha256");
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(compressed), cipher.final()]);
const tag = cipher.getAuthTag();

// 3) 组装二进制文件（小端无关，统一用大端 uint32）
//    magic(4) | kdf(1) | comp(1) | iter(4) | saltLen(4) | ivLen(4) | tagLen(4) | salt | iv | tag | ciphertext
const header = Buffer.alloc(22);
header.write("LYE1", 0, "ascii"); // 4 字节魔数，便于前端校验文件格式
header[4] = 0;                    // kdf: 0 = PBKDF2-SHA256
header[5] = 1;                    // compression: 1 = gzip（浏览器 DecompressionStream）
header.writeUInt32BE(ITER, 6);
header.writeUInt32BE(salt.length, 10);
header.writeUInt32BE(iv.length, 14);
header.writeUInt32BE(tag.length, 18);

const out = Buffer.concat([header, salt, iv, tag, enc]);
fs.writeFileSync(path.join(STATIC, "data.js.enc"), out);

console.log("✓ 已生成 static/data.js.enc（二进制：gzip + AES-256-GCM）");
console.log("  明文 JSON :", (jsonBuf.length / 1024 / 1024).toFixed(1), "MB");
console.log("  压缩后   :", (compressed.length / 1024 / 1024).toFixed(1), "MB");
console.log("  密文文件 :", (out.length / 1024 / 1024).toFixed(1), "MB");
console.log("  提醒     : 明文 data.js 请勿随站点发布；如需换密码，换 DASH_PWD 重跑即可。");
