/* Deploy static/ to Netlify site via REST API (no CLI needed). */
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha1(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

const TOKEN = "nfp_hvUnqeJ82HZmbeoWYBd11aJ4x3Ve6yftd083";
const SITE_ID = "07855cf0-8d6d-4f37-9337-310fe4358ad5";
const STATIC = "C:/Users/赵莹/WorkBuddy/2026-08-07-14-38-17/lingyun_dashboard/static";

function req(method, urlPath, body, binary) {
  return new Promise((resolve, reject) => {
    const data = body ? (binary ? body : JSON.stringify(body)) : null;
    const u = new URL("https://api.netlify.com" + urlPath);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { Authorization: "Bearer " + TOKEN, Accept: "application/json" },
    };
    if (data) {
      if (binary) opts.headers["Content-Type"] = "application/octet-stream";
      else opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(data);
    }
    const r = https.request(opts, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const txt = buf.toString("utf-8");
        let json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error("HTTP " + res.statusCode + " " + (json && json.message ? json.message : txt.slice(0, 300))));
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function walk(dir, base, out) {
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, rel, out);
    else out.push({ rel: rel.split(path.sep).join("/"), full });
  });
  return out;
}

(async () => {
  const files = walk(STATIC, "", []);
  console.log("Collected " + files.length + " files to deploy.");

  // 1) create deploy (send real SHA1 so Netlify computes the true required set)
  const filesMap = {};
  files.forEach((f) => { filesMap[f.rel] = sha1(f.full); });
  const deploy = await req("POST", "/api/v1/sites/" + SITE_ID + "/deploys", { files: filesMap, draft: false });
  const deployId = deploy.id;
  console.log("Created deploy " + deployId + ", required=" + (deploy.required ? deploy.required.length : "n/a"));

  // 2) upload only the files Netlify requires (required = list of SHA1 hashes to upload)
  console.log("required (sha):", JSON.stringify(deploy.required));
  const reqSet = new Set(deploy.required || []);
  let toUp = files;
  if (reqSet.size && !reqSet.has("")) {
    // map each required sha back to the file that has it
    const bySha = {};
    files.forEach((f) => { bySha[sha1(f.full)] = f; });
    toUp = deploy.required.map((h) => bySha[h]).filter(Boolean);
  }
  console.log("Uploading " + toUp.length + " files...");
  let i = 0;
  for (const f of toUp) {
    const buf = fs.readFileSync(f.full);
    await req("PUT", "/api/v1/deploys/" + deployId + "/files/" + encodeURI(f.rel), buf, true);
    i++;
    if (i % 20 === 0) console.log("  uploaded " + i + "/" + toUp.length);
  }
  console.log("Uploaded " + i + " files.");

  // 3) poll until ready
  let state = deploy.state;
  for (let k = 0; k < 30; k++) {
    const d = await req("GET", "/api/v1/deploys/" + deployId);
    state = d.state;
    if (state === "ready" || state === "prepared") break;
    if (state === "error") { console.log("Deploy error:", d.error_message || d); break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("Final state: " + state);
  console.log("URL: https://heroic-faun-a8852b.netlify.app");
  // 4) sanity check homepage
  try {
    const chk = await req("GET", "/api/v1/sites/" + SITE_ID);
    console.log("Site published_deploy: " + (chk.published_deploy ? chk.published_deploy.id : "none") + " / ssl_url=" + chk.ssl_url);
  } catch (e) { console.log("site check failed:", e.message); }
})().catch((e) => { console.error("DEPLOY FAILED:", e.message); process.exit(1); });
