#!/bin/bash
cd "$(dirname "$0")"
PORT=8780
URL="http://127.0.0.1:$PORT/index.html"

responds() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$URL" 2>/dev/null | grep -q 200
}

if responds; then
  open "$URL"
  exit 0
fi

# Порт занят зависшим процессом — освобождаем и поднимаем заново
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null
  sleep 0.3
fi

python3 "$PWD/serve.py" "$PORT" >/tmp/dog-draw-server.log 2>&1 &
sleep 0.5
open "$URL"
