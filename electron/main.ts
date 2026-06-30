import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, dialog, shell, session } from 'electron'
import path from 'path'
import * as fs from 'fs'
import * as kugouHandler from './kugouHandler'
import { registerNeteaseHandlers } from './neteaseHandler'
import { loadAuthData, saveKugouAuth, saveNeteaseAuth, clearAuthData } from './authPersistence'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const NETEASE_LOGIN_PARTITION = 'persist:aurorabeat-netease'
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 18 },
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webgl: true,
      experimentalFeatures: true,
      backgroundThrottling: false,
    },
    show: false,
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('focus', () => {
    mainWindow?.webContents.send('window:focus')
  })

  mainWindow.on('blur', () => {
    mainWindow?.webContents.send('window:blur')
  })
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../public/icon.png')
    const trayIcon = nativeImage.createFromPath(iconPath)
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    const contextMenu = Menu.buildFromTemplate([
      { label: '播放/暂停', click: () => mainWindow?.webContents.send('playback:toggle') },
      { label: '上一首', click: () => mainWindow?.webContents.send('playback:prev') },
      { label: '下一首', click: () => mainWindow?.webContents.send('playback:next') },
      { type: 'separator' },
      { label: '显示窗口', click: () => mainWindow?.show() },
      { label: '退出', click: () => app.quit() },
    ])
    tray.setToolTip('AuroraBeat')
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => mainWindow?.show())
  } catch (e) {
    console.warn('Tray creation failed:', e)
  }
}

function registerGlobalShortcuts() {
  try {
    globalShortcut.register('MediaPlayPause', () => mainWindow?.webContents.send('playback:toggle'))
    globalShortcut.register('MediaNextTrack', () => mainWindow?.webContents.send('playback:next'))
    globalShortcut.register('MediaPreviousTrack', () => mainWindow?.webContents.send('playback:prev'))
  } catch (e) {
    console.warn('Global shortcuts registration failed:', e)
  }
}

app.whenReady().then(async () => {
  createWindow()
  createTray()
  registerGlobalShortcuts()

  await registerNeteaseHandlers()

  const authData = loadAuthData()
  if (authData.kugou || authData.netease) {
    mainWindow?.webContents.send('auth:restored', authData)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
  return mainWindow?.isMaximized()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())
ipcMain.handle('app:getPath', (_e, name: string) => app.getPath(name as any))

ipcMain.handle('dialog:selectLocalFiles', async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled) return []
  return result.filePaths.map((filePath) => {
    const stat = fs.statSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const basename = path.basename(filePath, ext)
    const parts = basename.split(' - ')
    let title = basename
    let artist = '未知艺术家'
    if (parts.length >= 2) {
      artist = parts[0].trim()
      title = parts.slice(1).join(' - ').trim()
    }
    return {
      id: 'local-' + Buffer.from(filePath).toString('base64').slice(0, 20),
      name: title,
      title,
      artist,
      album: '本地音乐',
      cover: '',
      duration: 0,
      url: 'file://' + filePath,
      path: filePath,
      source: 'local' as const,
      size: stat.size,
    }
  })
})

ipcMain.handle('file:readAsBlob', async (_e, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath.replace(/^file:\/\//, ''))
    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
    }
    const mime = mimeTypes[ext] || 'audio/mpeg'
    const blob = new Blob([data], { type: mime })
    return URL.createObjectURL(blob)
  } catch (e) {
    console.error('Failed to read local file:', e)
    return null
  }
})

async function searchLyricsUfanv(title: string, artist: string): Promise<string | null> {
  try {
    const query = `${artist} ${title}`
    const searchUrl = `https://www.ufanv.cn/search?keyword=${encodeURIComponent(query)}`
    const { net } = require('electron')
    const searchHtml = await new Promise<string>((resolve, reject) => {
      let data = ''
      const req = net.request(searchUrl)
      req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
      req.on('response', (response: any) => {
        response.on('data', (chunk: Buffer) => { data += chunk.toString() })
        response.on('end', () => resolve(data))
        response.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    })
    const lyricMatch = searchHtml.match(/href="(\/lyric\/\d+)"/)
    if (!lyricMatch) return null
    const lyricUrl = `https://www.ufanv.cn${lyricMatch[1]}`
    const lyricHtml = await new Promise<string>((resolve, reject) => {
      let data = ''
      const req = net.request(lyricUrl)
      req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
      req.on('response', (response: any) => {
        response.on('data', (chunk: Buffer) => { data += chunk.toString() })
        response.on('end', () => resolve(data))
        response.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    })
    const lrcSectionMatch = lyricHtml.match(/LRC\s*歌词([\s\S]*?)TXT\s*歌词/)
    if (lrcSectionMatch) {
      let rawText = lrcSectionMatch[1].replace(/<[^>]+>/g, ' ')
      rawText = rawText.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      rawText = rawText.replace(/\[(\d+:\d+\.\d+)\]/g, '\n[$1]')
      return rawText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.startsWith('[')).join('\n') || null
    }
    return null
  } catch (e) {
    console.warn('ufanv lyrics search failed:', e)
    return null
  }
}

ipcMain.handle('lyrics:search', async (_e, title: string, artist: string) => {
  const lrc = await searchLyricsUfanv(title, artist)
  return { lyric: lrc || '' }
})

ipcMain.handle('kg:search', async (_e, keyword: string, page = 1, pageSize = 30) => {
  const result = await kugouHandler.kgSearch(keyword, page, pageSize)
  return result
})

ipcMain.handle('kg:songUrl', async (_e, hash: string, albumId?: string) => {
  const result = await kugouHandler.kgSongUrl(hash, albumId)
  return { url: result.play_url || result?.data?.play_url || '' }
})

ipcMain.handle('kg:lyric', async (_e, hash: string, albumId?: string) => {
  try {
    const result = await kugouHandler.kgLyric(hash, albumId)
    return { lyric: result?.content || result?.lyric || '' }
  } catch (e) {
    console.warn('Kg lyric fetch failed:', e)
    return { lyric: '' }
  }
})

ipcMain.handle('kg:playlistTrackAllNew', async (_e, listId: string, page = 1, _uid?: string, _token?: string, pageSize = 500) => {
  return kugouHandler.kgPlaylistTrackAllNew(listId, page, undefined, undefined, pageSize)
})

ipcMain.handle('kg:rankList', async () => kugouHandler.kgRankList())
ipcMain.handle('kg:rankAudio', async (_e, rankId: string, page = 1) => kugouHandler.kgRankAudio(rankId, page))
ipcMain.handle('kg:recommendSongs', async () => kugouHandler.kgRecommendSongs())
ipcMain.handle('kg:userPlaylist', async (_e, uid: string, token: string, page = 1) => kugouHandler.kgUserPlaylist(uid, token, page))
ipcMain.handle('kg:qrKey', async () => kugouHandler.kgQrKey())
ipcMain.handle('kg:qrCreate', async (_e, key: string) => kugouHandler.kgQrCreate(key))
ipcMain.handle('kg:qrCheck', async (_e, key: string) => kugouHandler.kgQrCheck(key))
ipcMain.handle('kg:loginStatus', async () => {
  const auth = loadAuthData()
  return { loggedIn: !!auth.kugou, user: auth.kugou || null }
})

// ============ Netease Login (Mineradio-style: persistent session + cookie polling) ============

function neteaseCookieHasLogin(cookieText: string): boolean {
  const parts = cookieText.split(';')
  for (const p of parts) {
    const [name, value] = p.trim().split('=')
    if (name === 'MUSIC_U' && value) return true
  }
  return false
}

async function readNeteaseLoginCookie(cookieSession: Electron.Session): Promise<string> {
  const cookies = await cookieSession.cookies.get({})
  return cookies
    .filter((c) => {
      const d = (c.domain || '').replace(/^\./, '').toLowerCase()
      return d === '163.com' || d.endsWith('.163.com') || d === 'music.163.com' || d.endsWith('.music.163.com')
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

async function openNeteaseLoginWindow(owner: BrowserWindow | null): Promise<{ ok: boolean; cookie?: string; reused?: boolean; cancelled?: boolean }> {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  const initialCookie = await readNeteaseLoginCookie(cookieSession)
  if (neteaseCookieHasLogin(initialCookie)) {
    return { ok: true, cookie: initialCookie, reused: true }
  }

  return new Promise((resolve) => {
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      parent: owner || undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '网易云音乐登录',
      backgroundColor: '#111111',
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    const finish = async (result: { ok: boolean; cookie?: string; reused?: boolean; cancelled?: boolean }) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
      resolve(result)
    }

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookie(cookieSession)
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie })
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e)
      }
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
      // Auto-click login button to bring up options
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
        const cookie = await readNeteaseLoginCookie(cookieSession)
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true })
      } catch (e) {
        resolve({ ok: false, cancelled: true })
      }
    })

    pollTimer = setInterval(checkCookies, 1200)
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false }))
  })
}

async function clearNeteaseLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  })
  return { ok: true }
}

ipcMain.handle('netease:openLoginWindow', async () => {
  return openNeteaseLoginWindow(mainWindow)
})

ipcMain.handle('netease:clearLogin', async () => {
  return clearNeteaseLoginSession()
})

// Sync login cookie to authPersistence whenever we get a fresh login
async function syncNeteaseCookieToAuth() {
  try {
    const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION)
    const cookie = await readNeteaseLoginCookie(cookieSession)
    if (neteaseCookieHasLogin(cookie)) {
      saveNeteaseAuth('', '网易云用户', '', cookie)
      return true
    }
  } catch { /* ignore */ }
  return false
}

ipcMain.handle('auth:saveKugou', async (_e, uid: string, token: string, nickname: string, avatar?: string) => {
  saveKugouAuth(uid, token, nickname, avatar)
  return true
})

ipcMain.handle('auth:saveNetease', async (_e, userId: string, nickname: string, avatarUrl: string, cookie: string) => {
  saveNeteaseAuth(userId, nickname, avatarUrl, cookie)
  return true
})

ipcMain.handle('auth:get', async () => loadAuthData())
ipcMain.handle('auth:clear', async (_e, provider?: string) => { clearAuthData(provider); return true })
