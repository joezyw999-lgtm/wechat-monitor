@echo off
chcp 65001 >nul
echo ========================================
echo   公众号推文监控系统 - 一键打包工具
echo ========================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org
    pause
    exit /b 1
)

REM 检查 pnpm
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [信息] 正在安装 pnpm...
    npm install -g pnpm
)

echo [1/3] 安装依赖...
call pnpm install --ignore-scripts
call pnpm approve-builds --yes

echo.
echo [2/3] 编译代码...
call pnpm run build:renderer
call pnpm run build:main

echo.
echo [3/3] 打包 EXE...
call npx electron-builder --win --x64

echo.
echo ========================================
echo   打包完成！
echo   安装程序在 release 目录下
echo ========================================
pause
