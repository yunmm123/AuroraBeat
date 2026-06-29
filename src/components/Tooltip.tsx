import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface TooltipProps {
  text: string
  children: React.ReactNode
  position?: 'top' | 'bottom'
}

export default function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [show, setShow] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), 400)
  }

  const handleLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShow(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: position === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: position === 'top' ? 4 : -4 }}
            transition={{ duration: 0.15 }}
            className={`absolute left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md text-xs text-white whitespace-nowrap pointer-events-none z-50 ${
              position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
            style={{
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
