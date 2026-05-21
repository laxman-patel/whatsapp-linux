import { Moon, Sun } from 'lucide-react'
import type { ColorScheme } from '@/shared/ipc'

interface ThemeToggleProps {
  value: ColorScheme
  onChange: (scheme: ColorScheme) => void
}

export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  const isDark =
    value === 'dark' ||
    (value === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const cycle = () => {
    const next: ColorScheme =
      value === 'light' ? 'dark' : value === 'dark' ? 'system' : 'light'
    onChange(next)
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="titlebar-btn flex size-6 items-center justify-center rounded-md text-[var(--titlebar-text)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
      title={`Theme: ${value} (click to change)`}
      aria-label={`Theme: ${value}. Click to change.`}
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  )
}
