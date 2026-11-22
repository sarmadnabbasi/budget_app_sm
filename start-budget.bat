@echo off
REM ─────────────────────────────────────────────────────────────
REM  Budget — start the app locally on this PC (Windows)
REM  Double-click this file. A browser tab opens with the app.
REM  Keep this window open while you use the app; close it when done.
REM ─────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

echo.
echo  Budget - local household spending tracker
echo  -----------------------------------------
echo.

REM Prefer Python (built into many PCs, or a small install).
where py >nul 2>nul
if %errorlevel%==0 (
  echo  Starting local server with Python...
  echo  The app will open at http://localhost:8765/
  echo  Close this window to stop the app.
  echo.
  start "" "http://localhost:8765/"
  py -m http.server 8765
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo  Starting local server with Python...
  echo  The app will open at http://localhost:8765/
  echo  Close this window to stop the app.
  echo.
  start "" "http://localhost:8765/"
  python -m http.server 8765
  goto :end
)

REM Fall back to Node.js if Python is not installed.
where node >nul 2>nul
if %errorlevel%==0 (
  echo  Starting local server with Node.js...
  echo  The app will open at http://localhost:8765/
  echo  Close this window to stop the app.
  echo.
  start "" "http://localhost:8765/"
  node server.js
  goto :end
)

echo  Python and Node.js were not found on this PC.
echo.
echo  Easiest option: open index.html by double-clicking it.
echo  The app still works, but its data is tied to that file location
echo  and the phone-style install (offline mode) is not available.
echo.
echo  For the full local experience, install Python from python.org
echo  and run this file again.
echo.
start "" "index.html"
pause

:end
endlocal
