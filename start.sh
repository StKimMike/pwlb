#!/usr/bin/env bash
# 保卫萝卜 · 复刻版 —— macOS / Linux 一键启动
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "   保卫萝卜 · 复刻版  一键启动"
echo "============================================================"
echo ""

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >/dev/null 2>&1; then
      PY="$cand"; break
    fi
  fi
done

if [ -z "$PY" ]; then
  echo "[错误] 没有找到 Python 3.8+。"
  echo "这个游戏只需要 Python 标准库，不需要安装任何依赖。"
  echo "macOS 可以用 brew install python3，Linux 用 apt install python3。"
  exit 1
fi

echo "使用 Python：$PY"
"$PY" --version
echo ""
echo "正在启动服务器……浏览器会自动打开，按 Ctrl+C 停止。"
echo ""

exec "$PY" server.py --port 8000
