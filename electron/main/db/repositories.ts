import type { ProtocolChat, ProtocolContact, ProtocolMessage } from '../protocol/types'
import type { ChatFilter, ChatSummary, MessageRecord } from '../../../src/shared/ipc'
import { avatarUrlForJid } from '../../../src/shared/avatar'
import { getDb } from './index'
import {
  chatJidIsGroup,
  formatPhoneFromJid,
  getMessageContactAlias,
  getMessageText,
  getMessageTimestamp,
  isRenderableChatJid,
  mapReceiptStatus,
  messageIdFromKey,
  resolveChatJid,
  isLabelGroupSubject,
  phoneDigitsFromJid,
  resolveSenderId,
  resolveSenderName,
  resolveStoredGroupSenderName,
} from '../whatsmeow/message-utils'
import { jidNormalizedUser } from '../whatsmeow/jid'

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

/** All JID aliases for a contact (LID + phone may differ from `id`). */
function contactAliasKeys(c: {
  id?: string | null
  jid?: string | null
  lid?: string | null
}): string[] {
  const keys = new Set<string>()
  for (const raw of [c.id, c.jid, c.lid]) {
    if (!raw?.trim()) continue
    try {
      keys.add(jidNormalizedUser(raw.trim()))
    } catch {
      keys.add(raw.trim())
    }
  }
  return [...keys]
}

function indexContactLabel(
  map: Map<string, string>,
  jid: string,
  savedName: string | null | undefined,
  pushName: string | null | undefined,
): void {
  const name = savedName?.trim()
  const push = pushName?.trim()
  const label = name || push
  if (!label) return

  const existing = map.get(jid)
  if (!existing || name) map.set(jid, label)

  const digits = phoneDigitsFromJid(jid)
  if (digits) {
    const existingDigits = map.get(digits)
    if (!existingDigits || name) map.set(digits, label)
    if (digits.length > 10) {
      const last10 = digits.slice(-10)
      const existing10 = map.get(last10)
      if (!existing10 || name) map.set(last10, label)
    }
  }
}

function normalizeContactJid(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    return jidNormalizedUser(raw.trim())
  } catch {
    return raw.trim()
  }
}

export function linkContactAlias(lidRaw: string, jidRaw: string): string[] {
  const lid = normalizeContactJid(lidRaw)
  const jid = normalizeContactJid(jidRaw)
  if (!lid?.endsWith('@lid') || !jid?.endsWith('@s.whatsapp.net')) return []

  const db = getDb()
  const now = Date.now()

  db.prepare(
    `INSERT INTO contact_aliases (lid, jid, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(lid) DO UPDATE SET
       jid = excluded.jid,
       updated_at = excluded.updated_at`,
  ).run(lid, jid, now)

  const rows = db
    .prepare('SELECT jid, name, push_name FROM contacts WHERE jid IN (?, ?)')
    .all(lid, jid) as { jid: string; name: string | null; push_name: string | null }[]

  const phoneRow = rows.find((row) => row.jid === jid)
  const lidRow = rows.find((row) => row.jid === lid)
  const name = phoneRow?.name?.trim() || lidRow?.name?.trim() || null
  const pushName = phoneRow?.push_name?.trim() || lidRow?.push_name?.trim() || null
  if (!name && !pushName) return [lid, jid]

  const upsert = db.prepare(
    `INSERT INTO contacts (jid, name, push_name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       name = COALESCE(contacts.name, excluded.name),
       push_name = COALESCE(contacts.push_name, excluded.push_name),
       updated_at = excluded.updated_at`,
  )
  upsert.run(lid, name, pushName, now)
  upsert.run(jid, name, pushName, now)
  return [lid, jid]
}

function getContactNameMap(): Map<string, string> {
  const rows = getDb()
    .prepare('SELECT jid, name, push_name FROM contacts')
    .all() as { jid: string; name: string | null; push_name: string | null }[]

  const map = new Map<string, string>()
  for (const row of rows) {
    indexContactLabel(map, row.jid, row.name, row.push_name)
  }

  // If a DM title has already been resolved to a non-number, treat it as a
  // usable display name too. This catches names learned from chat/contact
  // updates even when the contacts row itself is still sparse.
  const dmTitles = getDb()
    .prepare('SELECT jid, title FROM chats WHERE is_group = 0')
    .all() as { jid: string; title: string }[]
  for (const row of dmTitles) {
    if (!looksLikeNumericChatTitle(row.title) && row.title !== row.jid) {
      indexContactLabel(map, row.jid, row.title, null)
    }
  }

  const aliases = getDb()
    .prepare('SELECT lid, jid FROM contact_aliases')
    .all() as { lid: string; jid: string }[]
  for (const alias of aliases) {
    const jidLabel = map.get(alias.jid)
    const lidLabel = map.get(alias.lid)
    if (jidLabel && !lidLabel) map.set(alias.lid, jidLabel)
    if (lidLabel && !jidLabel) {
      map.set(alias.jid, lidLabel)
      indexContactLabel(map, alias.jid, lidLabel, null)
    }
    if (!jidLabel && !lidLabel) {
      // A LID-only group sender is still better represented by its linked
      // phone number than by an opaque LID or generic "WhatsApp contact".
      map.set(alias.lid, formatPhoneFromJid(alias.jid))
    }
  }
  return map
}

function looksLikeNumericChatTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim()
  if (!trimmed) return true
  return /^\+?[\d\s\-()]{8,}$/.test(trimmed)
}

function resolveDmTitle(jid: string, storedTitle: string, contactNames: Map<string, string>): string {
  if (!looksLikeNumericChatTitle(storedTitle) && storedTitle !== jid) return storedTitle
  return contactNames.get(jid) ?? formatPhoneFromJid(jid)
}

export function repairDmChatTitles(): void {
  const contactNames = getContactNameMap()
  const rows = getDb()
    .prepare(
      `SELECT jid, title FROM chats
       WHERE is_group = 0
         AND (title = jid OR title GLOB '[0-9]*' OR title LIKE '+%')`,
    )
    .all() as { jid: string; title: string }[]

  if (rows.length === 0) return

  const update = getDb().prepare(
    `UPDATE chats SET title = ?, updated_at = ? WHERE jid = ?`,
  )
  const now = Date.now()
  const tx = getDb().transaction(() => {
    for (const row of rows) {
      const resolved = resolveDmTitle(row.jid, row.title, contactNames)
      if (resolved !== row.title) update.run(resolved, now, row.jid)
    }
  })
  tx()
}

function rememberMessageSenderName(msg: ProtocolMessage, chatJid: string): void {
  if (msg.key.fromMe) return
  const pushName = msg.pushName?.trim()
  if (!pushName) return

  const contactNames = getContactNameMap()
  const chatTitle = getChatTitle(chatJid, contactNames)
  // History sync sets pushName to the group subject — never store that on participants.
  if (chatJidIsGroup(chatJid) && isLabelGroupSubject(pushName, chatTitle)) return

  const senderJid = resolveSenderId(msg, '')
  if (
    (!senderJid.endsWith('@s.whatsapp.net') && !senderJid.endsWith('@lid')) ||
    senderJid === 'unknown@s.whatsapp.net'
  ) {
    return
  }
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

export function upsertContact(contact: ProtocolContact): void {
  upsertContacts([contact])
}

export function upsertContacts(contacts: ProtocolContact[]): void {
  const namedKeys = new Set<string>()
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
  const tx = getDb().transaction((items: ProtocolContact[]) => {
    const now = Date.now()
    for (const c of items) {
      const displayName =
        c.name?.trim() || c.notify?.trim() || c.verifiedName?.trim() || null
      const push = c.notify ?? c.verifiedName ?? null
      const keys = contactAliasKeys(c)
      if (keys.length === 0) continue

      for (const key of keys) {
        stmt.run(key, c.name ?? null, push, now)
        if (displayName) namedKeys.add(key)
        // Patch the DM chat title in the same transaction so the sidebar
        // refreshes from numbers to names immediately.
        if (displayName && !chatJidIsGroup(key) && key.endsWith('@s.whatsapp.net')) {
          fixDmTitle.run(
            displayName,
            now,
            key,
            key,
            formatPhoneFromJid(key),
          )
        }
      }

      const lid = keys.find((key) => key.endsWith('@lid'))
      const jid = keys.find((key) => key.endsWith('@s.whatsapp.net'))
      if (lid && jid) {
        for (const key of linkContactAlias(lid, jid)) namedKeys.add(key)
      }
    }
  })
  tx(contacts)
  repairGroupSenderNamesForJids([...namedKeys])
  repairDmChatTitles()
}

function resolveChatTitle(chat: ProtocolChat, contactNames: Map<string, string>): string {
  const jid = chat.id ?? ''
  const stored = chat.name?.trim()
  if (stored) return stored
  if (chatJidIsGroup(jid)) return stored || 'Group'
  return contactNames.get(jid) ?? formatPhoneFromJid(jid)
}

function upsertGroupParticipants(
  participants:
    | {
        id?: string | null
        jid?: string | null
        lid?: string | null
        name?: string | null
        notify?: string | null
      }[]
    | null
    | undefined,
  groupTitle: string,
): void {
  if (!participants?.length) return
  const touchedSenderJids = new Set<string>()
  const stmt = getDb().prepare(
    `INSERT INTO contacts (jid, name, push_name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       name = COALESCE(excluded.name, contacts.name),
       push_name = CASE
         WHEN excluded.push_name IS NOT NULL AND excluded.push_name != ? THEN excluded.push_name
         ELSE contacts.push_name
       END,
       updated_at = excluded.updated_at`,
  )
  const now = Date.now()
  for (const p of participants) {
    const keys = contactAliasKeys(p)
    const lid = keys.find((key) => key.endsWith('@lid'))
    const jid = keys.find((key) => key.endsWith('@s.whatsapp.net'))
    if (lid && jid) {
      for (const key of linkContactAlias(lid, jid)) touchedSenderJids.add(key)
    }

    const label = p.name?.trim() || p.notify?.trim()
    if (!label || isLabelGroupSubject(label, groupTitle)) continue
    for (const key of keys) {
      if (!key.endsWith('@s.whatsapp.net') && !key.endsWith('@lid')) continue
      stmt.run(
        key,
        p.name?.trim() || null,
        p.notify?.trim() || p.name?.trim() || null,
        now,
        groupTitle,
      )
      touchedSenderJids.add(key)
    }
  }
  repairGroupSenderNamesForJids([...touchedSenderJids])
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

  upsertGroupParticipants(
    group.participants as {
      id?: string
      jid?: string
      lid?: string
      name?: string
      notify?: string
    }[] | null,
    title,
  )

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

export function upsertChatFromProtocol(chat: ProtocolChat): void {
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

export function upsertChatsFromProtocol(chats: ProtocolChat[]): void {
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
  const tx = getDb().transaction((items: ProtocolChat[]) => {
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

export function upsertMessageFromProtocol(msg: ProtocolMessage, meId: string): MessageRecord | null {
  const chatJid = resolveChatJid(msg)
  if (!isRenderableChatJid(chatJid)) return null

  const text = getMessageText(msg)
  if (!text) return null

  const alias = getMessageContactAlias(msg)
  if (alias) linkContactAlias(alias.lid, alias.jid)

  const contactNames = getContactNameMap()
  const id = messageIdFromKey(msg)
  const senderId = resolveSenderId(msg, meId)
  const chatTitle = getChatTitle(chatJid, contactNames)
  const senderName = resolveSenderName(msg, meId, contactNames, chatTitle)
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
  messages: ProtocolMessage[],
  meId: string,
): number {
  if (messages.length === 0) return 0

  const db = getDb()

  for (const msg of messages) {
    const alias = getMessageContactAlias(msg)
    if (alias) linkContactAlias(alias.lid, alias.jid)
  }

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
    const chatTitle = getChatTitle(chatJid, contactNames)
    const senderName = resolveSenderName(msg, meId, contactNames, chatTitle)
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

    if (
      !msg.key.fromMe &&
      (senderId.endsWith('@s.whatsapp.net') || senderId.endsWith('@lid'))
    ) {
      const pushName = msg.pushName?.trim()
      if (pushName && !isLabelGroupSubject(pushName, chatTitle)) {
        pushNames.set(senderId, pushName)
      }
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
  if (chatJidIsGroup(jid)) return 'Group'
  if (row?.title) return resolveDmTitle(jid, row.title, contactNames)
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
  const contactNames = getContactNameMap()

  return rows.map((row) => ({
    id: row.jid,
    jid: row.jid,
    title: row.is_group === 1 ? row.title : resolveDmTitle(row.jid, row.title, contactNames),
    isGroup: row.is_group === 1,
    lastMessage: row.last_message ?? undefined,
    lastMessageTime: row.last_message_time ?? undefined,
    unreadCount: row.unread_count,
    avatarUrl: avatarUrlForJid(row.jid),
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

export function listNamedPhoneContactJids(limit = 1000): string[] {
  const rows = getDb()
    .prepare(
      `SELECT jid FROM contacts
       WHERE jid LIKE '%@s.whatsapp.net'
         AND COALESCE(NULLIF(TRIM(name), ''), NULLIF(TRIM(push_name), '')) IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as { jid: string }[]
  return rows.map((row) => row.jid)
}

export function listKnownPhoneJids(limit = 2000): string[] {
  const rows = getDb()
    .prepare(
      `SELECT jid, MAX(updated_at) AS updated_at
       FROM (
         SELECT jid, updated_at FROM contacts WHERE jid LIKE '%@s.whatsapp.net'
         UNION ALL
         SELECT jid, updated_at FROM chats WHERE is_group = 0 AND jid LIKE '%@s.whatsapp.net'
         UNION ALL
         SELECT sender_id AS jid, timestamp AS updated_at FROM messages WHERE sender_id LIKE '%@s.whatsapp.net'
       )
       GROUP BY jid
       ORDER BY updated_at DESC
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

export function repairGroupSenderNamesForJids(senderJids: string[]): void {
  const unique = [...new Set(senderJids.filter(Boolean))]
  if (unique.length === 0) return

  const db = getDb()
  const placeholders = unique.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT messages.id, messages.chat_jid, messages.sender_id, messages.sender_name, chats.title AS chat_title
       FROM messages
       JOIN chats ON chats.jid = messages.chat_jid
       WHERE messages.is_from_me = 0
         AND chats.is_group = 1
         AND messages.sender_id IN (${placeholders})`,
    )
    .all(...unique) as Array<
    Pick<MessageRow, 'id' | 'chat_jid' | 'sender_id' | 'sender_name'> & {
      chat_title: string
    }
  >

  if (rows.length === 0) return

  const contactNames = getContactNameMap()
  const updateSender = db.prepare(
    `UPDATE messages SET sender_id = ?, sender_name = ? WHERE id = ?`,
  )

  const tx = db.transaction(() => {
    for (const row of rows) {
      const resolved = resolveStoredGroupSenderName(
        row,
        contactNames,
        row.chat_title,
      )
      if (
        resolved.senderName === row.sender_name &&
        resolved.senderId === row.sender_id
      ) {
        continue
      }
      updateSender.run(resolved.senderId, resolved.senderName, row.id)
    }
  })
  tx()
}

/**
 * Fix group messages/contacts that were saved with the group subject as sender name
 * (WhatsApp history sync quirk). Safe to call repeatedly.
 */
export function repairAllGroupSenderNames(): void {
  const rows = getDb()
    .prepare('SELECT jid FROM chats WHERE is_group = 1')
    .all() as { jid: string }[]
  for (const { jid } of rows) {
    repairGroupChatSenderNames(jid)
  }
}

export function repairGroupChatSenderNames(chatJid: string): void {
  if (!chatJidIsGroup(chatJid)) return

  const chatTitle =
    (
      getDb()
        .prepare('SELECT title FROM chats WHERE jid = ?')
        .get(chatJid) as { title: string } | undefined
    )?.title?.trim() ?? ''
  if (!chatTitle) return

  const db = getDb()
  db.prepare(
    `UPDATE contacts SET push_name = NULL, updated_at = ?
     WHERE push_name = ?`,
  ).run(Date.now(), chatTitle)

  const rows = db
    .prepare(
      `SELECT id, sender_id, sender_name FROM messages
       WHERE chat_jid = ? AND is_from_me = 0`,
    )
    .all(chatJid) as Pick<MessageRow, 'id' | 'sender_id' | 'sender_name'>[]

  const contactNames = getContactNameMap()
  const updateSender = db.prepare(
    `UPDATE messages SET sender_id = ?, sender_name = ? WHERE id = ?`,
  )

  const tx = db.transaction(() => {
    for (const row of rows) {
      const resolved = resolveStoredGroupSenderName(row, contactNames, chatTitle)
      if (
        resolved.senderName === row.sender_name &&
        resolved.senderId === row.sender_id
      ) {
        continue
      }
      updateSender.run(resolved.senderId, resolved.senderName, row.id)
    }
  })
  tx()
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

  const isGroup = chatJidIsGroup(jid)
  const contactNames = isGroup ? getContactNameMap() : null
  const chatTitle = isGroup ? getChatTitle(jid, contactNames!) : null

  const messages = rows.reverse().map((row) => {
    const record = rowToMessageRecord(row)
    if (!isGroup || record.isFromMe || !contactNames) return record

    const resolved = resolveStoredGroupSenderName(row, contactNames, chatTitle ?? undefined)
    record.senderId = resolved.senderId
    record.senderName = resolved.senderName
    return record
  })
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
}): ProtocolMessage | undefined {
  if (!key.remoteJid || !key.id) return undefined
  const id = `${key.remoteJid}:${key.id}:${key.fromMe ? 1 : 0}:${key.participant ?? ''}`
  const row = getDb()
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(id) as MessageRow | undefined
  if (!row) return undefined
  // Minimal stub — full proto not stored
  return undefined
}
