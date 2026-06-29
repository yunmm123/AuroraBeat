import type { Theme } from '@/types'

export const themes: Theme[] = [
  {
    id: 'aurora-purple',
    name: '暗夜紫',
    primary: '#8b5cf6',
    secondary: '#6366f1',
    accent: '#a78bfa',
    background: '#0a0a0f',
    surface: 'rgba(20, 20, 30, 0.7)',
    text: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
  },
  {
    id: 'deep-ocean',
    name: '深海蓝',
    primary: '#0ea5e9',
    secondary: '#0284c7',
    accent: '#38bdf8',
    background: '#040c1a',
    surface: 'rgba(10, 25, 50, 0.7)',
    text: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
  },
  {
    id: 'lava-orange',
    name: '熔岩橙',
    primary: '#f97316',
    secondary: '#ea580c',
    accent: '#fb923c',
    background: '#0f0a05',
    surface: 'rgba(40, 20, 10, 0.7)',
    text: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
  },
  {
    id: 'aurora-green',
    name: '极光绿',
    primary: '#10b981',
    secondary: '#059669',
    accent: '#34d399',
    background: '#050f0a',
    surface: 'rgba(10, 30, 20, 0.7)',
    text: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
  },
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    primary: '#ec4899',
    secondary: '#f43f5e',
    accent: '#f472b6',
    background: '#0a0a14',
    surface: 'rgba(25, 10, 30, 0.7)',
    text: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
  },
  {
    id: 'minimal-white',
    name: '极简白',
    primary: '#6366f1',
    secondary: '#4f46e5',
    accent: '#818cf8',
    background: '#f8fafc',
    surface: 'rgba(255, 255, 255, 0.8)',
    text: '#1e293b',
    textSecondary: 'rgba(30, 41, 59, 0.7)',
  },
]

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.style.setProperty('--color-primary', theme.primary)
  root.style.setProperty('--color-secondary', theme.secondary)
  root.style.setProperty('--color-accent', theme.accent)
  root.style.setProperty('--color-background', theme.background)
  root.style.setProperty('--color-surface', theme.surface)
  root.style.setProperty('--color-text', theme.text)
  root.style.setProperty('--color-text-secondary', theme.textSecondary)
}
