import { app, BrowserWindow, ipcMain, shell, session, globalShortcut, dialog, screen } from 'electron'
import path from 'path'
import { spawn } from 'child_process'

let mainWindow: BrowserWindow | null = null
let serverProcess: ReturnType<typeof spawn> | null = null
let serverPort = 0

const NETEASE_LOGIN_PARTITION = 'persist:aurorabeat-netease'
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login'

// ========== 启动本地HTTP服务器 ==========
// 打包后用户系统无独立 node 可执行文件，用 Electron 自身
// (process.execPath) + ELECTRON_RUN_AS_NODE=1 以纯 Node 模式运行 server.js
function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, '..', 'server.js')
    const isPackaged = app.isPackaged
    // 打包后无独立 node，用 Electron 自身以纯 Node 模式运行 server.js
    const exec = isPackaged ? process.execPath : 'node'
    serverProcess = spawn(exec, [serverPath], {
      env: {
        ...process.env,
        // 让 Electron 以纯 Node.js 进程运行（无 GUI），用于执行 server.js
        ELECTRON_RUN_AS_NODE: isPackaged ? '1' : '',
        AURORA_PORT: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    serverProcess.on('error', (err: Error) => {
      console.error('[Server] spawn error:', err.message)
      if (!serverPort) { serverPort = 3000; resolve(serverPort) }
    })
    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[Server]', text.trim())
      const match = text.match(/port\s+(\d+)/)
      if (match && !serverPort) {
        serverPort = parseInt(match[1])
        resolve(serverPort)
      }
    })
    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Server Error]', data.toString().trim())
    })
    // 兜底：5秒后用默认端口
    setTimeout(() => { if (!serverPort) { serverPort = 3000; resolve(serverPort) } }, 5000)
  })
}

// ========== Cookie 工具（Mineradio同款）==========
function isNeteaseCookieDomain(domain: string): boolean {
  const d = (domain || '').replace(/^\./, '').toLowerCase()
  return d === '163.com' || d.endsWith('.163.com') || d === 'music.163.com' || d.endsWith('.music.163.com') || d === 'netease.com' || d.endsWith('.netease.com')
}

const NETEASE_COOKIE_PRIORITY = ['MUSIC_U', '__csrf', 'NMTID', 'MUSIC_A', '__remember_me', '_ntes_nuid', '_ntes_nnid', 'WEVNSM', 'WNMCID', 'JSESSIONID-WYYY']

function buildCookieHeader(cookies: any[]): string {
  const picked = new Map<string, string>()
  ;(cookies || []).forEach((cookie) => {
    if (!cookie?.name || !isNeteaseCookieDomain(cookie.domain)) return
    picked.set(cookie.name, cookie.value || '')
  })
  const ordered: [string, string][] = []
  NETEASE_COOKIE_PRIORITY.forEach((name) => {
    if (picked.has(name)) { ordered.push([name, picked.get(name)!]); picked.delete(name) }
  })
  picked.forEach((value, name) => ordered.push([name, value]))
  return ordered.filter(([name, value]) => name && value).map(([name, value]) => `${name}=${value}`).join('; ')
}

async function readNeteaseCookie(session: Electron.Session): Promise<string> {
  const cookies = await session.cookies.get({})
  return buildCookieHeader(cookies)
}

function neteaseCookieHasLogin(cookieText: string): boolean {
  return cookieText.includes('MUSIC_U=')
}

// ========== 登录窗口（完全对标 Mineradio）==========
async function openNeteaseLoginWindow(owner: BrowserWindow | null): Promise<{ ok: boolean; cookie?: string; reused?: boolean }> {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  const initialCookie = await readNeteaseCookie(cookieSession)
  if (neteaseCookieHasLogin(initialCookie)) {
    return { ok: true, cookie: initialCookie, reused: true }
  }

  return new Promise((resolve) => {
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const loginWindow = new BrowserWindow({
      width: 940, height: 760, minWidth: 780, minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false, show: false, autoHideMenuBar: true,
      title: '网易云音乐登录', backgroundColor: '#111111',
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    })

    const finish = (result: any) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
      resolve(result)
    }

    const checkCookies = async () => {
      try {
        if (loginWindow.isDestroyed()) return
        const cookie = await readNeteaseCookie(cookieSession)
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie })
        }
      } catch (e) { console.warn('Cookie check failed:', e) }
    }

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch(() => {})
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {})
      }
      return { action: 'deny' }
    })

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies()
      // 自动点击登录按钮
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|立即登录/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 900);
      `, true).catch(() => {})
    })

    loginWindow.on('ready-to-show', () => loginWindow.show())

    loginWindow.on('closed', async () => {
      if (settled) return
      if (pollTimer) clearInterval(pollTimer)
      try {
        const cookie = await readNeteaseCookie(cookieSession)
        resolve(neteaseCookieHasLogin(cookie) ? { ok: true, cookie } : { ok: false })
      } catch { resolve({ ok: false }) }
    })

    pollTimer = setInterval(checkCookies, 1200)
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch(() => finish({ ok: false }))
  })
}

async function clearNeteaseLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  await cookieSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] })
  return { ok: true }
}

// ========== 创建主窗口 ==========
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    frame: false, show: false, autoHideMenuBar: true,
    backgroundColor: '#08090B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 无边框窗口最大化时覆盖整个屏幕（含任务栏区域），避免底部任务栏露出
  mainWindow.on('maximize', () => {
    if (!mainWindow) return
    const display = screen.getDisplayMatching(mainWindow.getBounds())
    mainWindow.setBounds(display.bounds)
  })

  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ========== App 生命周期 ==========
app.whenReady().then(async () => {
  // 启动本地服务器
  serverPort = await startServer()
  console.log('[Main] Server port:', serverPort)

  createMainWindow()

  // IPC
  ipcMain.handle('get-server-port', () => serverPort)
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => { mainWindow?.close() })

  ipcMain.handle('netease:openLogin', async () => {
    const result = await openNeteaseLoginWindow(mainWindow)
    if (result.ok && result.cookie && serverPort) {
      // 把cookie发送给本地服务器保存
      try {
        await fetch(`http://127.0.0.1:${serverPort}/api/login/cookie`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookie: result.cookie }),
        })
      } catch (e) { console.warn('Failed to send cookie to server:', e) }
    }
    return result
  })

  ipcMain.handle('netease:clearLogin', async () => {
    await clearNeteaseLoginSession()
    if (serverPort) {
      try { await fetch(`http://127.0.0.1:${serverPort}/api/logout`) } catch {}
    }
    return { ok: true }
  })

  // 本地文件选择
  ipcMain.handle('dialog:selectLocalFiles', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const fs = await import('fs')
    return Promise.all(result.filePaths.map(async (filePath) => {
      const stats = fs.statSync(filePath)
      const name = path.basename(filePath, path.extname(filePath))
      return {
        id: `local-${filePath}`,
        title: name,
        name,
        artist: '本地音乐',
        album: '',
        cover: '',
        duration: 0,
        url: `file://${filePath}`,
        source: 'local' as const,
        path: filePath,
        size: stats.size,
      }
    }))
  })

  // 图片选择（自定义背景）
  ipcMain.handle('dialog:selectImageFile', async () => {
    if (!mainWindow) return { path: '' }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { path: '' }
    const filePath = result.filePaths[0]
    const fs = await import('fs')
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mimeMap: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp' }
    const mime = mimeMap[ext] || 'jpeg'
    return { path: `data:image/${mime};base64,${buffer.toString('base64')}` }
  })

  // 视频选择（自定义背景视频，通过本地服务器流式播放）
  ipcMain.handle('dialog:selectVideoFile', async () => {
    if (!mainWindow) return { url: '', path: '' }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { url: '', path: '' }
    const filePath = result.filePaths[0]
    const streamUrl = serverPort
      ? `http://127.0.0.1:${serverPort}/api/local-video?path=${encodeURIComponent(filePath)}`
      : ''
    return { url: streamUrl, path: filePath }
  })

  // 读取本地文件为Blob URL
  ipcMain.handle('file:readAsBlob', async (_e, filePath: string) => {
    try {
      const cleanPath = filePath.replace(/^file:\/\//, '')
      const fs = await import('fs')
      const buffer = fs.readFileSync(cleanPath)
      const base64 = buffer.toString('base64')
      const ext = path.extname(cleanPath).slice(1).toLowerCase()
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
      }
      const mime = mimeMap[ext] || 'audio/mpeg'
      return `data:${mime};base64,${base64}`
    } catch (e) {
      console.error('Read file error:', e)
      return null
    }
  })

  // 搜索歌词（本地音乐用）
  ipcMain.handle('lyrics:search', async (_e, title: string, artist: string) => {
    if (!serverPort) return { lyric: '' }
    try {
      // 用网易云搜索找到歌曲ID，再获取歌词
      const searchRes = await fetch(`http://127.0.0.1:${serverPort}/api/search?keywords=${encodeURIComponent(`${title} ${artist}`)}&limit=1`)
      const searchData = await searchRes.json()
      const songId = searchData?.songs?.[0]?.id
      if (!songId) return { lyric: '' }
      const lyricRes = await fetch(`http://127.0.0.1:${serverPort}/api/lyric?id=${songId}`)
      const lyricData = await lyricRes.json()
      return { lyric: lyricData?.lyric || '' }
    } catch {
      return { lyric: '' }
    }
  })

  // 全局快捷键
  const togglePlay = () => mainWindow?.webContents.send('playback:toggle')
  const nextTrack = () => mainWindow?.webContents.send('playback:next')
  const prevTrack = () => mainWindow?.webContents.send('playback:prev')
  globalShortcut.register('MediaPlayPause', togglePlay)
  globalShortcut.register('MediaNextTrack', nextTrack)
  globalShortcut.register('MediaPreviousTrack', prevTrack)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null }
})