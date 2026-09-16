#!/usr/bin/env python3
# 部署 dist/ 到 gh-pages 分支（Git Blobs + Trees + Commit API，支持大文件）
import os, sys, json, base64, urllib.request, urllib.error

REPO = "flamemaster688/lingyun-dashboard"
BRANCH = "gh-pages"
DIST = "/Users/mac/Projects/lingyun-bi/dist"
# 部署令牌通过环境变量传入，禁止写死在仓库里（GitHub 密钥扫描会拦截含令牌的提交）。
# 用法：GITHUB_TOKEN=ghp_xxx python build/deploy_ghpages.py
PAT = os.environ.get("GITHUB_TOKEN")
if not PAT:
    raise SystemExit("缺少环境变量 GITHUB_TOKEN（GitHub PAT）。请勿把令牌写进仓库。")

API = "https://api.github.com"
HEADERS = {
    "Authorization": f"token {PAT}",
    "User-Agent": "lingyun-deploy",
    "Accept": "application/vnd.github+json",
}

def api(method, path, data=None):
    url = f"{API}/repos/{REPO}{path}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in HEADERS.items():
        req.add_header(k, v)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}, resp.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        print(f"HTTPError {e.code} on {method} {path}: {detail[:500]}", file=sys.stderr)
        raise

# 1) 收集 dist 文件
files = []
for root, _, names in os.walk(DIST):
    for n in names:
        full = os.path.join(root, n)
        rel = os.path.relpath(full, DIST)
        files.append((rel, full))
files.sort()

# 2) 逐个创建 blob（带返回值）
def api2(method, path, data=None):
    url = f"{API}/repos/{REPO}{path}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in HEADERS.items():
        req.add_header(k, v)
    if body:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.status

blobs = {}
for rel, full in files:
    with open(full, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    obj, _ = api2("POST", "/git/blobs", {"content": b64, "encoding": "base64"})
    blobs[rel] = obj["sha"]
    size = os.path.getsize(full)
    print(f"  blob ok {rel} ({size//1024}KB) -> {obj['sha'][:10]}")

# 3) 创建 tree
tree = [{"path": rel, "mode": "100644", "type": "blob", "sha": sha} for rel, sha in blobs.items()]
tree_obj, _ = api2("POST", "/git/trees", {"tree": tree})
print(f"tree created: {tree_obj['sha'][:10]} ({len(tree)} entries)")

# 4) 父提交（gh-pages 当前 head）
ref_obj, _ = api2("GET", f"/git/refs/heads/{BRANCH}")
parent_sha = ref_obj["object"]["sha"]
print(f"parent commit: {parent_sha[:10]}")

# 5) 创建提交
message = "数据更新：合并用户行为记录+质效分析，修复左侧菜单重复点击（deploy）"
commit_obj, _ = api2("POST", "/git/commits", {
    "message": message,
    "tree": tree_obj["sha"],
    "parents": [parent_sha],
})
print(f"commit created: {commit_obj['sha'][:10]}")

# 6) 更新 ref
api2("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit_obj["sha"], "force": True})
print("gh-pages ref updated ->", commit_obj["sha"][:10])
print("DONE")
