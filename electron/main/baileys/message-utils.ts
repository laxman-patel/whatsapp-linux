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
  const { remoteJid, id, fromMe } = msg.key
  return `${remoteJid}:${id}:${fromMe ? 1 : 0}:${getRawParticipant(msg) ?? ''}`
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

  return undefined
}

export function getMessageTimestamp(msg: WAMessage): number {
  const ts = msg.messageTimestamp
  if (typeof ts === 'number') return ts * 1000
  if (typeof ts === 'object' && ts !== null && 'toNumber' in ts) {
    return (ts as { toNumber: () => number }).toNumber() * 1000
  }
  return Date.now()
}

/** Parse participant JID embedded in our composite message id. */
export function parseParticipantFromMessageId(id: string): string | null {
  const match = id.match(/^(.+):([^:]+):([01]):(.*)$/)
  if (!match) return null
  const participant = match[4]?.trim()
  return participant || null
}

function normalizeParticipantJid(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'unknown@s.whatsapp.net'
  if (trimmed.includes('@')) return jidNormalizedUser(trimmed)
  return jidNormalizedUser(`${trimmed}@s.whatsapp.net`)
}

function getRawParticipant(msg: WAMessage): string | undefined {
  const key = msg.key
  const topLevel = msg.participant?.trim()
  const phoneParticipant = key.participantPn?.trim()
  const keyParticipant = key.participant?.trim()
  const lidParticipant = key.participantLid?.trim()

  // Prefer the phone-number participant where Baileys exposes it. `participant`
  // can be a LID on newer accounts, while `participantPn` maps to saved contacts
  // and profile-picture fetches more reliably.
  return (
    phoneParticipant ||
    (keyParticipant?.endsWith('@s.whatsapp.net') ? keyParticipant : undefined) ||
    (topLevel?.endsWith('@s.whatsapp.net') ? topLevel : undefined) ||
    keyParticipant ||
    topLevel ||
    lidParticipant
  )
}

export function getMessageContactAlias(
  msg: WAMessage,
): { lid: string; jid: string } | null {
  const key = msg.key
  const candidates = [
    key.participant?.trim(),
    key.participantPn?.trim(),
    key.participantLid?.trim(),
    msg.participant?.trim(),
  ].filter(Boolean) as string[]

  const lid = candidates.find((candidate) => candidate.endsWith('@lid'))
  const jid = candidates.find((candidate) => candidate.endsWith('@s.whatsapp.net'))
  if (!lid || !jid) return null
  return { lid: normalizeParticipantJid(lid), jid: normalizeParticipantJid(jid) }
}

function resolveGroupParticipantJid(msg: WAMessage): string | null {
  const raw = getRawParticipant(msg)
  if (!raw) return null
  return normalizeParticipantJid(raw)
}

export function isLabelGroupSubject(label: string | undefined, chatTitle?: string): boolean {
  if (!label?.trim() || !chatTitle?.trim()) return false
  return label.trim().toLowerCase() === chatTitle.trim().toLowerCase()
}

/** Digits-only phone user part from a WhatsApp JID (or null). */
export function phoneDigitsFromJid(jid: string): string | null {
  if (!jid.includes('@')) return null
  const user = jid.split('@')[0] ?? ''
  const digits = user.replace(/:\d+$/, '').replace(/\D/g, '')
  return digits.length >= 8 ? digits : null
}

/** True when a label is basically a phone number, not a saved/display name. */
export function looksLikePhoneLabel(label: string): boolean {
  const t = label.trim().replace(/[\s\-()]/g, '')
  if (!t) return false
  return /^\+?\d{8,}$/.test(t)
}

/**
 * Look up a saved contact name by JID, phone digits, or suffix match
 * (handles LID vs @s.whatsapp.net and country-code variants).
 */
export function lookupContactDisplayName(
  senderJid: string,
  contactNames: Map<string, string>,
  chatTitle?: string,
): string | undefined {
  const tryKey = (key: string | null | undefined): string | undefined => {
    if (!key) return undefined
    const label = contactNames.get(key)?.trim()
    if (!label || isLabelGroupSubject(label, chatTitle)) return undefined
    return label
  }

  const direct = tryKey(senderJid)
  if (direct) return direct

  const digits = phoneDigitsFromJid(senderJid)
  if (!digits) return undefined

  const byFull = tryKey(digits)
  if (byFull) return byFull

  // India / intl: match on last 10 digits when country codes differ.
  if (digits.length > 10) {
    const bySuffix = tryKey(digits.slice(-10))
    if (bySuffix) return bySuffix
  }

  for (const [key, label] of contactNames) {
    if (isLabelGroupSubject(label, chatTitle)) continue
    const keyDigits = phoneDigitsFromJid(key) ?? (/^\d{8,}$/.test(key) ? key : null)
    if (!keyDigits) continue
    if (keyDigits === digits || keyDigits.endsWith(digits) || digits.endsWith(keyDigits)) {
      return label.trim()
    }
  }

  return undefined
}

/** @deprecated use lookupContactDisplayName */
export function getSenderDisplayName(
  senderJid: string,
  contactNames: Map<string, string>,
  chatTitle?: string,
): string | undefined {
  return lookupContactDisplayName(senderJid, contactNames, chatTitle)
}

export function resolveSenderId(msg: WAMessage, meId: string): string {
  if (msg.key.fromMe) return meId
  const chatJid = resolveChatJid(msg)
  if (chatJidIsGroup(chatJid)) {
    const participant = resolveGroupParticipantJid(msg)
    if (participant && !participant.endsWith('@g.us')) return participant
    const fromId = parseParticipantFromMessageId(messageIdFromKey(msg))
    if (fromId && !fromId.endsWith('@g.us')) return normalizeParticipantJid(fromId)
    return 'unknown@s.whatsapp.net'
  }
  const participant = msg.key.participant ?? msg.key.remoteJid
  return jidNormalizedUser(participant ?? 'unknown')
}

export function resolveSenderName(
  msg: WAMessage,
  meId: string,
  contactNames: Map<string, string>,
  chatTitle?: string,
): string {
  if (msg.key.fromMe) return 'You'
  const chatJid = resolveChatJid(msg)
  const senderId = resolveSenderId(msg, meId)
  const pushName = msg.pushName?.trim()
  const isGroup = chatJidIsGroup(chatJid)

  const fromContact = lookupContactDisplayName(senderId, contactNames, chatTitle)
  if (fromContact) return fromContact

  // In groups, pushName is often the group subject during history sync — skip it then.
  if (pushName && !(isGroup && isLabelGroupSubject(pushName, chatTitle))) {
    return pushName
  }

  return formatPhoneFromJid(senderId)
}

/** Best-effort display name for a stored group message row. */
export function resolveStoredGroupSenderName(
  row: { id: string; sender_id: string; sender_name: string },
  contactNames: Map<string, string>,
  chatTitle?: string,
): { senderId: string; senderName: string } {
  let senderId = row.sender_id
  if (
    !senderId.endsWith('@s.whatsapp.net') ||
    senderId === 'unknown@s.whatsapp.net' ||
    senderId.endsWith('@g.us')
  ) {
    const fromId = parseParticipantFromMessageId(row.id)
    if (fromId && !fromId.endsWith('@g.us')) {
      senderId = normalizeParticipantJid(fromId)
    }
  }

  const fromContact = lookupContactDisplayName(senderId, contactNames, chatTitle)
  if (fromContact) {
    return { senderId, senderName: fromContact }
  }

  if (isLabelGroupSubject(row.sender_name, chatTitle)) {
    return { senderId, senderName: formatPhoneFromJid(senderId) }
  }

  const stored = row.sender_name.trim()
  const phoneFallback = formatPhoneFromJid(senderId)
  // Re-resolve when DB still has a bare number from an earlier sync pass.
  if (
    stored &&
    stored.toLowerCase() !== 'unknown sender' &&
    !looksLikePhoneLabel(stored) &&
    !isLabelGroupSubject(stored, chatTitle) &&
    stored.toLowerCase() !== phoneFallback.toLowerCase()
  ) {
    return { senderId, senderName: stored }
  }

  return { senderId, senderName: phoneFallback }
}

export function formatPhoneFromJid(jid: string): string {
  if (jid.endsWith('@lid')) return 'WhatsApp contact'
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
