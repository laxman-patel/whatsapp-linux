import { CheckCircle2, Loader2 } from 'lucide-react'
import type { SyncProgressPayload } from '@/shared/ipc'

interface SyncProgressBannerProps {
  sync: SyncProgressPayload
}

export function SyncProgressBanner({ sync }: SyncProgressBannerProps) {
  const chats = sync.chatsSynced ?? 0
  const messages = sync.messagesSynced ?? 0
  const total = Math.max(sync.estimatedTotalMessages ?? 0, messages)

  // Visible while syncing + briefly afterwards for the "complete" toast.
  if (!sync.active && messages === 0 && chats === 0) return null

  const isComplete = sync.phase === 'finalizing' || (!sync.active && messages > 0)
  const indeterminate = sync.active && sync.progress <= 0
  const progress = isComplete ? 100 : Math.max(sync.progress, indeterminate ? 8 : 0)

  return (
    <div
      className="fixed bottom-4 left-4 z-50 w-[300px] max-w-[calc(100vw-2rem)]"
      role="status"
      aria-live="polite"
      aria-busy={sync.active}
    >
      <div className="rounded-xl border border-[var(--chat-border)] bg-[var(--chat-bg-main)]/95 px-3 py-2.5 shadow-[var(--chat-shadow-md)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-[#34C759]" />
          ) : (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-[#007AFF]" />
          )}

          <span className="flex-1 truncate text-[12px] font-medium text-[var(--chat-text-primary)]">
            {isComplete ? 'Sync complete' : sync.message || 'Syncing\u2026'}
          </span>

          <span className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--chat-text-secondary)]">
            {progress}%
          </span>
        </div>

        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[var(--chat-border)]">
          <div
            className={`h-full rounded-full bg-[#007AFF] transition-[width] duration-300 ease-out ${
              indeterminate ? 'animate-pulse' : ''
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {(messages > 0 || chats > 0) && (
          <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-[var(--chat-text-tertiary)]">
            <span className="truncate">
              {messages > 0
                ? total > messages
                  ? `${messages.toLocaleString()} of ${total.toLocaleString()} messages`
                  : `${messages.toLocaleString()} messages`
                : ''}
            </span>
            {chats > 0 && (
              <span className="ml-2 shrink-0">
                {chats.toLocaleString()} chats
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
