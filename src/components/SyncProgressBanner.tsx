import { Loader2 } from 'lucide-react'
import type { SyncProgressPayload } from '@/shared/ipc'

interface SyncProgressBannerProps {
  sync: SyncProgressPayload
}

export function SyncProgressBanner({ sync }: SyncProgressBannerProps) {
  if (!sync.active) return null

  const indeterminate = sync.progress <= 0
  const width = indeterminate ? 40 : Math.max(4, sync.progress)

  return (
    <div
      className="shrink-0 border-b border-[var(--chat-border)] bg-[var(--chat-bg-sidebar)] px-4 py-2.5"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <Loader2 className="size-4 shrink-0 animate-spin text-[var(--chat-accent)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[var(--chat-text-primary)]">
            {sync.message || 'Syncing…'}
          </p>
          {(sync.chatsSynced ?? 0) > 0 || (sync.messagesSynced ?? 0) > 0 ? (
            <p className="mt-0.5 text-[11px] text-[var(--chat-text-tertiary)]">
              {(sync.chatsSynced ?? 0).toLocaleString()} chats
              {(sync.messagesSynced ?? 0) > 0 &&
                ` · ${(sync.messagesSynced ?? 0).toLocaleString()} messages`}
            </p>
          ) : null}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--chat-border)]">
            <div
              className={`h-full rounded-full bg-[var(--chat-accent)] transition-all duration-300 ${
                indeterminate ? 'animate-pulse' : ''
              }`}
              style={{ width: indeterminate ? `${width}%` : `${width}%` }}
            />
          </div>
        </div>
        {!indeterminate && (
          <span className="shrink-0 text-[12px] tabular-nums text-[var(--chat-text-secondary)]">
            {sync.progress}%
          </span>
        )}
      </div>
    </div>
  )
}
