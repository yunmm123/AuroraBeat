# AuroraBeat - 沉浸式高端音乐播放器

一款面向 PC 端的沉浸式音乐播放软件，基于实时音频分析的智能视觉引擎，将音乐转化为令人惊叹的视觉盛宴。基于本地 HTTP 服务器架构对接网易云音乐，支持登录同步喜欢列表、每日推荐、歌单管理。

当前版本：**v3.3.4**

## 技术栈

- **前端框架**: Electron 29 + React 18 + TypeScript
- **渲染引擎**: Three.js + WebGL 2.0 + GLSL Shaders
- **音频处理**: Web Audio API + 2048 点 FFT 频谱分析
- **节拍系统**: 双 AnalyserNode 架构（离线预分析 + 实时 fallback）
- **动画引擎**: GSAP + Framer Motion
- **UI 框架**: Tailwind CSS
- **状态管理**: Zustand
- **音乐数据源**: NeteaseCloudMusicApi（本地服务器代理）

## 核心功能

### 🎨 封面驱动的 6 色调色板视觉系统

对封面图像做 K-Means 聚类，按亮度分 6 层提取主色，分配给不同视觉元素，主界面能大致通过颜色看清封面：

| 层级 | 亮度范围 | 用途 |
|------|----------|------|
| shadow | [0, 0.16) | 背景底色 |
| midDark | [0.16, 0.34) | 拖尾尾部 |
| tint | [0.34, 0.52) | 节拍冲击波 |
| accent | [0.52, 0.70) | 频谱环 / 拖尾头部 |
| midLight | [0.70, 0.85) | 节拍绽放光晕 / 粒子 |
| highlight | [0.85, 1.0] | 远景星尘 / 粒子高光 |

### 🌊 沉浸式视觉特效（Three.js Shader）

- **频谱环** - 中心圆环随频谱实时跳动，封面 accent 色驱动
- **节拍冲击波** - 4 层从中心扩散的环形波纹，tint 色，节拍触发
- **节拍绽放光晕** - 频谱环外层 6 瓣花瓣光晕，midLight 色，随节奏呼吸
- **封面粒子拖尾** - 20 条围绕中心旋转的粒子拖尾，accent 色头部 + midDark 色尾部
- **远景星尘** - 网格分布的闪烁星点，midLight → highlight 渐变
- **鼠标光斑** - 跟随鼠标的三层柔光（静止时隐藏，移动时显现）
- **背景底色** - 封面 shadow 色作为全屏底色

### 🎵 节拍系统

- **离线预分析**：fetch + decodeAudioData + lowpass(150Hz) + 峰值检测，得出 BPM 和节拍时间戳数组
- **实时 fallback**：离线分析失败时用 lowpass 时域 RMS 检测底鼓
- **双 AnalyserNode 架构**：可视化频谱（smoothing 0.58）+ 节拍检测（smoothing 0）分离，避免瞬态被抹平
- 节拍触发：粒子亮度脉冲、冲击波生成、场域能量释放、歌词切换微脉冲

### 🎧 播放功能

- 网易云音乐登录（独立登录窗口，Cookie 持久化）
- 多种播放模式（顺序、随机、单曲循环）
- 4 档音质（standard / exhigh / lossless / hires），自动降级
- 播放队列管理
- 本地音乐文件支持（mp3 / flac / wav / ogg / m4a / aac）
- 红心收藏同步网易云（点红心/取消红心实时同步，乐观更新 + 延迟验证）

### 📝 歌词系统

- 始终居中显示当前行（以圆环中心为基准）
- 宽度以视口短边为基准，长歌词换行也被圆环包围
- 封面色到白色的柔和渐变填充（tint 30% → tint 10% 明度差 20% 以内）
- 节拍辉光随 BPM 呼吸
- 网易云歌词自动获取（含翻译、逐字 yrc）

### 🖥️ 沉浸式界面

- 无边框全屏（最大化时覆盖任务栏）
- 毛玻璃 + 半透明面板设计
- 鼠标手势控制（音量、进度）
- 沉浸式控制提示

## 项目结构

```
/workspace
├── electron/              # Electron 主进程
│   ├── main.ts           # 主进程入口（窗口管理、IPC、网易云登录窗口、server.js 启动）
│   └── preload.ts        # 预加载脚本（IPC 桥接）
├── src/
│   ├── core/             # 核心逻辑
│   │   ├── playerCore.ts # 播放器核心（播放、节拍派发、红心同步）
│   │   ├── beatAnalyzer.ts # 离线节拍分析
│   │   └── beatDetector.ts # 实时节拍检测 fallback
│   ├── hooks/            # React Hooks
│   │   ├── usePlayer.ts  # 播放器状态 hook
│   │   └── useSpectrum.ts # 频谱可视化（6 色渐变）
│   ├── shaders/          # GLSL Shaders（参考用，主 shader 在 App.tsx 内）
│   ├── types/            # TypeScript 类型
│   ├── utils/
│   │   └── audioDB.ts    # 音频缓存
│   ├── App.tsx           # 主界面 + 视觉引擎（6 色 uniforms + 全部 shader）
│   ├── index.css         # 全局样式（歌词、频谱、玻璃面板）
│   └── main.tsx          # React 入口
├── server.js             # 本地 HTTP 服务器（网易云 API 代理）
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## 架构说明

### 本地 HTTP 服务器架构

对标 Mineradio 架构，所有网易云 API 调用通过本地 HTTP 服务器中转：

```
渲染进程 (React)
    ↓ fetch http://127.0.0.1:{port}/api/...
Electron 主进程
    ↓ spawn
server.js (独立 Node 进程)
    ↓ 调用
NeteaseCloudMusicApi
    ↓ HTTPS
网易云音乐服务器
```

- **开发模式**：用系统 `node` 运行源码 server.js（重启 electron 即更新）
- **打包模式**：用 Electron 自身以纯 Node 模式运行（`ELECTRON_RUN_AS_NODE=1`），无需用户安装 Node

### 红心同步流程

1. 用户点击红心 → 乐观更新本地 Set + notify（UI 立即响应）
2. 异步 fire-and-forget 调用 `/api/song/like`（不阻塞 UI，失败不回退）
3. server.js 调用 NeteaseCloudMusicApi 的 `like` 函数（注意：`like` 参数需传字符串 `"true"/"false"`，库内部用 `== 'false'` 字符串比较）
4. 取消红心后 3 秒延迟验证：查 likelist 确认网易是否真取消，不一致则强制同步真实状态

## 快速开始

### 安装依赖

```bash
# 国内用户推荐使用淘宝镜像加速
npm install --registry=https://registry.npmmirror.com
```

> 如果 Electron 下载失败，设置国内镜像：
> ```bash
> # Windows
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> npm install
> 
> # macOS / Linux
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

### 开发模式

```bash
# Electron 桌面版（开发）
npm run electron:dev
```

### 打包成桌面软件

```bash
# 打包 Windows 版本（生成 nsis 安装包 + portable 便携版）
npm run build:win

# 打包 macOS 版本
npm run build:mac

# 仅打包当前系统解压版（最快，不生成安装程序）
npm run build:dir
```

打包完成后，安装包会生成在 `release/` 文件夹中：
- `AuroraBeat Setup {version}.exe` - NSIS 安装包
- `Aurorabeat {version}.exe` - 便携版（免安装）
- `win-unpacked/AuroraBeat.exe` - 解压版（`build:dir` 产物）

## 系统要求

- **GPU**: 支持 WebGL 2.0 的显卡（集成显卡即可，推荐独显获得更流畅的粒子效果）
- **内存**: 4GB 以上
- **操作系统**: Windows 10+ / macOS 11+
- **存储空间**: 500MB 以上

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Space | 播放 / 暂停 |
| ← / → | 快退 / 快进 5 秒 |
| Shift + ← / → | 上一首 / 下一首 |
| ↑ / ↓ | 音量增减 |
| M | 静音切换 |
| L | 红心收藏 / 取消 |
| F | FX 面板切换 |
| MediaPlayPause / MediaNextTrack / MediaPreviousTrack | 媒体键控制 |

## 版本号规则

采用语义化版本，patch 仅 1-9，每 10 个小版本进位到 minor：

```
3.1.1 → 3.1.2 → ... → 3.1.9 → 3.2.0 → 3.2.1 → ... → 3.2.9 → 3.3.0
```

## 许可证

MIT License
