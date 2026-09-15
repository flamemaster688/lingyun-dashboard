#!/usr/bin/env bash
# 灵运看板一键部署到 Netlify 公开站点 heroic-faun-a8852b
# 用法：bash deploy_netlify.sh   （也可 NETLIFY_AUTH_TOKEN=xxx bash deploy_netlify.sh 覆盖）
set -e
# ⚠️ 安全：Token 禁止落盘明文！必须走环境变量传入，例如：
#   NETLIFY_AUTH_TOKEN=你的新Token bash deploy_netlify.sh
# 交接后请立即到 Netlify 后台「User settings → Applications」吊销旧 Token 并重新生成。
if [ -z "${NETLIFY_AUTH_TOKEN:-}" ]; then
  echo "错误：未设置 NETLIFY_AUTH_TOKEN 环境变量。请先导出新 Token 后再部署。" >&2
  exit 1
fi
export NETLIFY_AUTH_TOKEN
SITE_ID="07855cf0-8d6d-4f37-9337-310fe4358ad5"
NL="C:/Users/赵莹/.workbuddy/binaries/node/workspace/node_modules/.bin/netlify"
STATIC="C:/Users/赵莹/WorkBuddy/2026-08-07-14-38-17/lingyun_dashboard/static"
cd "$STATIC"
exec "$NL" deploy --prod --dir=. --site="$SITE_ID"
