#!/usr/bin/env node
// -*- coding: utf-8 -*-
// 加密看板数据：static/data.js -> static/data.js.enc
//                 static/data-agents.js -> static/data-agents.js.enc（智能体逐月明细分块，按需解密）
//
// 设计（方案 B：gzip + AES-256-GCM + PBKDF2，前端密码解密）：
//   - 密码从环境变量 DASH_PWD 读取，绝不写死进仓库/产物。
//   - 明文 JSON 先用 gzip 压缩（浏览器端用 DecompressionStream 解压），降低下载体积。
//   - 用 PBKDF2(SHA-256, 100000 次) 从密码派生 32 字节密钥。
//   - 用 AES-256-GCM 加密【压缩后的字节】；authTag 拼到密文尾部（与浏览器 Web Crypto 约定一致）。
//   - 产物为二进制文件，头部含 magic/kdf/压缩标记/迭代次数/各段长度。
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

const ITER = 100000;

// 括号/方括号配平，从 startIdx（应为 '{' 或 '['）开始，返回含结束括号的切片。
function balancedSlice(text, startIdx) {
  const open = text[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  throw new Error("未找到配平的结束括号");
}

// 从文本里抽取 marker 之后的对象或数组字面量文本
function extractPayload(text, marker, bracket) {
  const m = text.indexOf(marker);
  if (m < 0) return null;
  const b = text.indexOf(bracket, m);
  if (b < 0) return null;
  return balancedSlice(text, b);
}

// 加密一段 JSON 文本为二进制文件（LYE1 头 + salt + iv + tag + ciphertext）
function encryptJsonToFile(jsonText, outName) {
  const jsonBuf = Buffer.from(jsonText, "utf8");
  const compressed = zlib.gzipSync(jsonBuf, { level: 9 });
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(pwd, salt, ITER, 32, "sha256");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = Buffer.alloc(22);
  header.write("LYE1", 0, "ascii");
  header[4] = 0; // kdf: 0 = PBKDF2-SHA256
  header[5] = 1; // compression: 1 = gzip
  header.writeUInt32BE(ITER, 6);
  header.writeUInt32BE(salt.length, 10);
  header.writeUInt32BE(iv.length, 14);
  header.writeUInt32BE(tag.length, 18);

  const out = Buffer.concat([header, salt, iv, tag, enc]);
  fs.writeFileSync(path.join(STATIC, outName), out);

  console.log("✓ 已生成 " + outName);
  console.log("  明文 JSON :", (jsonBuf.length / 1024 / 1024).toFixed(1), "MB");
  console.log("  压缩后   :", (compressed.length / 1024 / 1024).toFixed(1), "MB");
  console.log("  密文文件 :", (out.length / 1024 / 1024).toFixed(1), "MB");
}

// 1) 主数据：window.LINGYUN_DATA = {...}
const dataSrc = path.join(STATIC, "data.js");
const dataRaw = fs.readFileSync(dataSrc, "utf8");
const dataJson = extractPayload(dataRaw, "window.LINGYUN_DATA", "{");
if (!dataJson) {
  console.error("✗ 无法从 data.js 解析 window.LINGYUN_DATA");
  process.exit(1);
}
encryptJsonToFile(dataJson, "data.js.enc");

// 2) 智能体逐月明细分块：window.LINGYUN_AGENT_MONTHLY = [...]（按需解密，避免首屏解析 22MB）
const chunkSrc = path.join(STATIC, "data-agents.js");
if (fs.existsSync(chunkSrc)) {
  const chunkRaw = fs.readFileSync(chunkSrc, "utf8");
  const chunkJson = extractPayload(chunkRaw, "window.LINGYUN_AGENT_MONTHLY", "[");
  if (chunkJson) {
    encryptJsonToFile(chunkJson, "data-agents.js.enc");
  } else {
    console.warn("⚠ 未从 data-agents.js 解析到数组，跳过分块加密");
  }
} else {
  console.log("ℹ 未找到 data-agents.js，跳过分块加密（将作为整体 data.js 的一部分已加密）");
}

console.log("提醒：明文 data.js / data-agents.js 请勿随站点发布；如需换密码，换 DASH_PWD 重跑即可。");
