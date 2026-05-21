import type { Chat, Contact } from '@whiskeysockets/baileys'
import type { ChatFilter, ChatSummary, MessageRecord } from '../../../src/shared/ipc'
import { getDb } from './index'
import {
  chatJidIsGroup,
  formatPhoneFromJid,
  getMessageText,
  getMessageTimestamp,
  isRenderableChatJid,
  mapReceiptStatus,
  messageIdFromKey,
  resolveChatJid,
  resolveSenderId,
  resolveSenderName,
} from '../baileys/message-utils'
import type { WAMessage } from '@whiskeysockets/baileys'

const MESSAGE_PAGE_SIZE = 50

interface ChatRow {
  jid: string
  title: string
  is_group: number
  last_message: string | null
  last_message_time: number | null
  unread_count: number
  participant_count: number | null
}

interface MessageRow {
  id: string
  chat_jid: string
  sender_id: string
  sender_name: string
  text: string | null
  timestamp: number
  status: string | null
  is_from_me: number
}

function getContactNameMap(): Map<string, string> {
  const rows = getDb()
    .prepare('SELECT jid, name, push_name FROM contacts')
    .all() as { jid: string; name: string | null; push_name: string | null }[]

  const map = new Map<string, string>()
  for (const row of rows) {
    const label = row.name?.trim() || row.push_name?.trim()
    if (label) map.set(row.jid, label)
  }
  return map
}

export function upsertContact(contact: Contact): void {
  if (!contact.id) return
  getDb()
    .prepare(
      `INSERT INTO contacts (jid, name, push_name, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         name = COALESCE(excluded.name, contacts.name),
         push_name = COALESCE(excluded.push_name, contacts.push_name),
         updated_at = excluded.updated_at`,
    )
    .run(
      contact.id,
      contact.name ?? null,
      contact.notify ?? contact.verifiedName ?? null,
      Date.now(),
    )
}

export function upsertContacts(contacts: Contact[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO contacts (jid, name, push_name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       name = COALESCE(excluded.name, contacts.name),
       push_name = COALESCE(excluded.push_name, contacts.push_name),
       updated_at = excluded.updated_at`,
  )
  const tx = getDb().transaction((items: Contact[]) => {
    for (const c of items) {
      if (!c.id) continue
      stmt.run(
        c.id,
        c.name ?? null,
        c.notify ?? c.verifiedName ?? null,
        Date.now(),
      )
    }
  })
  tx(contacts)
}

function resolveChatTitle(chat: Chat, contactNames: Map<string, string>): string {
  const jid = chat.id ?? ''
  const stored = chat.name?.trim()
  if (stored) return stored
  if (chatJidIsGroup(jid)) return stored || 'Group'
  return contactNames.get(jid) ?? formatPhoneFromJid(jid)
}

export function upsertChatFromBaileys(chat: Chat): void {
  const jid = chat.id
  if (!isRenderableChatJid(jid)) return

  const contactNames = getContactNameMap()
  const title = resolveChatTitle(chat, contactNames)
  const isGroup = chatJidIsGroup(jid) ? 1 : 0
  const lastTime = chat.conversationTimestamp
    ? Number(chat.conversationTimestamp) * 1000
    : null

  getDb()
    .prepare(
      `INSERT INTO chats (jid, title, is_group, last_message, last_message_time, unread_count, participant_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         title = excluded.title,
         is_group = excluded.is_group,
         last_message_time = COALESCE(excluded.last_message_time, chats.last_message_time),
         unread_count = excluded.unread_count,
         updated_at = excluded.updated_at`,
    )
    .run(
      jid,
      title,
      isGroup,
      null,
      lastTime,
      chat.unreadCount ?? 0,
      null,
      Date.now(),
    )
}

export function upsertChatsFromBaileys(chats: Chat[]): void {
  for (const chat of chats) upsertChatFromBaileys(chat)
}

export function upsertMessageFromBaileys(msg: WAMessage, meId: string): MessageRecord | null {
  const chatJid = resolveChatJid(msg)
  if (!isRenderableChatJid(chatJid)) return null

  const text = getMessageText(msg)
  if (!text && !msg.key.fromMe) {
    // Skip empty protocol messages
    const hasContent = Boolean(msg.message)
    if (!hasContent) return null
  }

  const contactNames = getContactNameMap()
  const id = messageIdFromKey(msg)
  const senderId = resolveSenderId(msg, meId)
  const senderName = resolveSenderName(msg, meId, contactNames)
  const timestamp = getMessageTimestamp(msg)
  const isFromMe = msg.key.fromMe ? 1 : 0
  const rawStatus =
    typeof msg.status === 'number' ? msg.status : undefined
  const status = msg.key.fromMe ? mapReceiptStatus(rawStatus) : undefined

  getDb()
    .prepare(
      `INSERT INTO messages (id, chat_jid, sender_id, sender_name, text, timestamp, status, is_from_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text = COALESCE(excluded.text, messages.text),
         status = COALESCE(excluded.status, messages.status),
         sender_name = COALESCE(excluded.sender_name, messages.sender_name)`,
    )
    .run(id, chatJid, senderId, senderName, text ?? null, timestamp, status ?? null, isFromMe)

  const preview = formatLastMessagePreview(text, senderName, chatJidIsGroup(chatJid), Boolean(isFromMe))

  getDb()
    .prepare(
      `INSERT INTO chats (jid, title, is_group, last_message, last_message_time, unread_count, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(jid) DO UPDATE SET
         last_message = excluded.last_message,
         last_message_time = excluded.last_message_time,
         updated_at = excluded.updated_at`,
    )
    .run(
      chatJid,
      getChatTitle(chatJid, contactNames),
      chatJidIsGroup(chatJid) ? 1 : 0,
      preview,
      timestamp,
      Date.now(),
    )

  return rowToMessageRecord({
    id,
    chat_jid: chatJid,
    sender_id: senderId,
    sender_name: senderName,
    text: text ?? null,
    timestamp,
    status: status ?? null,
    is_from_me: isFromMe,
  })
}

export function upsertMessagesFromBaileys(messages: WAMessage[], meId: string): void {
  const tx = getDb().transaction((msgs: WAMessage[]) => {
    for (const msg of msgs) upsertMessageFromBaileys(msg, meId)
  })
  tx(messages)
}

function formatLastMessagePreview(
  text: string | undefined,
  senderName: string,
  isGroup: boolean,
  fromMe: boolean,
): string {
  const body = text?.trim() || 'Message'
  if (isGroup && !fromMe) return `${senderName}: ${body}`
  return body
}

function getChatTitle(jid: string, contactNames: Map<string, string>): string {
  const row = getDb()
    .prepare('SELECT title FROM chats WHERE jid = ?')
    .get(jid) as { title: string } | undefined
  if (row?.title) return row.title
  if (chatJidIsGroup(jid)) return 'Group'
  return contactNames.get(jid) ?? formatPhoneFromJid(jid)
}

export function setGroupParticipantCount(jid: string, count: number): void {
  getDb()
    .prepare(
      `UPDATE chats SET participant_count = ?, updated_at = ? WHERE jid = ?`,
    )
    .run(count, Date.now(), jid)
}

export function deleteChats(jids: string[]): void {
  const stmt = getDb().prepare('DELETE FROM chats WHERE jid = ?')
  const delMsgs = getDb().prepare('DELETE FROM messages WHERE chat_jid = ?')
  const tx = getDb().transaction((ids: string[]) => {
    for (const jid of ids) {
      delMsgs.run(jid)
      stmt.run(jid)
    }
  })
  tx(jids)
}

export function listChatsFromDb(filter: ChatFilter, search?: string): ChatSummary[] {
  let sql = 'SELECT * FROM chats WHERE 1=1'
  const params: (string | number)[] = []

  if (filter === 'dm') sql += ' AND is_group = 0'
  else if (filter === 'group') sql += ' AND is_group = 1'

  if (search?.trim()) {
    sql += ' AND (title LIKE ? OR last_message LIKE ?)'
    const q = `%${search.trim()}%`
    params.push(q, q)
  }

  sql += ' ORDER BY COALESCE(last_message_time, 0) DESC'

  const rows = getDb().prepare(sql).all(...params) as ChatRow[]

  return rows.map((row) => ({
    id: row.jid,
    jid: row.jid,
    title: row.title,
    isGroup: row.is_group === 1,
    lastMessage: row.last_message ?? undefined,
    lastMessageTime: row.last_message_time ?? undefined,
    unreadCount: row.unread_count,
  }))
}

function rowToMessageRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatJid: row.chat_jid,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text ?? undefined,
    timestamp: row.timestamp,
    status: (row.status as MessageRecord['status']) ?? undefined,
    isFromMe: row.is_from_me === 1,
  }
}

export function listMessagesFromDb(
  jid: string,
  cursor?: string,
): { messages: MessageRecord[]; nextCursor?: string } {
  const limit = MESSAGE_PAGE_SIZE

  let rows: MessageRow[]
  if (cursor) {
    const before = parseInt(cursor, 10)
    rows = getDb()
      .prepare(
        `SELECT * FROM messages WHERE chat_jid = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(jid, before, limit) as MessageRow[]
  } else {
    rows = getDb()
      .prepare(
        `SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(jid, limit) as MessageRow[]
  }

  const messages = rows.reverse().map(rowToMessageRecord)
  const oldest = rows[rows.length - 1]
  const nextCursor =
    rows.length >= limit && oldest ? String(oldest.timestamp) : undefined

  return { messages, nextCursor }
}

export function getMessageFromDb(key: {
  remoteJid?: string | null
  id?: string | null
  fromMe?: boolean | null
  participant?: string | null
}): WAMessage | undefined {
  if (!key.remoteJid || !key.id) return undefined
  const id = `${key.remoteJid}:${key.id}:${key.fromMe ? 1 : 0}:${key.participant ?? ''}`
  const row = getDb()
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(id) as MessageRow | undefined
  if (!row) return undefined
  // Minimal stub for Baileys getMessage — full proto not stored in Phase 2
  return undefined
}
