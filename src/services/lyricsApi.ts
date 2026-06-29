// Lyrics API - uses ufanv.cn via Electron IPC
export interface LyricLine {
  time: number  // seconds
  text: string
}

// Search lyrics from ufanv.cn via Electron IPC (scrapes the website)
export async function searchLyricsFromUfanv(
  trackName: string,
  artistName: string
): Promise<string | null> {
  if (!window.electronAPI?.lyrics) return null

  try {
    const query = artistName ? `${trackName} ${artistName}` : trackName
    const lrcText = await window.electronAPI.lyrics.searchUfanv(query)
    return lrcText
  } catch {
    return null
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

// Parse filename like "张靓颖 - 野心家" or "张靓颖-野心家" into artist + title
export function parseSongFilename(filename: string): { title: string; artist: string } {
  const name = filename.replace(/\.[^.]+$/, '').trim()
  
  // Try "artist - title" or "artist-title" pattern
  const separators = [' - ', '-', ' — ', '–']
  for (const sep of separators) {
    const idx = name.indexOf(sep)
    if (idx > 0) {
      const artist = name.substring(0, idx).trim()
      const title = name.substring(idx + sep.length).trim()
      if (artist && title) {
        return { title, artist }
      }
    }
  }
  
  // No separator found, treat whole name as title
  return { title: name, artist: '未知艺术家' }
}
