import { Loader2, RefreshCw, Smartphone } from 'lucide-react'
import type { ConnectionStatus } from '@/shared/ipc'

interface QrLoginScreenProps {
  status: ConnectionStatus
  message?: string
  qrDataUrl: string | null
  onRetry: () => void
  onLogout: () => void
}

export function QrLoginScreen({
  status,
  message,
  qrDataUrl,
  onRetry,
  onLogout,
}: QrLoginScreenProps) {
  const isError = status === 'error'
  const isConnecting = status === 'connecting' || status === 'disconnected'
  const showQr = status === 'qr'

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[var(--chat-bg-app)] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-bg-main)] p-8 shadow-[var(--chat-shadow-md)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--chat-accent-soft)]">
            <Smartphone className="size-7 text-[var(--chat-accent)]" />
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--chat-text-primary)]">
            Link WhatsApp
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--chat-text-secondary)]">
            {message ??
              (showQr
                ? 'Open WhatsApp on your phone → Linked devices → Link a device'
                : 'Connecting…')}
          </p>
        </div>

        {showQr && (
          <div className="flex flex-col items-center gap-4">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="WhatsApp QR code"
                className="size-[280px] rounded-xl border border-[var(--chat-border)] bg-white p-2"
              />
            ) : (
              <div className="flex size-[280px] items-center justify-center rounded-xl border border-dashed border-[var(--chat-border-strong)] bg-[var(--chat-bg-sidebar)]">
                <Loader2 className="size-8 animate-spin text-[var(--chat-text-tertiary)]" />
              </div>
            )}
            <p className="text-center text-[12px] text-[var(--chat-text-tertiary)]">
              QR refreshes automatically. Keep this window open while scanning.
            </p>
          </div>
        )}

        {isConnecting && !showQr && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-10 animate-spin text-[var(--chat-accent)]" />
            <p className="text-[13px] text-[var(--chat-text-secondary)]">
              Establishing connection…
            </p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--chat-accent)] px-4 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
            >
              <RefreshCw className="size-4" />
              Try again
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-xl border border-[var(--chat-border-strong)] px-4 py-3 text-[14px] text-[var(--chat-text-secondary)] transition-colors hover:bg-[var(--chat-accent-soft)]"
            >
              Clear session &amp; show QR
            </button>
          </div>
        )}

        {!isError && status === 'connected' && (
          <p className="text-center text-[14px] text-[var(--chat-green)]">
            Connected — loading messages…
          </p>
        )}
      </div>

      <p className="mt-6 max-w-md text-center text-[11px] leading-relaxed text-[var(--chat-text-tertiary)]">
        Unofficial client — not affiliated with WhatsApp. Using an unofficial
        WhatsApp library may violate WhatsApp Terms of Service; account ban risk applies.
      </p>
    </div>
  )
}
