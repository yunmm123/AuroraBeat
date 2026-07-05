import React, { useState, useEffect } from 'react'
import { usePlayer } from './hooks/usePlayer'

// v3.5.0 B4: 迷你模式窗口（320x120 置顶悬浮）
// 仅显示：封面 + 歌名/歌手 + 上一首/播放/下一首 + 喜欢 + 展开
export default function MiniPlayer() {
  const player = usePlayer()
  const [liked, setLiked] = useState(false)

  useEffect(() => {
    if (player.currentSong) setLiked(player.isLiked(player.currentSong.id))
  }, [player.currentSong, player.likedSongs])

  const song = player.currentSong
  const cover = song?.cover || ''
  const title = song?.title || song?.name || '未播放'
  const artist = song?.artist || ''

  return (
    <div
      className="fixed inset-0 flex items-center gap-2 px-2 select-none overflow-hidden"
      style={{
        background: 'linear-gradient(112deg, rgba(72,74,76,.62), rgba(24,27,30,.70) 48%, rgba(8,12,14,.74))',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,.08)',
        borderRadius: 10,
      }}
    >
      {/* 封面 */}
      <div className="relative flex-shrink-0" style={{ width: 84, height: 84 }}>
        {cover ? (
          <img
            src={cover}
            alt=""
            className="w-full h-full object-cover"
            style={{ borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30 text-2xl"
            style={{ borderRadius: 8, background: 'rgba(255,255,255,.04)' }}>♪</div>
        )}
        {player.isPlaying && (
          <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: 8, boxShadow: 'inset 0 0 0 2px rgba(0,245,212,.4)' }} />
        )}
      </div>

      {/* 信息+控制 */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <div className="text-white text-xs font-medium truncate" style={{ fontSize: 13 }} title={title}>{title}</div>
        <div className="text-white/50 text-[10px] truncate" title={artist}>{artist}</div>

        <div className="flex items-center gap-1 mt-0.5">
          <button
            onClick={() => player.prev()}
            className="text-white/70 hover:text-white transition-colors"
            style={{ fontSize: 14, width: 22, height: 22, background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="上一首"
          >⏮</button>
          <button
            onClick={() => player.togglePlay()}
            className="text-white hover:text-white transition-colors"
            style={{
              fontSize: 16, width: 28, height: 22,
              background: 'rgba(255,255,255,.08)',
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 6, cursor: 'pointer',
            }}
            title={player.isPlaying ? '暂停' : '播放'}
          >{player.isPlaying ? '⏸' : '▶'}</button>
          <button
            onClick={() => player.next()}
            className="text-white/70 hover:text-white transition-colors"
            style={{ fontSize: 14, width: 22, height: 22, background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="下一首"
          >⏭</button>

          {song && (
            <button
              onClick={() => {
                player.toggleLike(song)
                setLiked(!liked)
              }}
              className="ml-1 transition-colors"
              style={{
                fontSize: 13, width: 22, height: 22,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: liked ? '#ff5e8a' : 'rgba(255,255,255,.5)',
              }}
              title={liked ? '取消喜欢' : '喜欢'}
            >{liked ? '♥' : '♡'}</button>
          )}

          {/* 展开（恢复主窗口） */}
          <button
            onClick={() => {
              (window as any).electronAPI?.miniClose?.()
            }}
            className="ml-auto text-white/70 hover:text-white transition-colors"
            style={{
              fontSize: 11, padding: '2px 6px',
              background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 5, cursor: 'pointer',
            }}
            title="展开主窗口"
          >▦</button>
        </div>
      </div>
    </div>
  )
}
