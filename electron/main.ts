import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, systemPreferences, net } from 'electron'
import path from 'path'
import * as kugouHandler from './kugouHandler'

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

ipcMain.handle('kg:songUrl', async (_e, hash: string, albumId?: string) => {
  return kugouHandler.kgSongUrl(hash, albumId)
})

ipcMain.handle('kg:lyric', async (_e, hash: string, albumId?: string) => {
  return kugouHandler.kgLyric(hash, albumId)
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

// ============ Stubs for KuGou channels not yet implemented in kugouHandler ============
// These return null so the UI can degrade gracefully instead of throwing
// "No handler registered" errors. Implement them in kugouHandler.ts when ready.
ipcMain.handle('kg:personalFm', async () => null)
ipcMain.handle('kg:topAlbum', async () => null)
ipcMain.handle('kg:topPlaylist', async () => null)
ipcMain.handle('kg:everydayRecommend', async () => null)
ipcMain.handle('kg:searchSuggest', async () => null)
ipcMain.handle('kg:searchComplex', async () => null)
ipcMain.handle('kg:songClimax', async () => null)
