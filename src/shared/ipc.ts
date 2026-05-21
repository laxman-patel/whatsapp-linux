export type ChatFilter = 'all' | 'dm' | 'group'
export type ColorScheme = 'light' | 'dark' | 'system'

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr'
  | 'connected'
  | 'error'

export interface ChatSummary {
  id: string
  jid: string
  title: string
  isGroup: boolean
  lastMessage?: string
  lastMessageTime?: number
  unreadCount: number
  avatarUrl?: string
}

export interface MessageRecord {
  id: string
  chatJid: string
  senderId: string
  senderName: string
  text?: string
  timestamp: number
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  isFromMe: boolean
}

export interface AppSettings {
  chatFilter: ChatFilter
  colorScheme: ColorScheme
}

export interface ConnectionPayload {
  status: ConnectionStatus
  message?: string
}

export type SyncPhase = 'idle' | 'history' | 'contacts' | 'messages' | 'finalizing'

export interface SyncProgressPayload {
  active: boolean
  progress: number
  phase: SyncPhase
  message: string
  chatsSynced?: number
  messagesSynced?: number
  contactsSynced?: number
  currentChunkMessages?: number
  deferredMessages?: number
  importRatePerSecond?: number
  elapsedMs?: number
}

export interface IpcApi {
  getSettings: () => Promise<AppSettings>
  setChatFilter: (filter: ChatFilter) => Promise<void>
  setColorScheme: (scheme: ColorScheme) => Promise<void>
  getAuthStatus: () => Promise<ConnectionPayload>
  authLogout: () => Promise<void>
  authRetry: () => Promise<void>
  listChats: (filter: ChatFilter, search?: string) => Promise<ChatSummary[]>
  openChat: (jid: string) => Promise<{ participantCount?: number } | null>
  listMessages: (jid: string, cursor?: string) => Promise<{
    messages: MessageRecord[]
    nextCursor?: string
  }>
  sendText: (jid: string, text: string) => Promise<MessageRecord>
  getSyncProgress: () => Promise<SyncProgressPayload>
  onConnectionUpdate: (cb: (payload: ConnectionPayload) => void) => () => void
  onSyncUpdate: (cb: (payload: SyncProgressPayload) => void) => () => void
  onAuthQr: (cb: (dataUrl: string) => void) => () => void
  onChatsUpdated: (cb: () => void) => () => void
  onMessagesUpdated: (cb: (jid: string) => void) => () => void
}

export const IPC_CHANNELS = {
  settingsGet: 'settings:get',
  settingsSetFilter: 'settings:set-filter',
  settingsSetColorScheme: 'settings:set-color-scheme',
  authStatus: 'auth:status',
  authLogout: 'auth:logout',
  authRetry: 'auth:retry',
  authQr: 'auth:qr',
  chatsList: 'chats:list',
  chatOpen: 'chat:open',
  messagesList: 'messages:list',
  messagesSendText: 'messages:send-text',
  connectionUpdate: 'connection:update',
  syncGet: 'sync:get',
  syncUpdate: 'sync:update',
  chatsUpdated: 'chats:updated',
  messagesUpdated: 'messages:updated',
} as const
