// KuGou Music API Service - uses Electron IPC to call main process
const { ipcRenderer } = window.require('electron')

// ============ Search ============
export async function kugouSearch(keyword: string, page: number = 1, pageSize: number = 30) {
  return ipcRenderer.invoke('kg:search', keyword, page, pageSize)
}

export async function kugouSearchHot() {
  return ipcRenderer.invoke('kg:searchHot')
}

export async function kugouSearchDefault() {
  return ipcRenderer.invoke('kg:searchDefault')
}

// ============ Song URL ============
export async function kugouSongUrl(hash: string, albumId?: string) {
  return ipcRenderer.invoke('kg:songUrl', hash, albumId)
}

// ============ Lyrics ============
export async function kugouLyric(hash: string, albumId?: string) {
  return ipcRenderer.invoke('kg:lyric', hash, albumId)
}

// ============ Login (QR Code) ============
export async function kugouQrKey() {
  return ipcRenderer.invoke('kg:qrKey')
}

export async function kugouQrCreate(key: string) {
  return ipcRenderer.invoke('kg:qrCreate', key)
}

export async function kugouQrCheck(key: string) {
  return ipcRenderer.invoke('kg:qrCheck', key)
}

// ============ User ============
export async function kugouUserDetail(uid: string, token: string) {
  return ipcRenderer.invoke('kg:userDetail', uid, token)
}

export async function kugouUserPlaylist(uid: string, token: string, page: number = 1) {
  return ipcRenderer.invoke('kg:userPlaylist', uid, token, page)
}

// ============ Playlist ============
export async function kugouPlaylistDetail(id: string) {
  return ipcRenderer.invoke('kg:playlistDetail', id)
}

export async function kugouPlaylistTrackAll(id: string, page: number = 1) {
  return ipcRenderer.invoke('kg:playlistTrackAll', id, page)
}

// ============ Rank ============
export async function kugouRankList() {
  return ipcRenderer.invoke('kg:rankList')
}

export async function kugouRankAudio(rankId: string, page: number = 1) {
  return ipcRenderer.invoke('kg:rankAudio', rankId, page)
}

// ============ Recommend ============
export async function kugouPersonalFm(token: string) {
  return ipcRenderer.invoke('kg:personalFm', token)
}

export async function kugouRecommendSongs() {
  return ipcRenderer.invoke('kg:recommendSongs')
}

// ============ Artist ============
export async function kugouArtistDetail(artistId: string) {
  return ipcRenderer.invoke('kg:artistDetail', artistId)
}

export async function kugouArtistAudios(artistId: string, page: number = 1) {
  return ipcRenderer.invoke('kg:artistAudios', artistId, page)
}

// ============ Album ============
export async function kugouAlbumDetail(albumId: string) {
  return ipcRenderer.invoke('kg:albumDetail', albumId)
}

export async function kugouAlbumSongs(albumId: string, page: number = 1) {
  return ipcRenderer.invoke('kg:albumSongs', albumId, page)
}

// ============ Top / New ============
export async function kugouTopSong() {
  return ipcRenderer.invoke('kg:topSong')
}

export async function kugouTopAlbum() {
  return ipcRenderer.invoke('kg:topAlbum')
}

export async function kugouTopPlaylist(tag?: string, page: number = 1) {
  return ipcRenderer.invoke('kg:topPlaylist', tag, page)
}

// ============ Comment ============
export async function kugouCommentMusic(hash: string, page: number = 1) {
  return ipcRenderer.invoke('kg:commentMusic', hash, page)
}

// ============ Banner ============
export async function kugouBanner() {
  return ipcRenderer.invoke('kg:banner')
}

// ============ Every Day ============
export async function kugouEverydayRecommend(token: string) {
  return ipcRenderer.invoke('kg:everydayRecommend', token)
}

// ============ Search Suggest ============
export async function kugouSearchSuggest(keyword: string) {
  return ipcRenderer.invoke('kg:searchSuggest', keyword)
}

// ============ Complex Search ============
export async function kugouSearchComplex(keyword: string, page: number = 1) {
  return ipcRenderer.invoke('kg:searchComplex', keyword, page)
}

// ============ Song Detail ============
export async function kugouSongDetail(hash: string) {
  return ipcRenderer.invoke('kg:songDetail', hash)
}

// ============ Song Climax (chorus) ============
export async function kugouSongClimax(hash: string) {
  return ipcRenderer.invoke('kg:songClimax', hash)
}

// ============ MV ============
export async function kugouAudioMv(hash: string) {
  return ipcRenderer.invoke('kg:audioMv', hash)
}

export async function kugouVideoUrl(videoHash: string) {
  return ipcRenderer.invoke('kg:videoUrl', videoHash)
}

// ============ Scene Music ============
export async function kugouSceneLists() {
  return ipcRenderer.invoke('kg:sceneLists')
}

export async function kugouSceneAudioList(sceneId: string, page: number = 1) {
  return ipcRenderer.invoke('kg:sceneAudioList', sceneId, page)
}

// ============ Radio ============
export async function kugouDiantai() {
  return ipcRenderer.invoke('kg:diantai')
}

// ============ Fm ============
export async function kugouFmClass() {
  return ipcRenderer.invoke('kg:fmClass')
}

export async function kugouFmRecommend(classId: string) {
  return ipcRenderer.invoke('kg:fmRecommend', classId)
}

export async function kugouFmSongs(classId: string, songId?: string) {
  return ipcRenderer.invoke('kg:fmSongs', classId, songId)
}

// ============ Health Check ============
export async function kugouHealthCheck() {
  return ipcRenderer.invoke('kg:healthCheck')
}
