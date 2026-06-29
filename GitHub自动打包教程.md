# GitHub 自动打包使用指南

不用在自己电脑上装任何开发工具！让 GitHub 帮你自动打包 AuroraBeat。

## 📝 原理说明

GitHub 提供免费的服务器（GitHub Actions），可以帮你自动编译和打包软件。你只需要：
1. 把代码传到 GitHub
2. 等几分钟，让 GitHub 自动打包
3. 直接下载打包好的软件

---

## 🚀 第一步：注册 GitHub 账号

如果你还没有 GitHub 账号：

1. 打开 https://github.com/
2. 点击右上角「Sign up」
3. 按照提示注册（免费的）

---

## 📤 第二步：上传代码到 GitHub

### 方法一：网页上传（最简单，推荐）

1. 登录 GitHub 后，点击右上角的 **+** 号，选择 **New repository**

2. 填写仓库信息：
   - **Repository name**: `AuroraBeat`（随便起个名字）
   - **Description**: 沉浸式高端音乐播放器（可选）
   - 选择 **Public**（公开，免费）或 **Private**（私有）
   - ❌ 不要勾选「Add a README file」
   - ❌ 不要勾选「Add .gitignore」
   - ❌ 不要勾选「Choose a license」

3. 点击 **Create repository**

4. 在下一个页面，找到「**uploading an existing file**」，点击它

5. 把你项目文件夹里的**所有文件**都拖进去（除了 `node_modules`、`dist`、`dist-electron`、`release` 这些文件夹）

   需要上传的文件包括：
   ```
   .github/          ← 这个文件夹很重要！
   electron/
   public/
   src/
   .gitignore
   index.html
   package.json
   package-lock.json
   postcss.config.js
   README.md
   tailwind.config.js
   tsconfig.json
   tsconfig.node.json
   vite.config.ts
   打包说明.md
   build-windows.bat
   build-mac.sh
   ```

6. 点击页面底部的 **Commit changes**

7. 完成！代码已经上传到 GitHub 了。

### 方法二：用 Git 命令行（如果你会用 Git）

```bash
# 在项目文件夹里打开终端
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/你的用户名/AuroraBeat.git
git push -u origin main
```

---

## ⚙️ 第三步：查看自动打包进度

代码上传后，GitHub 会自动开始打包：

1. 进入你的仓库页面

2. 点击顶部的 **Actions** 标签

3. 你会看到一个正在运行的工作流，名字叫「Build AuroraBeat」

4. 点击进去可以看到打包进度
   - 大概需要 **5-10 分钟**
   - 有三个任务在同时跑：Windows、macOS、Linux

5. 等所有任务都变成 ✅ 绿色，就打包完成了！

---

## 📥 第四步：下载打包好的软件

### 方式一：从 Actions 页面下载

1. 在 Actions 页面，点击已完成的工作流

2. 滚动到页面底部，找到 **Artifacts** 区域

3. 你会看到这些下载选项：
   - **AuroraBeat-Windows-Installer** - Windows 安装包 (.exe)
   - **AuroraBeat-Windows-Portable** - Windows 便携版 (.exe)
   - **AuroraBeat-Windows-Unpacked** - Windows 解压版（文件夹）
   - **AuroraBeat-macOS-DMG** - macOS 安装包 (.dmg)
   - **AuroraBeat-macOS-App** - macOS 应用 (.app)
   - **AuroraBeat-Linux-AppImage** - Linux AppImage
   - **AuroraBeat-Linux-DEB** - Linux DEB 包

4. 点击你需要的版本下载就行！

### 方式二：发布正式版本（Releases）

如果你想有一个正式的下载页面：

1. 在仓库页面点击右侧的 **Releases** → **Create a new release**

2. 或者更简单的方式——给代码打个标签，自动发布：

   在本地项目文件夹打开命令行：
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. 打标签后，GitHub 会自动打包并发布到 Releases 页面

---

## 🔄 以后更新软件

每次你修改了代码，上传到 GitHub 后：

1. 代码推送到 `main` 分支 → 自动打包，可以在 Actions 里下载
2. 打一个新标签（如 `v1.1.0`）→ 自动打包并发布到 Releases

---

## 💡 小技巧

### 1. 只打包你需要的平台

如果你只需要 Windows 版本，可以编辑 `.github/workflows/build.yml`，把 `build-macos` 和 `build-linux` 那两段删掉，这样更快。

### 2. 国内下载 GitHub 太慢？

可以用这些镜像网站加速下载：
- https://ghproxy.com/
- https://mirror.ghproxy.com/

使用方法：把下载链接复制到这些网站，就能加速下载。

### 3. 打包失败怎么办？

1. 进入 Actions 页面，点击失败的任务
2. 看看红色的错误信息是什么
3. 常见问题：
   - 网络超时 → 重新跑一次就行
   - 代码有错误 → 修复代码再上传

---

## 📋 总结

整个流程就是：
1. ✅ 注册 GitHub 账号
2. ✅ 上传代码
3. ✅ 等 5-10 分钟自动打包
4. ✅ 下载成品软件

**完全不需要在自己电脑上装 Node.js、Python 这些东西！** 🎉

有问题可以查看 GitHub Actions 文档：https://docs.github.com/zh/actions
