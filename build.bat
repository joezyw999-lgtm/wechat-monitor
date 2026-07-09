@echo off
chcp 65001 >nul 2>nul
title 公众号推文监控系统 - 打包工具

echo.
echo ========================================
echo   公众号推文监控系统 - 一键打包工具
echo ========================================
echo.
echo 正在检查环境...
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js！
    echo.
    echo 请先安装 Node.js:
    echo 1. 打开浏览器访问 https://nodejs.org
    echo 2. 下载 LTS 版本并安装
    echo 3. 安装完成后重新运行此脚本
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js 已安装
node -v

REM 检查 pnpm
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [信息] 正在安装 pnpm，请稍候...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [错误] pnpm 安装失败
        pause
        exit /b 1
    )
)

echo [OK] pnpm 已安装
pnpm -v

echo.
echo ========================================
echo   开始打包，请耐心等待...
echo ========================================
echo.

echo [1/4] 安装项目依赖...
call pnpm install --ignore-scripts
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

echo.
echo [2/4] 批准构建脚本...
call pnpm approve-builds --yes

echo.
echo [3/4] 编译代码...
call pnpm run build:renderer
if %errorlevel% neq 0 (
    echo [错误] 前端编译失败
    pause
    exit /b 1
)

call pnpm run build:main
if %errorlevel% neq 0 (
    echo [错误] 主进程编译失败
    pause
    exit /b 1
)

echo.
echo [4/4] 打包 EXE（这一步需要几分钟）...
call npx electron-builder --win --x64
if %errorlevel% neq 0 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo   打包成功！
echo.
echo   安装程序位置: release\ 文件夹
echo   双击里面的 .exe 文件即可安装
echo ========================================
echo.
pause
