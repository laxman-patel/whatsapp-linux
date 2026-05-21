export type ChatFilter = 'all' | 'dm' | 'group'

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

export interface IpcApi {
  getSettings: () => Promise<{ chatFilter: ChatFilter }>
  setChatFilter: (filter: ChatFilter) => Promise<void>
  getAuthStatus: () => Promise<{ status: ConnectionStatus; message?: string }>
  listChats: (filter: ChatFilter, search?: string) => Promise<ChatSummary[]>
  openChat: (jid: string) => Promise<{ participantCount?: number } | null>
  listMessages: (jid: string, cursor?: string) => Promise<{
    messages: MessageRecord[]
    nextCursor?: string
  }>
  sendText: (jid: string, text: string) => Promise<MessageRecord>
  onConnectionUpdate: (cb: (status: ConnectionStatus) => void) => () => void
  onChatsUpdated: (cb: () => void) => () => void
  onMessagesUpdated: (cb: (jid: string) => void) => () => void
}

export const IPC_CHANNELS = {
  settingsGet: 'settings:get',
  settingsSetFilter: 'settings:set-filter',
  authStatus: 'auth:status',
  chatsList: 'chats:list',
  chatOpen: 'chat:open',
  messagesList: 'messages:list',
  messagesSendText: 'messages:send-text',
  connectionUpdate: 'connection:update',
  chatsUpdated: 'chats:updated',
  messagesUpdated: 'messages:updated',
} as const
