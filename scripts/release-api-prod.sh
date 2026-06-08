#!/usr/bin/env bash
# 发布生产 API（需在有 SSH 密钥的机器上执行）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_HOST="${SSH_HOST:-ai-recruit-prod}"
REMOTE_DIR="${REMOTE_DIR:-/opt/AI-Recruit}"
SHORT="$(git rev-parse --short HEAD)"
BUNDLE="/tmp/ai-recruit-main-${SHORT}.bundle"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "找不到 SSH 密钥: $SSH_KEY"
  echo "可设置: SSH_KEY=/path/to/key $0"
  exit 1
fi

echo "[release-api] 创建 bundle @ ${SHORT} …"
rm -f "$BUNDLE"
git bundle create "$BUNDLE" main

echo "[release-api] 上传到 ${SSH_HOST} …"
scp -i "$SSH_KEY" "$BUNDLE" "${SSH_HOST}:/tmp/"

echo "[release-api] 同步代码 …"
ssh -i "$SSH_KEY" "$SSH_HOST" bash -s <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
git fetch /tmp/$(basename "$BUNDLE") main
git merge --ff-only FETCH_HEAD
rm -f /tmp/$(basename "$BUNDLE")
docker compose build api
docker compose up -d --no-deps api
curl -sS https://mind.cisetech.com/api/health
echo
docker compose logs --tail=50 api
EOF

echo "[release-api] 完成。"
