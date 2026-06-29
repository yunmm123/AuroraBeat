#!/bin/bash
echo "========================================"
echo "  AuroraBeat 打包脚本 - macOS 版本"
echo "========================================"
echo ""

echo "[1/3] 设置国内镜像加速..."
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export NPM_CONFIG_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo "已设置镜像"

echo ""
echo "[2/3] 安装依赖..."
npm install --registry=https://registry.npmmirror.com
if [ $? -ne 0 ]; then
    echo "依赖安装失败，请检查网络连接"
    read -p "按回车键退出"
    exit 1
fi
echo "依赖安装完成"

echo ""
echo "[3/3] 开始打包 macOS 版本..."
echo ""
echo "请选择打包方式："
echo "  1. DMG 安装包"
echo "  2. 文件夹形式 (无需安装)"
echo "  3. 全部生成"
echo ""
read -p "请输入选项 (1-3): " choice

case $choice in
    1)
        echo "正在生成 DMG 安装包..."
        npm run build:mac
        ;;
    2)
        echo "正在生成文件夹版本..."
        npm run build:dir
        ;;
    3)
        echo "正在生成全部版本..."
        npm run build:mac
        ;;
    *)
        echo "无效选项"
        read -p "按回车键退出"
        exit 1
        ;;
esac

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "  打包完成！"
    echo "  输出目录: release/"
    echo "========================================"
else
    echo ""
    echo "打包失败，请检查上面的错误信息"
fi

read -p "按回车键退出"
