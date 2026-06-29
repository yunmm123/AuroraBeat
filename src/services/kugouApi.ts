// KuGou Music API Service - communicates with local KuGouMusicApi server
const API_BASE = 'http://127.0.0.1:13456'

async function kugouRequest(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(API_BASE + path)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  })
  
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`KuGou API error: ${res.status}`)
  const data = await res.json()
  return data
}

// ============ Search ============
export async function kugouSearch(keyword: string, page: number = 1, pageSize: number = 30) {
  return kugouRequest('/search', { keyword, page, pagesize: pageSize })
}

// ============ Song URL ============
export async function kugouSongUrl(hash: string, albumId?: string) {
  const params: any = { hash }
  if (albumId) params.album_id = albumId
  return kugouRequest('/song/url', params)
}

// ============ Lyrics ============
export async function kugouLyric(hash: string, albumId?: string) {
  const params: any = { hash }
  if (albumId) params.album_id = albumId
  return kugouRequest('/lyric', params)
}

// ============ Login (QR Code) ============
export async function kugouQrKey() {
  return kugouRequest('/login/qr/key')
}

export async function kugouQrCreate(key: string) {
  return kugouRequest('/login/qr/create', { key, qrimg: true })
}

export async function kugouQrCheck(key: string) {
  return kugouRequest('/login/qr/check', { key })
}

// ============ User ============
export async function kugouUserDetail(uid: string, token: string) {
  return kugouRequest('/user/detail', { uid, token })
}

export async function kugouUserPlaylist(uid: string, token: string, page: number = 1) {
  return kugouRequest('/user/playlist', { uid, token, page })
}

// ============ Playlist ============
export async function kugouPlaylistDetail(id: string) {
  return kugouRequest('/playlist/detail', { id })
}

export async function kugouPlaylistTrackAll(id: string, page: number = 1) {
  return kugouRequest('/playlist/track/all', { id, page })
}

// ============ Rank ============
export async function kugouRankList() {
  return kugouRequest('/rank/list')
}

export async function kugouRankAudio(rankId: string, page: number = 1) {
  return kugouRequest('/rank/audio', { rankid: rankId, page })
}

// ============ Recommend ============
export async function kugouPersonalFm(token: string) {
  return kugouRequest('/personal/fm', { token })
}

export async function kugouRecommendSongs() {
  return kugouRequest('/recommend/songs')
}

// ============ Artist ============
export async function kugouArtistDetail(artistId: string) {
  return kugouRequest('/artist/detail', { artistid: artistId })
}

export async function kugouArtistAudios(artistId: string, page: number = 1) {
  return kugouRequest('/artist/audios', { artistid: artistId, page })
}

// ============ Album ============
export async function kugouAlbumDetail(albumId: string) {
  return kugouRequest('/album/detail', { albumid: albumId })
}

export async function kugouAlbumSongs(albumId: string, page: number = 1) {
  return kugouRequest('/album/songs', { albumid: albumId, page })
}

// ============ Top / New ============
export async function kugouTopSong() {
  return kugouRequest('/top/song')
}

export async function kugouTopAlbum() {
  return kugouRequest('/top/album')
}

export async function kugouTopPlaylist(tag?: string, page: number = 1) {
  const params: any = { page }
  if (tag) params.tag = tag
  return kugouRequest('/top/playlist', params)
}

// ============ Comment ============
export async function kugouCommentMusic(hash: string, page: number = 1) {
  return kugouRequest('/comment/music', { hash, page })
}

// ============ Banner ============
export async function kugouBanner() {
  return kugouRequest('/banner')
}

// ============ Every Day ============
export async function kugouEverydayRecommend(token: string) {
  return kugouRequest('/everyday/recommend', { token })
}

// ============ Hot Search ============
export async function kugouSearchHot() {
  return kugouRequest('/search/hot')
}

export async function kugouSearchDefault() {
  return kugouRequest('/search/default')
}

// ============ Search Suggest ============
export async function kugouSearchSuggest(keyword: string) {
  return kugouRequest('/search/suggest', { keyword })
}

// ============ Complex Search ============
export async function kugouSearchComplex(keyword: string, page: number = 1) {
  return kugouRequest('/search/complex', { keyword, page })
}

// ============ Song Detail ============
export async function kugouSongDetail(hash: string) {
  return kugouRequest('/audio', { hash })
}

// ============ Song Climax (chorus) ============
export async function kugouSongClimax(hash: string) {
  return kugouRequest('/song/climax', { hash })
}

// ============ MV ============
export async function kugouAudioMv(hash: string) {
  return kugouRequest('/kmr/audio/mv', { hash })
}

export async function kugouVideoUrl(videoHash: string) {
  return kugouRequest('/video/url', { videohash: videoHash })
}

// ============ Scene Music ============
export async function kugouSceneLists() {
  return kugouRequest('/scene/lists')
}

export async function kugouSceneAudioList(sceneId: string, page: number = 1) {
  return kugouRequest('/scene/audio/list', { scene_id: sceneId, page })
}

// ============ Radio ============
export async function kugouDiantai() {
  return kugouRequest('/pc/diantai')
}

// ============ Fm ============
export async function kugouFmClass() {
  return kugouRequest('/fm/class')
}

export async function kugouFmRecommend(classId: string) {
  return kugouRequest('/fm/recommend', { classid: classId })
}

export async function kugouFmSongs(classId: string, songId?: string) {
  const params: any = { classid: classId }
  if (songId) params.songid = songId
  return kugouRequest('/fm/songs', params)
}
