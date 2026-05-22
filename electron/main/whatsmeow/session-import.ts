import Database from 'better-sqlite3'
import path from 'node:path'
import type { ProtocolChat, ProtocolContact } from '../protocol/types'
import {
  linkContactAlias,
  repairDmChatTitles,
  upsertChatsFromProtocol,
  upsertContacts,
} from '../db/repositories'
import { getAuthDir } from './client'
import { queueAvatarFetches } from './avatars'

interface SessionContactRow {
  their_jid: string
  first_name: string | null
  full_name: string | null
  push_name: string | null
  business_name: string | null
  redacted_phone: string | null
}

function normalizeJid(raw: string, suffix: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.includes('@')) return trimmed
  return `${trimmed}${suffix}`
}

function contactDisplayName(row: SessionContactRow): string | undefined {
  return (
    row.full_name?.trim() ||
    row.first_name?.trim() ||
    row.push_name?.trim() ||
    row.business_name?.trim() ||
    undefined
  )
}

/** Import contacts, LID aliases, and chat rows from the whatsmeow session store. */
export function importFromSessionStore(): {
  contacts: number
  chats: number
  aliases: number
} {
  const sessionPath = path.join(getAuthDir(), 'session.db')
  let sessionDb: Database.Database
  try {
    sessionDb = new Database(sessionPath, { readonly: true, fileMustExist: true })
  } catch {
    return { contacts: 0, chats: 0, aliases: 0 }
  }

  try {
    let aliases = 0
    const lidRows = sessionDb
      .prepare('SELECT lid, pn FROM whatsmeow_lid_map')
      .all() as { lid: string; pn: string }[]

    for (const row of lidRows) {
      const lid = normalizeJid(row.lid, '@lid')
      const pn = normalizeJid(row.pn, '@s.whatsapp.net')
      linkContactAlias(lid, pn)
      aliases++
    }

    const contactRows = sessionDb
      .prepare(
        `SELECT their_jid, first_name, full_name, push_name, business_name, redacted_phone
         FROM whatsmeow_contacts`,
      )
      .all() as SessionContactRow[]

    const contacts: ProtocolContact[] = []
    const contactNameByJid = new Map<string, string>()

    for (const row of contactRows) {
      const jid = row.their_jid.trim()
      if (!jid) continue
      const name = contactDisplayName(row)
      contacts.push({
        id: jid,
        jid,
        name: name ?? null,
        notify: row.push_name?.trim() ?? null,
      })
      if (name) contactNameByJid.set(jid, name)
    }

    if (contacts.length) upsertContacts(contacts)

    const lidToPhone = new Map<string, string>()
    for (const row of lidRows) {
      const lid = normalizeJid(row.lid, '@lid')
      const phone = normalizeJid(row.pn, '@s.whatsapp.net')
      lidToPhone.set(lid, phone)
    }

    const chatJids = sessionDb
      .prepare('SELECT chat_jid FROM whatsmeow_chat_settings')
      .all() as { chat_jid: string }[]

    const chats: ProtocolChat[] = []
    const avatarJids: string[] = []

    for (const row of chatJids) {
      const jid = row.chat_jid.trim()
      if (!jid) continue
      if (jid.endsWith('@newsletter') || jid === 'status@broadcast') continue

      const phoneJid = jid.endsWith('@lid') ? lidToPhone.get(jid) : undefined
      const name =
        contactNameByJid.get(jid) ??
        (phoneJid ? contactNameByJid.get(phoneJid) : undefined)
      chats.push({ id: jid, name: name ?? undefined })
      avatarJids.push(jid)
      if (phoneJid) avatarJids.push(phoneJid)
    }

    if (chats.length) upsertChatsFromProtocol(chats)
    repairDmChatTitles()
    if (avatarJids.length) queueAvatarFetches(avatarJids)

    console.log(
      `[whatsmeow] session import: ${contacts.length} contacts, ${chats.length} chats, ${aliases} LID aliases`,
    )

    return { contacts: contacts.length, chats: chats.length, aliases }
  } finally {
    sessionDb.close()
  }
}
