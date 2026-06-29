// KuGou Music API Service - uses the secure preload bridge (window.electronAPI.kugou)
// to invoke KuGou handlers registered in the Electron main process.
//
// NOTE: Do NOT use `window.require('electron')` here. The renderer runs with
// nodeIntegration:false / contextIsolation:true, so window.require is undefined
// and calling it at module load would crash the renderer (black screen).

function invoke(channel: string, ...args: any[]): Promise<any> {
  if (!window.electronAPI?.kugou) {
    return Promise.reject(new Error('KuGou API bridge is not available'))
  }
  return window.electronAPI.kugou.invoke(channel, ...args)
}

// ============ Search ============
export async function kugouSearch(keyword: string, page: number = 1, pageSize: number = 30) {
  return invoke('kg:search', keyword, page, pageSize)
}

export async function kugouSearchHot() {
  return invoke('kg:searchHot')
}

export async function kugouSearchDefault() {
  return invoke('kg:searchDefault')
}

// ============ Song URL ============
export async function kugouSongUrl(hash: string, albumId?: string) {
  return invoke('kg:songUrl', hash, albumId)
}

// ============ Lyrics ============
export async function kugouLyric(hash: string, albumId?: string) {
  return invoke('kg:lyric', hash, albumId)
}

export async function kugouSearchLyric(keyword: string, duration?: number, hash?: string) {
  return invoke('kg:searchLyric', keyword, duration, hash)
}

export async function kugouGetLyricById(id: string, accesskey: string) {
  return invoke('kg:getLyricById', id, accesskey)
}

// ============ Login (QR Code) ============
export async function kugouQrKey() {
  return invoke('kg:qrKey')
}

export async function kugouQrCreate(key: string) {
  return invoke('kg:qrCreate', key)
}

export async function kugouQrCheck(key: string) {
  return invoke('kg:qrCheck', key)
}

// ============ User ============
export async function kugouUserDetail(uid: string, token: string) {
  return invoke('kg:userDetail', uid, token)
}

export async function kugouUserPlaylist(uid: string, token: string, page: number = 1) {
  return invoke('kg:userPlaylist', uid, token, page)
}

// ============ Playlist ============
export async function kugouPlaylistDetail(id: string) {
  return invoke('kg:playlistDetail', id)
}

export async function kugouPlaylistTrackAll(id: string, page: number = 1) {
  return invoke('kg:playlistTrackAll', id, page)
}

export async function kugouPlaylistTrackAllNew(listId: string, page: number = 1, uid?: string, token?: string) {
  return invoke('kg:playlistTrackAllNew', listId, page, uid, token)
}

// ============ Rank ============
export async function kugouRankList() {
  return invoke('kg:rankList')
}

export async function kugouRankAudio(rankId: string, page: number = 1) {
  return invoke('kg:rankAudio', rankId, page)
}

// ============ Recommend ============
export async function kugouPersonalFm(token: string) {
  return invoke('kg:personalFm', token)
}

export async function kugouRecommendSongs() {
  return invoke('kg:recommendSongs')
}

// ============ Artist ============
export async function kugouArtistDetail(artistId: string) {
  return invoke('kg:artistDetail', artistId)
}

export async function kugouArtistAudios(artistId: string, page: number = 1) {
  return invoke('kg:artistAudios', artistId, page)
}

// ============ Album ============
export async function kugouAlbumDetail(albumId: string) {
  return invoke('kg:albumDetail', albumId)
}

export async function kugouAlbumSongs(albumId: string, page: number = 1) {
  return invoke('kg:albumSongs', albumId, page)
}

// ============ Top / New ============
export async function kugouTopSong() {
  return invoke('kg:topSong')
}

export async function kugouTopAlbum() {
  return invoke('kg:topAlbum')
}

export async function kugouTopPlaylist(tag?: string, page: number = 1) {
  return invoke('kg:topPlaylist', tag, page)
}

// ============ Comment ============
export async function kugouCommentMusic(hash: string, page: number = 1) {
  return invoke('kg:commentMusic', hash, page)
}

// ============ Banner ============
export async function kugouBanner() {
  return invoke('kg:banner')
}

// ============ Every Day ============
export async function kugouEverydayRecommend(token: string) {
  return invoke('kg:everydayRecommend', token)
}

// ============ Search Suggest ============
export async function kugouSearchSuggest(keyword: string) {
  return invoke('kg:searchSuggest', keyword)
}

// ============ Complex Search ============
export async function kugouSearchComplex(keyword: string, page: number = 1) {
  return invoke('kg:searchComplex', keyword, page)
}

// ============ Song Detail ============
export async function kugouSongDetail(hash: string) {
  return invoke('kg:songDetail', hash)
}

// ============ Song Climax (chorus) ============
export async function kugouSongClimax(hash: string) {
  return invoke('kg:songClimax', hash)
}

// ============ MV ============
export async function kugouAudioMv(hash: string) {
  return invoke('kg:audioMv', hash)
}

export async function kugouVideoUrl(videoHash: string) {
  return invoke('kg:videoUrl', videoHash)
}

// ============ Scene Music ============
export async function kugouSceneLists() {
  return invoke('kg:sceneLists')
}

export async function kugouSceneAudioList(sceneId: string, page: number = 1) {
  return invoke('kg:sceneAudioList', sceneId, page)
}

// ============ Radio ============
export async function kugouDiantai() {
  return invoke('kg:diantai')
}

// ============ Fm ============
export async function kugouFmClass() {
  return invoke('kg:fmClass')
}

export async function kugouFmRecommend(classId: string) {
  return invoke('kg:fmRecommend', classId)
}

export async function kugouFmSongs(classId: string, songId?: string) {
  return invoke('kg:fmSongs', classId, songId)
}

// ============ Health Check ============
export async function kugouHealthCheck() {
  return invoke('kg:healthCheck')
}
