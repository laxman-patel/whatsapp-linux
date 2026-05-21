import {
  extractMessageContent,
  getChatId,
  isJidGroup,
  jidNormalizedUser,
  type WAMessage,
} from '@whiskeysockets/baileys'

export function isRenderableChatJid(jid: string | null | undefined): jid is string {
  if (!jid) return false
  if (jid === 'status@broadcast') return false
  if (jid.endsWith('@newsletter')) return false
  if (jid.endsWith('@broadcast')) return false
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us')
}

export function messageIdFromKey(msg: WAMessage): string {
  const { remoteJid, id, fromMe, participant } = msg.key
  return `${remoteJid}:${id}:${fromMe ? 1 : 0}:${participant ?? ''}`
}

export function getMessageText(msg: WAMessage): string | undefined {
  const content = extractMessageContent(msg.message)
  if (!content) return undefined

  if (content.conversation) return content.conversation
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text
  if (content.imageMessage) {
    return content.imageMessage.caption?.trim() || 'Photo'
  }
  if (content.videoMessage) {
    return content.videoMessage.caption?.trim() || 'Video'
  }
  if (content.audioMessage) {
    return content.audioMessage.ptt ? 'Voice message' : 'Audio'
  }
  if (content.documentMessage) {
    return content.documentMessage.fileName || 'Document'
  }
  if (content.stickerMessage) return 'Sticker'
  if (content.contactMessage) return 'Contact'
  if (content.locationMessage) return 'Location'
  if (content.pollCreationMessage) return 'Poll'
  if (content.reactionMessage) return 'Reaction'

  return 'Message'
}

export function getMessageTimestamp(msg: WAMessage): number {
  const ts = msg.messageTimestamp
  if (typeof ts === 'number') return ts * 1000
  if (typeof ts === 'object' && ts !== null && 'toNumber' in ts) {
    return (ts as { toNumber: () => number }).toNumber() * 1000
  }
  return Date.now()
}

export function resolveSenderId(msg: WAMessage, meId: string): string {
  if (msg.key.fromMe) return meId
  const participant = msg.key.participant ?? msg.key.remoteJid
  return jidNormalizedUser(participant ?? 'unknown')
}

export function resolveSenderName(
  msg: WAMessage,
  meId: string,
  contactNames: Map<string, string>,
): string {
  if (msg.key.fromMe) return 'You'
  const senderId = resolveSenderId(msg, meId)
  const pushName = msg.pushName?.trim()
  if (pushName) return pushName
  return contactNames.get(senderId) ?? formatPhoneFromJid(senderId)
}

export function formatPhoneFromJid(jid: string): string {
  const user = jid.split('@')[0] ?? jid
  return user.replace(/:\d+$/, '')
}

export function resolveChatJid(msg: WAMessage): string {
  return getChatId(msg.key)
}

export function chatJidIsGroup(jid: string): boolean {
  return Boolean(isJidGroup(jid))
}

export function mapReceiptStatus(
  status?: number,
): 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | undefined {
  // Baileys / proto ack levels vary; treat 3+ as read, 2 as delivered
  if (status === undefined || status === null) return undefined
  if (status >= 4) return 'read'
  if (status >= 3) return 'delivered'
  if (status >= 2) return 'sent'
  if (status >= 1) return 'sent'
  if (status < 0) return 'failed'
  return 'sent'
}
