import { useState } from 'react'
import { cn } from '@/lib/utils'

interface AvatarCircleProps {
  src?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClass = {
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-sm',
  lg: 'size-11 text-[13px]',
} as const

export function AvatarCircle({ src, name, size = 'lg', className }: AvatarCircleProps) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed
  const initial = (name.trim().charAt(0) || '?').toUpperCase()

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--chat-bubble-incoming)] font-semibold text-[var(--chat-text-secondary)]',
        sizeClass[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  )
}
