#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Budget — start the app locally (macOS / Linux)
#  Run:  ./start-budget.sh
#  Stop: press Ctrl+C
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

PORT=8765
URL="http://localhost:$PORT/"

echo ""
echo " Budget - local household spending tracker"
echo " -----------------------------------------"
echo ""

open_browser() {
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  else echo " Open this address in your browser: $URL"; fi
}

if command -v python3 >/dev/null 2>&1; then
  echo " Starting local server with Python on $URL"
  echo " Press Ctrl+C to stop."
  echo ""
  open_browser &
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  echo " Starting local server with Python on $URL"
  echo " Press Ctrl+C to stop."
  echo ""
  open_browser &
  exec python -m http.server "$PORT"
elif command -v node >/dev/null 2>&1; then
  echo " Starting local server with Node.js on $URL"
  echo " Press Ctrl+C to stop."
  echo ""
  open_browser &
  exec node server.js
else
  echo " Python or Node.js is required to run a local server."
  echo ""
  echo " Easiest alternative: open index.html directly in your browser."
  echo " The app still works, but its data is tied to that file location"
  echo " and the phone-style install (offline mode) is not available."
  echo ""
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "index.html" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "index.html" >/dev/null 2>&1 || true; fi
fi
