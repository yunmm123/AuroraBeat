// lrclib.net - Free lyrics API, no key required
const API_BASE = 'https://lrclib.net/api'

export interface LyricsResult {
  id: number
  name: string
  trackName: string
  artistName: string
  albumName: string
  duration: number
  syncedLyrics: string | null
  plainLyrics: string | null
}

export interface LyricLine {
  time: number  // seconds
  text: string
}

export async function searchLyrics(
  trackName: string,
  artistName: string,
  albumName?: string,
  duration?: number
): Promise<LyricsResult | null> {
  try {
    const params = new URLSearchParams()
    params.set('track_name', trackName)
    params.set('artist_name', artistName)
    if (albumName) params.set('album_name', albumName)
    if (duration) params.set('duration', String(Math.round(duration)))

    const res = await fetch(`${API_BASE}/get?${params.toString()}`)
    if (!res.ok) return null
    const data = await res.json()
    return data
  } catch {
    return null
  }
}

export async function searchLyricsByQuery(query: string): Promise<LyricsResult[]> {
  try {
    const params = new URLSearchParams()
    params.set('q', query)
    const res = await fetch(`${API_BASE}/search?${params.toString()}`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export function parseLrc(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = []
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/
  
  const rawLines = lrcText.split('\n')
  for (const raw of rawLines) {
    const match = raw.match(regex)
    if (match) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseFloat(match[2])
      const text = match[3].trim()
      if (text) {
        lines.push({
          time: minutes * 60 + seconds,
          text,
        })
      }
    }
  }
  
  return lines.sort((a, b) => a.time - b.time)
}

export function parseSyncedLyrics(syncedLyrics: string): LyricLine[] {
  return parseLrc(syncedLyrics)
}
