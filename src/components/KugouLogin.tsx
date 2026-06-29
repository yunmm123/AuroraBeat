import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, QrCode, Smartphone, Loader2, CheckCircle2 } from 'lucide-react'
import { kugouQrKey, kugouQrCreate, kugouQrCheck } from '@/services/kugouApi'

interface KugouLoginProps {
  onClose: () => void
  onLoginSuccess: (userInfo: { uid: string; token: string; nickname: string }) => void
}

export default function KugouLogin({ onClose, onLoginSuccess }: KugouLoginProps) {
  const [qrKey, setQrKey] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    initQrCode()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function initQrCode() {
    try {
      setStatus('loading')
      setMessage('正在获取登录二维码...')

      const keyRes = await kugouQrKey()
      // Real KuGou API returns the key in data.qrcode
      const key = keyRes?.data?.qrcode || keyRes?.data?.key || keyRes?.qrcode
      if (!key) throw new Error('Failed to get QR key')

      setQrKey(key)

      const qrRes = await kugouQrCreate(key)
      // login_qr_create generates a base64 PNG data URL in data.base64
      const qrImg = qrRes?.data?.base64 || qrRes?.data?.qrcode || qrRes?.data?.url
      if (!qrImg) throw new Error('Failed to create QR code')

      setQrImage(qrImg)
      setStatus('waiting')
      setMessage('请使用酷狗音乐APP扫码登录')

      // Start polling for scan status
      pollRef.current = setInterval(() => checkQrStatus(key), 2000)
    } catch (error) {
      setStatus('error')
      setMessage('获取二维码失败，请重试')
    }
  }

  async function checkQrStatus(key: string) {
    try {
      const res = await kugouQrCheck(key)
      // Real KuGou API status: 0=expired, 1=waiting, 2=scanned, 4=confirmed(returns token)
      const statusCode = Number(res?.data?.status ?? res?.status)

      if (statusCode === 2) {
        setStatus('scanned')
        setMessage('已扫码，请在手机上确认')
      } else if (statusCode === 4) {
        setStatus('success')
        setMessage('登录成功！')
        if (pollRef.current) clearInterval(pollRef.current)

        // Get user info from response — field is userid (not uid)
        const uid = String(res?.data?.userid || res?.userid || '')
        const token = res?.data?.token || res?.token || ''
        const nickname = res?.data?.nickname || res?.data?.username || '酷狗用户'

        if (uid && token) {
          setTimeout(() => {
            onLoginSuccess({ uid, token, nickname })
          }, 500)
        }
      } else if (statusCode === 0) {
        setStatus('error')
        setMessage('二维码已过期，请刷新')
        if (pollRef.current) clearInterval(pollRef.current)
      }
    } catch (error) {
      // Polling error, ignore
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.9)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-[420px] rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: '#0d0d1a', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(90deg, rgba(59,130,246,0.15), rgba(147,51,234,0.15))' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #9333ea)' }}>
                <QrCode size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">酷狗音乐登录</h3>
                <p className="text-white/50 text-xs">扫码登录，享受完整功能</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors hover:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 flex flex-col items-center">
            {status === 'loading' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 size={40} className="text-purple-400 animate-spin" />
                <p className="text-white/60">{message}</p>
              </div>
            )}

            {status === 'waiting' && qrImage && (
              <>
                <div className="w-[220px] h-[220px] rounded-xl overflow-hidden bg-white p-3 mb-4">
                  <img
                    src={qrImage}
                    alt="QR Code"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                  <Smartphone size={16} />
                  <span>{message}</span>
                </div>
                <p className="text-white/40 text-xs">打开酷狗音乐APP → 扫一扫</p>
              </>
            )}

            {status === 'scanned' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <CheckCircle2 size={40} className="text-blue-400" />
                </div>
                <p className="text-white/80 text-lg">{message}</p>
                <Loader2 size={24} className="text-blue-400 animate-spin" />
              </div>
            )}

            {status === 'success' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 size={40} className="text-green-400" />
                </div>
                <p className="text-green-400 text-lg font-medium">{message}</p>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                  <X size={40} className="text-red-400" />
                </div>
                <p className="text-red-400 text-lg">{message}</p>
                <button
                  onClick={initQrCode}
                  className="px-6 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                >
                  重新获取二维码
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-white/10 bg-white/5">
            <p className="text-white/40 text-xs text-center">
              登录即表示同意酷狗音乐用户服务协议
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
