#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新版本。'
  read -k 1
  exit 1
fi
if [ ! -d node_modules ]; then
  npm ci || exit 1
fi
npm run build || exit 1
node scripts/launch.mjs
