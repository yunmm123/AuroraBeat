import { useEffect, useState } from 'react';

/**
 * v3.8.6 桌面悬浮歌词视图
 * 在独立的透明窗口中渲染（Electron 主进程创建，hash = #desktop-lyrics）
 * 通过 IPC 接收主进程转发的歌词更新
 */
export default function DesktopLyricsView() {
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const electron = (window as any).electronAPI;
    if (!electron?.onDesktopLyricsUpdate) return;
    const off = electron.onDesktopLyricsUpdate((data: { text: string; translation: string; isPlaying: boolean }) => {
      setText(data.text || '');
      setTranslation(data.translation || '');
      setIsPlaying(!!data.isPlaying);
    });
    return () => { off?.(); };
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        pointerEvents: 'none',
        userSelect: 'none',
        fontFamily: '"Noto Sans SC", "PingFang SC", "Inter", sans-serif',
        opacity: text ? 1 : 0,
        transition: 'opacity 0.6s ease',
      }}
    >
      <div
        key={text}
        style={{
          fontSize: '38px',
          fontWeight: 800,
          color: '#ffffff',
          textShadow: '0 2px 12px rgba(0,0,0,0.85), 0 0 24px rgba(0,245,212,0.35)',
          textAlign: 'center',
          padding: '0 24px',
          lineHeight: 1.3,
          letterSpacing: '0.02em',
          maxWidth: '960px',
          animation: 'dl-fadein 0.6s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {text || '♪'}
      </div>
      {translation && (
        <div
          style={{
            fontSize: '18px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.72)',
            textShadow: '0 1px 6px rgba(0,0,0,0.7)',
            marginTop: '8px',
            textAlign: 'center',
            padding: '0 24px',
            maxWidth: '800px',
          }}
        >
          {translation}
        </div>
      )}
      {!isPlaying && text && (
        <div
          style={{
            fontSize: '12px',
            color: 'rgba(255,255,255,0.4)',
            marginTop: '6px',
          }}
        >
          ❚❚ 已暂停
        </div>
      )}
      <style>{`
        @keyframes dl-fadein {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
