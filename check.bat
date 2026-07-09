@echo off
echo.
echo ========================================
echo   环境检测工具
echo ========================================
echo.

echo 正在检测 Node.js...
where node
if %errorlevel% neq 0 (
    echo.
    echo [错误] Node.js 未安装或未添加到环境变量
    echo.
    echo 请执行以下操作:
    echo 1. 访问 https://nodejs.org
    echo 2. 下载 LTS 版本（左边绿色按钮）
    echo 3. 双击安装，一路下一步
    echo 4. 安装完成后，关闭所有命令提示符窗口
    echo 5. 重新解压 zip 文件，再运行 build.bat
    echo.
) else (
    echo [OK] Node.js 已安装
    node -v
    echo.
)

echo 正在检测 pnpm...
where pnpm
if %errorlevel% neq 0 (
    echo [提示] pnpm 未安装，将自动安装...
    call npm install -g pnpm
) else (
    echo [OK] pnpm 已安装
    pnpm -v
    echo.
)

echo.
echo ========================================
echo 检测完成，请截图发给我
echo ========================================
echo.
pause
