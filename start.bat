@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 保卫萝卜 · 复刻版
cd /d "%~dp0"

echo ============================================================
echo    保卫萝卜 · 复刻版  一键启动
echo ============================================================
echo.

rem ---- 找一个可用的 Python ----
set "PY="
where py >nul 2>nul && (py -3 -c "import sys" >nul 2>nul && set "PY=py -3")
if not defined PY (
  where python >nul 2>nul && (python -c "import sys" >nul 2>nul && set "PY=python")
)

if not defined PY (
  echo [错误] 没有找到 Python。
  echo.
  echo 这个游戏需要一个 Python 3 环境（只用标准库，不用装任何依赖）。
  echo 请到 https://www.python.org/downloads/ 下载安装，
  echo 安装时务必勾选 "Add python.exe to PATH"，装完再双击本文件。
  echo.
  pause
  exit /b 1
)

echo 使用 Python：%PY%
for /f "delims=" %%v in ('%PY% --version 2^>^&1') do echo 版本：%%v
echo.
echo 正在启动服务器……浏览器会自动打开，关掉这个窗口即可停止。
echo.

rem 端口默认 8000；被占用会自动顺延，无需手动处理
%PY% server.py --port 8000
set "CODE=%errorlevel%"

if not "%CODE%"=="0" (
  echo.
  echo [提示] 服务器异常退出（代码 %CODE%）。
  echo 常见原因：web 目录不完整、或 Python 版本过低（需要 3.8+）。
  pause
)
endlocal
