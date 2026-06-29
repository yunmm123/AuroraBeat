# AuroraBeat - 沉浸式高端音乐播放器

一款面向 PC 端的高端音乐播放软件，基于实时音频分析的智能视觉引擎，将音乐转化为令人惊叹的视觉盛宴。

## 技术栈

- **前端框架**: Electron + React 18 + TypeScript
- **渲染引擎**: Three.js + WebGL 2.0 + GLSL Shaders
- **音频处理**: Web Audio API + 2048 点 FFT 频谱分析
- **UI 框架**: Tailwind CSS + Framer Motion
- **状态管理**: Zustand
- **图标**: Lucide React

## 核心功能

### 🎵 音乐节奏自适应视觉系统

**音频特征提取（每帧实时分析）**:
- BPM 检测与节拍点追踪
- 低频能量（鼓点、贝斯）驱动粒子爆发
- 中频能量（人声、旋律）驱动形态变化
- 高频能量（镲片、高音）驱动光晕闪烁
- 音乐情绪识别（激昂/舒缓/电子/古典等）

**高端视觉效果库**:
- ✨ **星河粒子** - 数万个粒子在 3D 空间中随音乐流动
- 🌊 **流体光影** - 基于 Shader 的流体动力学模拟
- 💎 **几何律动** - 3D 几何结构随音乐变形
- 📊 **波形可视化** - 3D 空间中的波形曲面
- 🌌 **频谱星云** - 频谱数据映射为星云密度

**后处理效果**:
- Bloom 泛光效果
- 色差（Chromatic Aberration）
- 可调节渲染质量

### 🎨 UI/UX 设计

- 暗黑模式为主，毛玻璃 + 半透明面板设计
- 全屏视觉效果作为背景，UI 悬浮其上
- 支持 6 套高端配色主题（暗夜紫、深海蓝、熔岩橙、极光绿、赛博朋克、极简白）
- 流畅的动画过渡（Framer Motion）
- 自定义滚动条、进度条、滑块

### 🎧 播放功能

- 多种播放模式（顺序、随机、单曲循环、列表循环）
- 10 段专业均衡器，预设多种风格
- 低音增强、3D 环绕音效
- 音量控制、播放速度调节
- 播放队列管理

### 📝 歌词系统

- 悬浮歌词面板
- 全屏歌词模式（带渐变和发光效果）
- 逐行动画过渡

### 🔗 酷狗音乐集成

- OAuth 2.0 登录（扫码/账号密码）
- 同步用户歌单、收藏、播放历史
- 在线搜索酷狗音乐库
- Token 安全存储与自动刷新
- 错误处理与重试机制

## 项目结构

```
/workspace
├── electron/              # Electron 主进程
│   ├── main.ts           # 主进程入口
│   └── preload.ts        # 预加载脚本
├── src/
│   ├── components/       # React 组件
│   │   ├── TitleBar.tsx
│   │   ├── PlaylistSidebar.tsx
│   │   ├── PlayControlBar.tsx
│   │   ├── LyricsPanel.tsx
│   │   ├── QueuePanel.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── VisualEffectSelector.tsx
│   ├── visuals/          # 视觉引擎
│   │   └── VisualEngine.ts
│   ├── shaders/          # GLSL Shaders
│   │   ├── particleShaders.ts
│   │   ├── fluidShaders.ts
│   │   ├── geometryShaders.ts
│   │   ├── nebulaShaders.ts
│   │   └── waveformShaders.ts
│   ├── audio/            # 音频处理
│   │   └── AudioAnalyzer.ts
│   ├── store/            # 状态管理
│   │   └── playerStore.ts
│   ├── services/         # 服务层
│   │   └── kugouService.ts
│   ├── utils/            # 工具函数
│   │   └── themes.ts
│   ├── types/            # TypeScript 类型
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

## 快速开始

### 安装依赖

```bash
# 国内用户推荐使用淘宝镜像加速
npm install --registry=https://registry.npmmirror.com
```

> 注意：如果 Electron 下载失败，可以设置国内镜像：
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
# Web 版本（推荐用于开发和调试视觉效果）
npm run dev

# Electron 桌面版本
npm run dev:electron
```

### 打包成桌面软件

详细的打包说明请查看 [打包说明.md](./打包说明.md)

**快速打包命令：**

```bash
# 打包 Windows 版本
npm run build:win

# 打包 macOS 版本
npm run build:mac

# 打包当前系统版本
npm run build
```

打包完成后，安装包会生成在 `release/` 文件夹中。

**Windows 打包脚本：** 双击 `build-windows.bat` 即可
**macOS 打包脚本：** 运行 `./build-mac.sh`

## 系统要求

- **GPU**: NVIDIA RTX 5060 或更高（推荐）
- **内存**: 4GB 以上
- **操作系统**: Windows 10+ / macOS 11+
- **存储空间**: 500MB 以上

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Space | 播放/暂停 |
| ← / → | 上一首/下一首 |
| ↑ / ↓ | 音量增减 |
| M | 静音 |
| L | 歌词 |
| Esc | 关闭面板 |

## 许可证

MIT License
