/** Protocol-agnostic shapes used by the DB layer (formerly Baileys types). */

export interface ProtocolMessageKey {
  remoteJid: string
  id: string
  fromMe: boolean
  participant?: string
  participantPn?: string
  participantLid?: string
}

export interface ProtocolMessage {
  key: ProtocolMessageKey
  message?: Record<string, unknown>
  messageTimestamp?: number | { toNumber?: () => number }
  pushName?: string
  participant?: string
  status?: number
}

export interface ProtocolChat {
  id: string
  name?: string | null
  conversationTimestamp?: number | null
  unreadCount?: number
}

export interface ProtocolContact {
  id?: string | null
  jid?: string | null
  lid?: string | null
  name?: string | null
  notify?: string | null
  verifiedName?: string | null
}
