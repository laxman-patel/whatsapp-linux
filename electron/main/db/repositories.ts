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
  avatar_path: string | null
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

function rememberMessageSenderName(msg: WAMessage, chatJid: string): void {
  if (msg.key.fromMe) return
  const pushName = msg.pushName?.trim()
  if (!pushName) return

  const senderJid = resolveSenderId(msg, '')
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO contacts (jid, name, push_name, updated_at)
       VALUES (?, NULL, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         push_name = COALESCE(contacts.push_name, excluded.push_name),
         updated_at = excluded.updated_at`,
    )
    .run(senderJid, pushName, now)

  if (!chatJidIsGroup(chatJid)) {
    getDb()
      .prepare(
        `UPDATE chats
         SET title = ?, updated_at = ?
         WHERE jid = ? AND (title = ? OR title = ? OR title GLOB '[0-9]*')`,
      )
      .run(pushName, now, chatJid, chatJid, formatPhoneFromJid(chatJid))
  }
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
  const fixDmTitle = getDb().prepare(
    `UPDATE chats SET title = ?, updated_at = ?
     WHERE jid = ? AND is_group = 0
       AND (title = ? OR title = ? OR title GLOB '[0-9]*')`,
  )
  const tx = getDb().transaction((items: Contact[]) => {
    const now = Date.now()
    for (const c of items) {
      if (!c.id) continue
      const displayName =
        c.name?.trim() || c.notify?.trim() || c.verifiedName?.trim() || null
      stmt.run(
        c.id,
        c.name ?? null,
        c.notify ?? c.verifiedName ?? null,
        now,
      )
      // Patch the DM chat title in the same transaction so the sidebar
      // refreshes from numbers to names immediately.
      if (displayName && !chatJidIsGroup(c.id)) {
        fixDmTitle.run(
          displayName,
          now,
          c.id,
          c.id,
          formatPhoneFromJid(c.id),
        )
      }
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

export function upsertGroupInfo(group: {
  id: string
  subject?: string | null
  participants?: unknown[] | null
}): void {
  if (!isRenderableChatJid(group.id) || !chatJidIsGroup(group.id)) return

  const title = group.subject?.trim() || 'Group'
  const participantCount = group.participants?.length ?? null
  const now = Date.now()

  getDb()
    .prepare(
      `INSERT INTO chats (jid, title, is_group, unread_count, participant_count, updated_at)
       VALUES (?, ?, 1, 0, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         title = CASE
           WHEN excluded.title != 'Group' THEN excluded.title
           WHEN chats.title IS NULL OR chats.title = '' THEN excluded.title
           ELSE chats.title
         END,
         is_group = 1,
         participant_count = COALESCE(excluded.participant_count, chats.participant_count),
         updated_at = excluded.updated_at`,
    )
    .run(group.id, title, participantCount, now)
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

  // unreadCount is often omitted from partial chats.update payloads. Keep the
  // existing value when not provided so local increments aren't clobbered.
  const incomingUnread =
    typeof chat.unreadCount === 'number' ? chat.unreadCount : null

  getDb()
    .prepare(
      `INSERT INTO chats (jid, title, is_group, last_message, last_message_time, unread_count, participant_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         title = excluded.title,
         is_group = excluded.is_group,
         last_message_time = COALESCE(excluded.last_message_time, chats.last_message_time),
         unread_count = COALESCE(?, chats.unread_count),
         updated_at = excluded.updated_at`,
    )
    .run(
      jid,
      title,
      isGroup,
      null,
      lastTime,
      incomingUnread ?? 0,
      null,
      Date.now(),
      incomingUnread,
    )
}

export function upsertChatsFromBaileys(chats: Chat[]): void {
  if (chats.length === 0) return

  const contactNames = getContactNameMap()
  const stmt = getDb().prepare(
    `INSERT INTO chats (jid, title, is_group, last_message, last_message_time, unread_count, participant_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       title = CASE
         WHEN chats.title = 'Group' OR chats.title = excluded.jid OR chats.title GLOB '[0-9]*' THEN excluded.title
         ELSE chats.title
       END,
       is_group = excluded.is_group,
       last_message_time = COALESCE(excluded.last_message_time, chats.last_message_time),
       unread_count = COALESCE(?, chats.unread_count),
       updated_at = excluded.updated_at`,
  )
  const now = Date.now()
  const tx = getDb().transaction((items: Chat[]) => {
    for (const chat of items) {
      const jid = chat.id
      if (!isRenderableChatJid(jid)) continue
      const lastTime = chat.conversationTimestamp
        ? Number(chat.conversationTimestamp) * 1000
        : null
      const incomingUnread =
        typeof chat.unreadCount === 'number' ? chat.unreadCount : null
      stmt.run(
        jid,
        resolveChatTitle(chat, contactNames),
        chatJidIsGroup(jid) ? 1 : 0,
        null,
        lastTime,
        incomingUnread ?? 0,
        null,
        now,
        incomingUnread,
      )
    }
  })
  tx(chats)
}

/** Ensure parent chat row exists before inserting messages (FK constraint). */
function ensureChatRow(
  chatJid: string,
  contactNames: Map<string, string>,
  lastMessage?: string,
  lastMessageTime?: number,
): void {
  const title = getChatTitle(chatJid, contactNames)
  const isGroup = chatJidIsGroup(chatJid) ? 1 : 0
  const now = Date.now()

  getDb()
    .prepare(
      `INSERT INTO chats (jid, title, is_group, last_message, last_message_time, unread_count, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(jid) DO NOTHING`,
    )
    .run(chatJid, title, isGroup, lastMessage ?? null, lastMessageTime ?? null, now)

  if (lastMessage !== undefined || lastMessageTime !== undefined) {
    getDb()
      .prepare(
        `UPDATE chats SET
           last_message = COALESCE(?, last_message),
           last_message_time = COALESCE(?, last_message_time),
           updated_at = ?
         WHERE jid = ?`,
      )
      .run(lastMessage ?? null, lastMessageTime ?? null, now, chatJid)
  }
}

export function upsertMessageFromBaileys(msg: WAMessage, meId: string): MessageRecord | null {
  const chatJid = resolveChatJid(msg)
  if (!isRenderableChatJid(chatJid)) return null

  const text = getMessageText(msg)
  if (!text) return null

  const contactNames = getContactNameMap()
  const id = messageIdFromKey(msg)
  const senderId = resolveSenderId(msg, meId)
  const senderName = resolveSenderName(msg, meId, contactNames)
  const timestamp = getMessageTimestamp(msg)
  const isFromMe = msg.key.fromMe ? 1 : 0
  const rawStatus =
    typeof msg.status === 'number' ? msg.status : undefined
  const status = msg.key.fromMe ? mapReceiptStatus(rawStatus) : undefined

  const preview = formatLastMessagePreview(text, senderName, chatJidIsGroup(chatJid), Boolean(isFromMe))

  // Chat row must exist before message insert (messages.chat_jid → chats.jid FK)
  ensureChatRow(chatJid, contactNames, preview, timestamp)
  rememberMessageSenderName(msg, chatJid)

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

/**
 * Bulk import of WhatsApp history messages.
 *
 * Optimised for the initial sync:
 *  - one prepared INSERT OR IGNORE per row (history messages are immutable)
 *  - all chat row creations, message inserts, push-name upserts and
 *    last-message updates happen inside a single transaction
 *  - no per-row SELECTs, no FK fan-out
 */
export function bulkUpsertHistoryMessages(
  messages: WAMessage[],
  meId: string,
): number {
  if (messages.length === 0) return 0

  const db = getDb()
  const contactNames = getContactNameMap()
  const now = Date.now()

  interface PendingRow {
    id: string
    chatJid: string
    senderId: string
    senderName: string
    text: string
    timestamp: number
    status: string | null
    isFromMe: number
  }

  const rows: PendingRow[] = []
  const chatJids = new Set<string>()
  const chatLast = new Map<
    string,
    { preview: string; timestamp: number }
  >()
  const pushNames = new Map<string, string>()

  for (const msg of messages) {
    const chatJid = resolveChatJid(msg)
    if (!isRenderableChatJid(chatJid)) continue

    const text = getMessageText(msg)
    if (!text) continue

    const senderId = resolveSenderId(msg, meId)
    const senderName = resolveSenderName(msg, meId, contactNames)
    const timestamp = getMessageTimestamp(msg)
    const isFromMe = msg.key.fromMe ? 1 : 0
    const rawStatus =
      typeof msg.status === 'number' ? msg.status : undefined
    const status = msg.key.fromMe ? mapReceiptStatus(rawStatus) ?? null : null

    chatJids.add(chatJid)
    rows.push({
      id: messageIdFromKey(msg),
      chatJid,
      senderId,
      senderName,
      text,
      timestamp,
      status,
      isFromMe,
    })

    if (!msg.key.fromMe) {
      const pushName = msg.pushName?.trim()
      if (pushName) pushNames.set(senderId, pushName)
    }

    const previous = chatLast.get(chatJid)
    if (!previous || timestamp >= previous.timestamp) {
      chatLast.set(chatJid, {
        preview: formatLastMessagePreview(
          text,
          senderName,
          chatJidIsGroup(chatJid),
          Boolean(isFromMe),
        ),
        timestamp,
      })
    }
  }

  if (rows.length === 0) return 0

  const insertChat = db.prepare(
    `INSERT INTO chats (jid, title, is_group, last_message, last_message_time, unread_count, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 0, ?)
     ON CONFLICT(jid) DO NOTHING`,
  )
  const insertMsg = db.prepare(
    `INSERT OR IGNORE INTO messages
       (id, chat_jid, sender_id, sender_name, text, timestamp, status, is_from_me)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const updateLast = db.prepare(
    `UPDATE chats SET
       last_message = ?,
       last_message_time = ?,
       updated_at = ?
     WHERE jid = ? AND COALESCE(last_message_time, 0) <= ?`,
  )
  const upsertPushName = db.prepare(
    `INSERT INTO contacts (jid, name, push_name, updated_at)
     VALUES (?, NULL, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       push_name = COALESCE(contacts.push_name, excluded.push_name),
       updated_at = excluded.updated_at`,
  )
  const fixDmTitle = db.prepare(
    `UPDATE chats SET title = ?, updated_at = ?
     WHERE jid = ? AND is_group = 0
       AND (title = ? OR title = ? OR title GLOB '[0-9]*')`,
  )

  let inserted = 0

  const tx = db.transaction(() => {
    for (const jid of chatJids) {
      insertChat.run(
        jid,
        getFallbackChatTitle(jid, contactNames),
        chatJidIsGroup(jid) ? 1 : 0,
        now,
      )
    }

    for (const row of rows) {
      const result = insertMsg.run(
        row.id,
        row.chatJid,
        row.senderId,
        row.senderName,
        row.text,
        row.timestamp,
        row.status,
        row.isFromMe,
      )
      if (result.changes > 0) inserted++
    }

    for (const [jid, last] of chatLast) {
      updateLast.run(last.preview, last.timestamp, now, jid, last.timestamp)
    }

    for (const [jid, name] of pushNames) {
      upsertPushName.run(jid, name, now)
      if (!chatJidIsGroup(jid)) {
        fixDmTitle.run(name, now, jid, jid, formatPhoneFromJid(jid))
      }
    }
  })

  tx()
  return inserted
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

function getFallbackChatTitle(jid: string, contactNames: Map<string, string>): string {
  if (chatJidIsGroup(jid)) return 'Group'
  return contactNames.get(jid) ?? formatPhoneFromJid(jid)
}

export function setGroupParticipantCount(jid: string, count: number): void {
  if (!isRenderableChatJid(jid)) return
  ensureChatRow(jid, getContactNameMap())
  getDb()
    .prepare(
      `UPDATE chats SET participant_count = ?, updated_at = ? WHERE jid = ?`,
    )
    .run(count, Date.now(), jid)
}

export function listPlaceholderGroupJids(limit = 50): string[] {
  const rows = getDb()
    .prepare(
      `SELECT jid FROM chats
       WHERE is_group = 1 AND (title = 'Group' OR title IS NULL OR title = '')
       ORDER BY COALESCE(last_message_time, 0) DESC
       LIMIT ?`,
    )
    .all(limit) as { jid: string }[]

  return rows.map((row) => row.jid)
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
    avatarUrl: row.avatar_path ? `wa-avatar://${encodeURIComponent(row.jid)}` : undefined,
  }))
}

export function setChatAvatarPath(jid: string, filePath: string | null): void {
  getDb()
    .prepare(
      `UPDATE chats SET avatar_path = ?, updated_at = ? WHERE jid = ?`,
    )
    .run(filePath, Date.now(), jid)
}

export function getChatAvatarPath(jid: string): string | null {
  const row = getDb()
    .prepare(`SELECT avatar_path FROM chats WHERE jid = ?`)
    .get(jid) as { avatar_path: string | null } | undefined
  return row?.avatar_path ?? null
}

export function listChatsMissingAvatar(limit = 100): string[] {
  const rows = getDb()
    .prepare(
      `SELECT jid FROM chats
       WHERE avatar_path IS NULL
       ORDER BY COALESCE(last_message_time, 0) DESC
       LIMIT ?`,
    )
    .all(limit) as { jid: string }[]
  return rows.map((row) => row.jid)
}

export function markChatRead(jid: string): void {
  getDb()
    .prepare(
      `UPDATE chats SET unread_count = 0, updated_at = ? WHERE jid = ?`,
    )
    .run(Date.now(), jid)
}

export function incrementChatUnread(jid: string): void {
  getDb()
    .prepare(
      `UPDATE chats SET unread_count = unread_count + 1, updated_at = ? WHERE jid = ?`,
    )
    .run(Date.now(), jid)
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
