@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Ask your local AI assistant to prepare the environment.
  exit /b 1
)
node "%~dp0scripts\control.mjs" %*
