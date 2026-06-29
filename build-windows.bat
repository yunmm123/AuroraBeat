@echo off
chcp 65001 >nul
echo ========================================
echo   AuroraBeat 打包脚本 - Windows 版本
echo ========================================
echo.

echo [1/3] 设置国内镜像加速...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set NPM_CONFIG_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo 已设置镜像

echo.
echo [2/3] 安装依赖（如已安装可跳过）...
npm install --registry=https://registry.npmmirror.com
if %errorlevel% neq 0 (
    echo 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)
echo 依赖安装完成

echo.
echo [3/3] 开始打包 Windows 版本...
echo.
echo 请选择打包方式：
echo   1. 安装包 (NSIS .exe)
echo   2. 便携版 (Portable .exe)
echo   3. 文件夹形式 (无需安装)
echo   4. 全部生成
echo.
set /p choice=请输入选项 (1-4): 

if "%choice%"=="1" (
    echo 正在生成安装包...
    npm run build:win
) else if "%choice%"=="2" (
    echo 正在生成便携版...
    npx electron-builder --win --x64 --publish never
) else if "%choice%"=="3" (
    echo 正在生成文件夹版本...
    npm run build:dir
) else if "%choice%"=="4" (
    echo 正在生成全部版本...
    npm run build:win
) else (
    echo 无效选项
    pause
    exit /b 1
)

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   打包完成！
    echo   输出目录: release\
    echo ========================================
) else (
    echo.
    echo 打包失败，请检查上面的错误信息
)

pause
