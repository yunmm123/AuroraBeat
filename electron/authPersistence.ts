import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

interface KugouAuth {
  uid: string
  token: string
  nickname: string
  avatar?: string
  savedAt: number
}

interface NeteaseAuth {
  userId: string
  nickname: string
  avatarUrl: string
  cookie: string
  savedAt: number
}

interface AuthData {
  kugou?: KugouAuth
  netease?: NeteaseAuth
}

const AUTH_FILE = 'auth-data.json'
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000

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

    if (data.kugou && (now - data.kugou.savedAt) > EXPIRATION_MS) {
      delete data.kugou
    }
    if (data.netease && (now - data.netease.savedAt) > EXPIRATION_MS) {
      delete data.netease
    }

    if (!data.kugou && !data.netease) {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }

    return data
  } catch {
    return {}
  }
}

export function saveKugouAuth(uid: string, token: string, nickname: string, avatar?: string) {
  const data = loadAuthData()
  data.kugou = { uid, token, nickname, avatar, savedAt: Date.now() }
  try {
    fs.writeFileSync(getAuthFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[AuthPersistence] Failed to save kugou auth:', e)
  }
}

export function saveNeteaseAuth(userId: string, nickname: string, avatarUrl: string, cookie: string) {
  const data = loadAuthData()
  data.netease = { userId, nickname, avatarUrl, cookie, savedAt: Date.now() }
  try {
    fs.writeFileSync(getAuthFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[AuthPersistence] Failed to save netease auth:', e)
  }
}

export function getNeteaseCookie(): string {
  const data = loadAuthData()
  return data.netease?.cookie || ''
}

export function clearAuthData(provider?: string) {
  try {
    if (provider) {
      const data = loadAuthData()
      if (provider === 'kugou') delete data.kugou
      if (provider === 'netease') delete data.netease
      if (data.kugou || data.netease) {
        fs.writeFileSync(getAuthFilePath(), JSON.stringify(data, null, 2), 'utf-8')
      } else {
        const filePath = getAuthFilePath()
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }
    } else {
      const filePath = getAuthFilePath()
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
  } catch (e) {
    console.error('[AuthPersistence] Failed to clear auth data:', e)
  }
}
