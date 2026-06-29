import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, systemPreferences, net } from 'electron'
import path from 'path'

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

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerGlobalShortcuts()
  
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
    
    const searchHtml = await new Promise<string>((resolve, reject) => {
      let data = ''
      searchReq.on('response', (response) => {
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => resolve(data))
        response.on('error', reject)
      })
      searchReq.on('error', reject)
      searchReq.end()
    })
    
    // Extract the first lyric page URL from search results
    const lyricMatch = searchHtml.match(/href="\/lyric\/(\d+)"/)
    if (!lyricMatch) return null
    
    // Step 2: Fetch the lyric page
    const lyricUrl = `https://www.ufanv.cn/lyric/${lyricMatch[1]}`
    const lyricReq = net.request(lyricUrl)
    
    const lyricHtml = await new Promise<string>((resolve, reject) => {
      let data = ''
      lyricReq.on('response', (response) => {
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => resolve(data))
        response.on('error', reject)
      })
      lyricReq.on('error', reject)
      lyricReq.end()
    })
    
    // Extract LRC content from the page
    const lrcMatch = lyricHtml.match(/<div[^>]*class="[^"]*lrc-content[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    if (lrcMatch) {
      // Clean HTML tags and return
      return lrcMatch[1].replace(/<[^>]+>/g, '').trim()
    }
    
    // Try alternative: look for LRC format in script tags or data attributes
    const lrcDataMatch = lyricHtml.match(/"lrc"\s*:\s*"([^"]+)"/)
    if (lrcDataMatch) {
      return decodeURIComponent(lrcDataMatch[1].replace(/\\u[\da-fA-F]{4}/g, (m) => 
        String.fromCharCode(parseInt(m.slice(2), 16))
      ))
    }
    
    return null
  } catch (error) {
    console.error('ufanv.cn lyrics search failed:', error)
    return null
  }
})
