import { IPC_CHANNELS, type SyncProgressPayload } from '../../src/shared/ipc'
import { broadcast } from './broadcast'

const IDLE: SyncProgressPayload = {
  active: false,
  progress: 100,
  phase: 'idle',
  message: '',
}

let state: SyncProgressPayload = { ...IDLE }
let syncStartedAt = 0
let lastEmitAt = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let chatNotifyTimer: ReturnType<typeof setTimeout> | null = null
let messageNotifyTimer: ReturnType<typeof setTimeout> | null = null
const pendingMessageJids = new Set<string>()

function emit() {
  lastEmitAt = Date.now()
  broadcast(IPC_CHANNELS.syncUpdate, { ...state })
}

export function getSyncProgress(): SyncProgressPayload {
  return { ...state }
}

export function beginSync() {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  syncStartedAt = Date.now()
  state = {
    active: true,
    progress: 0,
    phase: 'history',
    message: 'Syncing with WhatsApp…',
    chatsSynced: 0,
    messagesSynced: 0,
    contactsSynced: 0,
  }
  emit()
}

export function updateSyncProgress(partial: Partial<SyncProgressPayload>) {
  if (!state.active && partial.active !== true) return
  state = { ...state, ...partial }
  if (Date.now() - lastEmitAt > 120 || partial.progress === 100) {
    emit()
  }
}

export function recordHistoryChunk(stats: {
  chats?: number
  messages?: number
  contacts?: number
  progress?: number | null
  isLatest?: boolean
}) {
  if (!state.active) beginSync()

  const chatsSynced = (state.chatsSynced ?? 0) + (stats.chats ?? 0)
  const messagesSynced = (state.messagesSynced ?? 0) + (stats.messages ?? 0)
  const contactsSynced = (state.contactsSynced ?? 0) + (stats.contacts ?? 0)
  const elapsedMs = Math.max(1, Date.now() - syncStartedAt)
  const importRatePerSecond = Math.round((messagesSynced / elapsedMs) * 1000)

  let progress = state.progress
  if (typeof stats.progress === 'number' && !Number.isNaN(stats.progress)) {
    progress = Math.min(100, Math.max(0, Math.round(stats.progress)))
  } else if (messagesSynced > 0) {
    // Indeterminate-ish advance when server omits progress
    progress = Math.min(95, progress + 2)
  }

  const phase =
    messagesSynced > 0 ? 'messages' : chatsSynced > 0 ? 'history' : 'history'

  updateSyncProgress({
    active: true,
    progress,
    phase,
    chatsSynced,
    messagesSynced,
    contactsSynced,
    currentChunkMessages: stats.messages ?? 0,
    importRatePerSecond,
    elapsedMs,
    message: buildMessage(messagesSynced, chatsSynced, progress, importRatePerSecond),
  })

  if (stats.isLatest && progress >= 100) {
    finishSync()
  }
}

export function onHistorySyncComplete() {
  finishSync()
}

function buildMessage(
  messages: number,
  chats: number,
  progress: number,
  rate: number,
): string {
  if (messages > 0) {
    const rateText = rate > 0 ? ` · ${rate.toLocaleString()}/sec` : ''
    return `Syncing messages… ${messages.toLocaleString()} imported (${progress}%)${rateText}`
  }
  if (chats > 0) {
    return `Syncing conversations… ${chats.toLocaleString()} chats (${progress}%)`
  }
  return `Syncing with WhatsApp… ${progress}%`
}

function finishSync() {
  if (idleTimer) clearTimeout(idleTimer)
  state = {
    active: true,
    progress: 100,
    phase: 'finalizing',
    message: 'Finishing sync…',
    chatsSynced: state.chatsSynced,
    messagesSynced: state.messagesSynced,
    contactsSynced: state.contactsSynced,
  }
  emit()

  idleTimer = setTimeout(() => {
    state = { ...IDLE }
    emit()
    flushPendingNotifications()
    idleTimer = null
  }, 600)
}

/** If no history events arrive, stop showing sync UI after connect */
export function scheduleSyncIdleFallback(ms = 8000) {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (state.active && Date.now() - syncStartedAt > ms - 500) {
      state = { ...IDLE }
      emit()
      flushPendingNotifications()
    }
    idleTimer = null
  }, ms)
}

export function resetSyncProgress() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  state = { ...IDLE }
  emit()
}

export function isSyncing(): boolean {
  return state.active
}

export function scheduleChatsNotify(immediate = false) {
  if (immediate || !state.active) {
    if (chatNotifyTimer) clearTimeout(chatNotifyTimer)
    chatNotifyTimer = null
    broadcast(IPC_CHANNELS.chatsUpdated)
    return
  }
  if (chatNotifyTimer) return
  chatNotifyTimer = setTimeout(() => {
    broadcast(IPC_CHANNELS.chatsUpdated)
    chatNotifyTimer = null
  }, 350)
}

export function scheduleMessagesNotify(jid: string, immediate = false) {
  if (immediate || !state.active) {
    broadcast(IPC_CHANNELS.messagesUpdated, jid)
    return
  }
  pendingMessageJids.add(jid)
  if (messageNotifyTimer) return
  messageNotifyTimer = setTimeout(() => {
    for (const id of pendingMessageJids) {
      broadcast(IPC_CHANNELS.messagesUpdated, id)
    }
    pendingMessageJids.clear()
    messageNotifyTimer = null
  }, 350)
}

function flushPendingNotifications() {
  scheduleChatsNotify(true)
  for (const jid of pendingMessageJids) {
    broadcast(IPC_CHANNELS.messagesUpdated, jid)
  }
  pendingMessageJids.clear()
}
