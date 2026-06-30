// ====================================================================
// Auth Persistence - saves login info with 7-day expiration
// Data is stored in userData directory which is cleared on uninstall
// ====================================================================
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

interface AuthData {
  kugou?: {
    uid: string
    token: string
    nickname: string
    savedAt: number
  }
  netease?: {
    userId: string
    nickname: string
    avatarUrl: string
    savedAt: number
  }
}

const AUTH_FILE = 'auth-data.json'
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function getAuthFilePath(): string {
  return path.join(app.getPath('userData'), AUTH_FILE)
}

export function loadAuthData(): AuthData {
  try {
    const filePath = getAuthFilePath()
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data: AuthData = JSON.parse(raw)
    const now = Date.now()
    
    // Check expiration for each entry
    if (data.kugou && (now - data.kugou.savedAt) > EXPIRATION_MS) {
      delete data.kugou
    }
    if (data.netease && (now - data.netease.savedAt) > EXPIRATION_MS) {
      delete data.netease
    }
    
    // If data was modified (expired entries removed), save it back
    if (!data.kugou && !data.netease) {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
    
    return data
  } catch {
    return {}
  }
}

export function saveKugouAuth(uid: string, token: string, nickname: string) {
  const data = loadAuthData()
  data.kugou = { uid, token, nickname, savedAt: Date.now() }
  try {
    fs.writeFileSync(getAuthFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[AuthPersistence] Failed to save kugou auth:', e)
  }
}

export function saveNeteaseAuth(userId: string, nickname: string, avatarUrl: string) {
  const data = loadAuthData()
  data.netease = { userId, nickname, avatarUrl, savedAt: Date.now() }
  try {
    fs.writeFileSync(getAuthFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[AuthPersistence] Failed to save netease auth:', e)
  }
}

export function clearAuthData() {
  try {
    const filePath = getAuthFilePath()
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (e) {
    console.error('[AuthPersistence] Failed to clear auth data:', e)
  }
}