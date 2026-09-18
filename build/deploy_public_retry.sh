#!/bin/bash
# 公网部署重试脚本：强推干净 main + 部署 gh-pages（抓代理恢复窗口）
export GIT_HTTP_VERSION=1.1
REPO="/Users/mac/WorkBuddy/2026-09-14-15-53-05/project/lingyun_bi/2026-08-07-14-38-17/lingyun_dashboard"
DIST="$REPO/dist"
# 令牌从环境变量读取，绝不写死进仓库（避免 GitHub Push Protection 拦截 + 密钥泄漏）
# 用法：LY_GITHUB_PAT=ghp_xxx bash build/deploy_public_retry.sh
if [ -z "${LY_GITHUB_PAT}" ]; then
  echo "ERROR: 请先设置环境变量 LY_GITHUB_PAT（你的 GitHub PAT），例如："
  echo "  LY_GITHUB_PAT=ghp_xxx bash build/deploy_public_retry.sh"
  exit 1
fi
URL="https://${LY_GITHUB_PAT}@github.com/flamemaster688/lingyun-dashboard.git"
LOG=/tmp/deploy_public.log
echo "===== start $(date) =====" > "$LOG"

# 大文件推送：放大 postBuffer，避免代理/服务端对大 POST 直接 400
git config --global http.postBuffer 524288000

# ---------- 1) 强推干净 main（已 filter-branch 去除 data.js 明文）----------
cd "$REPO"
echo "[1/2] force push clean main ..." >> "$LOG"
for i in $(seq 1 50); do
  if git push --force "$URL" sync:main >>"$LOG" 2>&1; then
    echo "MAIN_FORCE_OK attempt=$i $(date)" >> "$LOG"
    git update-ref refs/remotes/origin/main "$(git rev-parse sync)"
    break
  fi
  echo "main attempt $i fail: $(tail -1 "$LOG" | cut -c1-70)" >> "$LOG"
  sleep 20
done

# ---------- 2) gh-pages 部署 ----------
TMP="/tmp/ly_gh_deploy_$(date +%s)"
rm -rf "$TMP"
CLONED=0
echo "[2/2] deploy gh-pages ..." >> "$LOG"
for i in $(seq 1 50); do
  if git clone --depth 1 --branch gh-pages --single-branch "$URL" "$TMP" >>"$LOG" 2>&1; then
    CLONED=1; echo "GHP_CLONE_OK attempt=$i" >> "$LOG"; break
  fi
  echo "ghp clone attempt $i fail" >> "$LOG"
  sleep 20
done

if [ "$CLONED" -ne 1 ]; then
  echo "GHP clone all failed -> init orphan gh-pages" >> "$LOG"
  mkdir -p "$TMP"; cd "$TMP"; git init -q; git symbolic-ref HEAD refs/heads/gh-pages
else
  cd "$TMP"
fi

# 用最新 dist 覆盖发布内容
find . -maxdepth 1 -mindepth 1 -not -name '.git' -exec rm -rf {} +
cp -r "$DIST/." .
touch .nojekyll
git add -A
git -c user.name=WorkBuddy -c user.email=agent@workbuddy.local commit -q -m "deploy: 灵运BI看板(密码保护, 数据加密)" 2>>"$LOG"
echo "GHP_COMMITTED $(git rev-parse HEAD 2>/dev/null)" >> "$LOG"

for i in $(seq 1 50); do
  if git push --force "$URL" gh-pages >>"$LOG" 2>&1; then
    echo "GHP_PUSH_OK attempt=$i $(date)" >> "$LOG"; break
  fi
  echo "ghp push attempt $i fail: $(tail -1 "$LOG" | cut -c1-70)" >> "$LOG"
  sleep 20
done

echo "===== end $(date) =====" >> "$LOG"
