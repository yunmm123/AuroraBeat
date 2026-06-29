import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, systemPreferences, net } from 'electron'
import path from 'path'
import { fork } from 'child_process'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let kugouApiProcess: ReturnType<typeof fork> | null = null
const KUGOU_API_PORT = 13456

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

// Start KuGouMusic API subprocess
function startKugouApi() {
  const apiDir = path.join(__dirname, '../kugou-api')
  kugouApiProcess = fork(path.join(apiDir, 'app.js'), [], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(KUGOU_API_PORT),
      HOST: '127.0.0.1',
      platform: 'lite',
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })

  kugouApiProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[KuGouAPI]', data.toString().trim())
  })

  kugouApiProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[KuGouAPI]', data.toString().trim())
  })

  kugouApiProcess.on('exit', (code) => {
    console.log(`[KuGouAPI] exited with code ${code}`)
    kugouApiProcess = null
  })

  // Wait for API to be ready
  const waitForApi = () => {
    return new Promise<void>((resolve) => {
      const check = () => {
        const req = net.request(`http://127.0.0.1:${KUGOU_API_PORT}/`)
        req.on('response', () => resolve())
        req.on('error', () => setTimeout(check, 500))
        req.end()
      }
      check()
    })
  }
  return waitForApi()
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
  
  // Start KuGouMusic API in background
  try {
    await startKugouApi()
    console.log(`[KuGouAPI] Ready on port ${KUGOU_API_PORT}`)
    mainWindow?.webContents.send('kugou-api:ready')
  } catch (error) {
    console.error('[KuGouAPI] Failed to start:', error)
    mainWindow?.webContents.send('kugou-api:error', String(error))
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
  // Kill KuGou API subprocess
  if (kugouApiProcess) {
    kugouApiProcess.kill()
    kugouApiProcess = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (kugouApiProcess) {
    kugouApiProcess.kill()
    kugouApiProcess = null
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
