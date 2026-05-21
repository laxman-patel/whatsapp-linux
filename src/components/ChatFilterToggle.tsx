import { cn } from '@/lib/utils'
import type { ChatFilter } from '@/shared/ipc'

const FILTERS: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'dm', label: 'DMs' },
  { value: 'group', label: 'Groups' },
]

interface ChatFilterToggleProps {
  value: ChatFilter
  onChange: (value: ChatFilter) => void
  className?: string
}

export function ChatFilterToggle({ value, onChange, className }: ChatFilterToggleProps) {
  return (
    <div
      className={cn(
        'mx-3 mb-2 grid grid-cols-3 gap-0.5 rounded-lg bg-[var(--chat-bg-main)] p-0.5',
        className,
      )}
      role="tablist"
      aria-label="Conversation filter"
    >
      {FILTERS.map(({ value: filterValue, label }) => {
        const active = value === filterValue
        return (
          <button
            key={filterValue}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(filterValue)}
            className={cn(
              'rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-[#007AFF] text-white shadow-sm'
                : 'text-[var(--chat-text-secondary)] hover:text-[var(--chat-text-primary)]',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
