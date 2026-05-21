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
      className="fixed bottom-4 left-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-bg-sidebar)]/95 p-4 shadow-[var(--chat-shadow-lg)] backdrop-blur-xl"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-3">
        <Loader2 className="size-4 shrink-0 animate-spin text-[var(--chat-accent)]" />
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-accent)]">
            Fast sync
          </p>
          <p className="truncate text-[13px] font-medium text-[var(--chat-text-primary)]">
            {sync.message || 'Syncing…'}
          </p>
          {(sync.chatsSynced ?? 0) > 0 || (sync.messagesSynced ?? 0) > 0 ? (
            <p className="mt-0.5 text-[11px] text-[var(--chat-text-tertiary)]">
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
        {!indeterminate && (
          <span className="shrink-0 text-[12px] tabular-nums text-[var(--chat-text-secondary)]">
            {sync.progress}%
          </span>
        )}
      </div>
    </div>
  )
}
