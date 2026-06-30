import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, systemPreferences, net } from 'electron'
import path from 'path'
import * as kugouHandler from './kugouHandler'
import { registerNeteaseHandlers } from './neteaseHandler'
import { loadAuthData, saveKugouAuth, saveNeteaseAuth } from './authPersistence'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
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
  
  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

function registerGlobalShortcuts() {
  globalShortcut.register('MediaPlayPause', () => {
    mainWindow?.webContents.send('playback:toggle')
  })
  
  globalShortcut.register('MediaNextTrack', () => {
    mainWindow?.webContents.send('playback:next')
  })
  
  globalShortcut.register('MediaPreviousTrack', () => {
    mainWindow?.webContents.send('playback:prev')
  })
}

app.whenReady().then(async () => {
  createWindow()
  createTray()
  registerGlobalShortcuts()
  
  // KuGou API is now handled directly via IPC, no subprocess needed
  console.log('[KuGouAPI] Ready (direct IPC mode)')
  mainWindow?.webContents.send('kugou-api:ready')
  
  // Netease Cloud Music API
  registerNeteaseHandlers()
  console.log('[NeteaseAPI] Ready')
  
  // Load persisted auth data and send to renderer
  const authData = loadAuthData()
  if (authData.kugou || authData.netease) {
    mainWindow?.webContents.send('auth:restored', authData)
    console.log('[Auth] Restored auth data:', authData.kugou ? 'Kugou' : '', authData.netease ? 'Netease' : '')
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // No subprocess to kill
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
  return mainWindow?.isMaximized()
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized()
})

ipcMain.handle('app:getPath', (_e, name: string) => {
  return app.getPath(name as any)
})

// Lyrics search via ufanv.cn (scrapes the website)
ipcMain.handle('lyrics:searchUfanv', async (_e, query: string): Promise<string | null> => {
  try {
    // Step 1: Search for the song
    const searchUrl = `https://www.ufanv.cn/search?keyword=${encodeURIComponent(query)}`
    const searchReq = net.request(searchUrl)
    searchReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    
    const searchHtml = await new Promise<string>((resolve, reject) => {
      let data = ''
      searchReq.on('response', (response) => {
        response.on('data', (chunk) => { data += chunk.toString() })
        response.on('end', () => resolve(data))
        response.on('error', reject)
      })
      searchReq.on('error', reject)
      searchReq.end()
    })
    
    // Extract the first lyric page URL from search results
    const lyricMatch = searchHtml.match(/href="(\/lyric\/\d+)"/)
    if (!lyricMatch) return null
    
    // Step 2: Fetch the lyric page
    const lyricUrl = `https://www.ufanv.cn${lyricMatch[1]}`
    const lyricReq = net.request(lyricUrl)
    lyricReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    
    const lyricHtml = await new Promise<string>((resolve, reject) => {
      let data = ''
      lyricReq.on('response', (response) => {
        response.on('data', (chunk) => { data += chunk.toString() })
        response.on('end', () => resolve(data))
        response.on('error', reject)
      })
      lyricReq.on('error', reject)
      lyricReq.end()
    })
    
    // Extract LRC content - the lyrics are in a text block with timestamps
    // Format: [00:04.98]歌词1 [00:09.90]歌词2 ...
    // Look for the LRC section between "LRC 歌词" and "TXT 歌词" or similar markers
    const lrcSectionMatch = lyricHtml.match(/LRC\s*歌词([\s\S]*?)TXT\s*歌词/)
    if (lrcSectionMatch) {
      let rawText = lrcSectionMatch[1]
      // Remove HTML tags
      rawText = rawText.replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      rawText = rawText.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      // Split by timestamp pattern to put each line on its own line
      rawText = rawText.replace(/\[(\d+:\d+\.\d+)\]/g, '\n[$1]')
      // Clean up empty lines and whitespace
      rawText = rawText.split('\n').map(l => l.trim()).filter(l => l.startsWith('[')).join('\n')
      return rawText || null
    }
    
    // Fallback: try to find LRC data in the page
    const lrcDataMatch = lyricHtml.match(/"lrc"\s*:\s*"([^"]+)"/)
    if (lrcDataMatch) {
      let rawText = decodeURIComponent(lrcDataMatch[1].replace(/\\u[\da-fA-F]{4}/g, (m) => 
        String.fromCharCode(parseInt(m.slice(2), 16))
      ))
      rawText = rawText.replace(/\[(\d+:\d+\.\d+)\]/g, '\n[$1]')
      rawText = rawText.split('\n').map(l => l.trim()).filter(l => l.startsWith('[')).join('\n')
      return rawText || null
    }
    
    return null
  } catch (error) {
    console.error('ufanv.cn lyrics search failed:', error)
    return null
  }
})

// ============ KuGou Music API Handlers ============
// These handlers call KuGou API directly from Electron main process

ipcMain.handle('kg:search', async (_e, keyword: string, page = 1, pageSize = 30) => {
  return kugouHandler.kgSearch(keyword, page, pageSize)
})

ipcMain.handle('kg:searchHot', async () => {
  return kugouHandler.kgSearchHot()
})

ipcMain.handle('kg:searchDefault', async () => {
  return kugouHandler.kgSearchDefault()
})

ipcMain.handle('kg:songUrl', async (_e, hash: string, albumId?: string, albumAudioId?: string, uid?: string, token?: string) => {
  return kugouHandler.kgSongUrl(hash, albumId, albumAudioId, uid, token)
})

ipcMain.handle('kg:lyric', async (_e, hash: string, albumId?: string) => {
  return kugouHandler.kgLyric(hash, albumId)
})

ipcMain.handle('kg:searchLyric', async (_e, keyword: string, duration?: number, hash?: string) => {
  return kugouHandler.kgSearchLyric(keyword, duration, hash)
})

ipcMain.handle('kg:getLyricById', async (_e, id: string, accesskey: string) => {
  return kugouHandler.kgGetLyricById(id, accesskey)
})

ipcMain.handle('kg:qrKey', async () => {
  return kugouHandler.kgQrKey()
})

ipcMain.handle('kg:qrCreate', async (_e, key: string) => {
  return kugouHandler.kgQrCreate(key)
})

ipcMain.handle('kg:qrCheck', async (_e, key: string) => {
  return kugouHandler.kgQrCheck(key)
})

ipcMain.handle('kg:topSong', async () => {
  return kugouHandler.kgTopSong()
})

ipcMain.handle('kg:rankList', async () => {
  return kugouHandler.kgRankList()
})

ipcMain.handle('kg:rankAudio', async (_e, rankId: string, page = 1) => {
  return kugouHandler.kgRankAudio(rankId, page)
})

ipcMain.handle('kg:recommendSongs', async () => {
  return kugouHandler.kgRecommendSongs()
})

ipcMain.handle('kg:fmClass', async () => {
  return kugouHandler.kgFmClass()
})

ipcMain.handle('kg:fmRecommend', async (_e, classId: string) => {
  return kugouHandler.kgFmRecommend(classId)
})

ipcMain.handle('kg:fmSongs', async (_e, classId: string, songId?: string) => {
  return kugouHandler.kgFmSongs(classId, songId)
})

ipcMain.handle('kg:userDetail', async (_e, uid: string, token: string) => {
  return kugouHandler.kgUserDetail(uid, token)
})

ipcMain.handle('kg:userPlaylist', async (_e, uid: string, token: string, page = 1) => {
  return kugouHandler.kgUserPlaylist(uid, token, page)
})

ipcMain.handle('kg:playlistDetail', async (_e, id: string) => {
  return kugouHandler.kgPlaylistDetail(id)
})

ipcMain.handle('kg:playlistTrackAll', async (_e, id: string, page = 1) => {
  return kugouHandler.kgPlaylistTrackAll(id, page)
})

ipcMain.handle('kg:playlistTrackAllNew', async (_e, listId: string, page = 1, uid?: string, token?: string) => {
  return kugouHandler.kgPlaylistTrackAllNew(listId, page, uid, token)
})

ipcMain.handle('kg:artistDetail', async (_e, artistId: string) => {
  return kugouHandler.kgArtistDetail(artistId)
})

ipcMain.handle('kg:artistAudios', async (_e, artistId: string, page = 1) => {
  return kugouHandler.kgArtistAudios(artistId, page)
})

ipcMain.handle('kg:albumDetail', async (_e, albumId: string) => {
  return kugouHandler.kgAlbumDetail(albumId)
})

ipcMain.handle('kg:albumSongs', async (_e, albumId: string, page = 1) => {
  return kugouHandler.kgAlbumSongs(albumId, page)
})

ipcMain.handle('kg:banner', async () => {
  return kugouHandler.kgBanner()
})

ipcMain.handle('kg:sceneLists', async () => {
  return kugouHandler.kgSceneLists()
})

ipcMain.handle('kg:sceneAudioList', async (_e, sceneId: string, page = 1) => {
  return kugouHandler.kgSceneAudioList(sceneId, page)
})

ipcMain.handle('kg:diantai', async () => {
  return kugouHandler.kgDiantai()
})

ipcMain.handle('kg:commentMusic', async (_e, hash: string, page = 1) => {
  return kugouHandler.kgCommentMusic(hash, page)
})

ipcMain.handle('kg:songDetail', async (_e, hash: string) => {
  return kugouHandler.kgSongDetail(hash)
})

ipcMain.handle('kg:audioMv', async (_e, hash: string) => {
  return kugouHandler.kgAudioMv(hash)
})

ipcMain.handle('kg:videoUrl', async (_e, videoHash: string) => {
  return kugouHandler.kgVideoUrl(videoHash)
})

ipcMain.handle('kg:healthCheck', async () => {
  return kugouHandler.kgHealthCheck()
})

// ============ KuGou handlers for functions that were previously stubs ============
ipcMain.handle('kg:personalFm', async (_e, token: string) => {
  return kugouHandler.kgPersonalFm(token)
})
ipcMain.handle('kg:topAlbum', async () => {
  return kugouHandler.kgTopAlbum()
})
ipcMain.handle('kg:topPlaylist', async (_e, tag?: string, page = 1) => {
  return kugouHandler.kgTopPlaylist(tag, page)
})
ipcMain.handle('kg:everydayRecommend', async (_e, token: string) => {
  return kugouHandler.kgEverydayRecommend(token)
})
ipcMain.handle('kg:searchSuggest', async (_e, keyword: string) => {
  return kugouHandler.kgSearchSuggest(keyword)
})
ipcMain.handle('kg:searchComplex', async (_e, keyword: string, page = 1) => {
  return kugouHandler.kgSearchComplex(keyword, page)
})
ipcMain.handle('kg:songClimax', async (_e, hash: string) => {
  return kugouHandler.kgSongClimax(hash)
})

// ============ Auth Persistence ============
ipcMain.handle('auth:saveKugou', async (_e, uid: string, token: string, nickname: string) => {
  saveKugouAuth(uid, token, nickname)
  return true
})

ipcMain.handle('auth:saveNetease', async (_e, userId: string, nickname: string, avatarUrl: string) => {
  saveNeteaseAuth(userId, nickname, avatarUrl)
  return true
})
