import { Loader2 } from 'lucide-react'
import type { SyncProgressPayload } from '@/shared/ipc'

interface SyncProgressBannerProps {
  sync: SyncProgressPayload
}

export function SyncProgressBanner({ sync }: SyncProgressBannerProps) {
  if (!sync.active) return null

  const indeterminate = sync.progress <= 0
  const width = indeterminate ? 40 : Math.max(4, sync.progress)
  const currentChunkMessages = sync.currentChunkMessages ?? 0
  const importRatePerSecond = sync.importRatePerSecond ?? 0
  const deferredMessages = sync.deferredMessages ?? 0

  return (
    <div
      className="fixed bottom-3 left-3 z-50 w-[320px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--chat-border-strong)] bg-[var(--chat-bg-main)]/95 p-3 shadow-[var(--chat-shadow-md)] backdrop-blur-xl"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--chat-accent-soft)]">
          <Loader2 className="size-3.5 animate-spin text-[var(--chat-accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-accent)]">
              Sync
            </p>
            {!indeterminate && (
              <span className="text-[11px] tabular-nums text-[var(--chat-text-secondary)]">
                {sync.progress}%
              </span>
            )}
          </div>
          <p className="truncate text-[12px] font-medium text-[var(--chat-text-primary)]">
            {sync.message || 'Syncing…'}
          </p>
          {(sync.chatsSynced ?? 0) > 0 || (sync.messagesSynced ?? 0) > 0 ? (
            <p className="mt-0.5 truncate text-[11px] text-[var(--chat-text-tertiary)]">
              {(sync.chatsSynced ?? 0).toLocaleString()} chats
              {(sync.messagesSynced ?? 0) > 0 &&
                ` · ${(sync.messagesSynced ?? 0).toLocaleString()} messages`}
              {currentChunkMessages > 0 &&
                ` · last chunk ${currentChunkMessages.toLocaleString()}`}
              {importRatePerSecond > 0 &&
                ` · ${importRatePerSecond.toLocaleString()}/sec`}
              {deferredMessages > 0 &&
                ` · ${deferredMessages.toLocaleString()} older deferred`}
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
      </div>
    </div>
  )
}
