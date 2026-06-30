import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, dialog, shell } from 'electron'
import path from 'path'
import * as fs from 'fs'
import * as kugouHandler from './kugouHandler'
import { registerNeteaseHandlers } from './neteaseHandler'
import { loadAuthData, saveKugouAuth, saveNeteaseAuth, clearAuthData, getNeteaseCookie } from './authPersistence'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

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

  registerNeteaseHandlers()

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

ipcMain.handle('netease:openLoginWindow', async () => {
  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      parent: mainWindow || undefined,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      title: '网易云音乐登录',
    })
    loginWin.loadURL('https://music.163.com/#/login')
    loginWin.on('closed', () => resolve({ ok: false }))
    const checkLogin = async () => {
      try {
        if (loginWin.isDestroyed()) return
        const url = loginWin.webContents.getURL()
        if (url.includes('#/discover') || url.includes('#/my') || url.includes('music.163.com/#/')) {
          const cookies = await loginWin.webContents.session.cookies.get({ url: 'https://music.163.com' })
          const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
          const hasLoginCookie = cookies.some((c) => c.name === 'MUSIC_U' || c.name === '__csrf')
          if (hasLoginCookie) {
            saveNeteaseAuthFromCookie(cookieStr)
            loginWin.close()
            resolve({ ok: true })
          }
        }
      } catch (e) { /* ignore */ }
    }
    const interval = setInterval(() => {
      if (loginWin.isDestroyed()) { clearInterval(interval); return }
      checkLogin()
    }, 1000)
  })
})

async function saveNeteaseAuthFromCookie(cookieStr: string) {
  try {
    const neteaseApi = require('NeteaseCloudMusicApi')
    const result = await neteaseApi.login_status({ cookie: cookieStr })
    const profile = result?.body?.profile
    if (profile) {
      saveNeteaseAuth(String(profile.userId), profile.nickname, profile.avatarUrl, cookieStr)
      if (mainWindow) mainWindow.webContents.send('auth:restored', loadAuthData())
    }
  } catch (e) {
    console.warn('Failed to fetch netease user after login:', e)
  }
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

ipcMain.handle('netease:songUrl', async (_e, id: string) => {
  try {
    const neteaseApi = require('NeteaseCloudMusicApi')
    const cookie = getNeteaseCookie()
    let result = await neteaseApi.song_url_v1({ id, cookie })
    let data = result?.body?.data?.[0]
    if (!data?.url) {
      result = await neteaseApi.song_url({ id, cookie })
      data = result?.body?.data?.[0]
    }
    return { ok: !!data?.url, url: data?.url?.replace(/^http:/, 'https:') || '' }
  } catch (e) {
    console.error('Netease song URL error:', e)
    return { ok: false, url: '' }
  }
})

ipcMain.handle('netease:lyric', async (_e, id: string) => {
  try {
    const neteaseApi = require('NeteaseCloudMusicApi')
    const cookie = getNeteaseCookie()
    const result = await neteaseApi.lyric_new({ id, cookie })
    return { lrc: { lyric: result?.body?.lrc?.lyric || '' } }
  } catch (e) {
    return { lrc: { lyric: '' } }
  }
})
