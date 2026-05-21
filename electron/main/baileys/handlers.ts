import type { BaileysEventMap, WASocket } from '@whiskeysockets/baileys'
import { jidNormalizedUser } from '@whiskeysockets/baileys'
import {
  deleteChats,
  upsertChatFromBaileys,
  upsertChatsFromBaileys,
  upsertContacts,
  upsertGroupInfo,
  upsertMessageFromBaileys,
} from '../db/repositories'
import {
  onHistorySyncComplete,
  scheduleChatsNotify,
  scheduleMessagesNotify,
} from '../sync-progress'
import { enqueueHistoryChunk, setSyncQueueMeId } from './sync-queue'

let meId = ''

export function getMeId(): string {
  return meId
}

export function registerBaileysHandlers(sock: WASocket): void {
  meId = jidNormalizedUser(sock.user?.id ?? 'me@s.whatsapp.net')
  setSyncQueueMeId(meId)

  sock.ev.on('messaging-history.set', (data) => {
    // Hand off to the drain queue. It batches consecutive chunks into one
    // SQLite transaction so initial sync overlaps with Baileys decoding.
    enqueueHistoryChunk({
      chats: data.chats ?? undefined,
      contacts: data.contacts ?? undefined,
      messages: data.messages ?? undefined,
      progress: data.progress ?? undefined,
      isLatest: data.isLatest ?? undefined,
    })

    if (data.isLatest) {
      onHistorySyncComplete()
      scheduleChatsNotify(true)
    }
  })

  sock.ev.on('chats.upsert', (chats) => {
    upsertChatsFromBaileys(chats)
    scheduleChatsNotify()
  })

  sock.ev.on('chats.update', (updates) => {
    for (const update of updates) {
      if (update.id) upsertChatFromBaileys(update as Parameters<typeof upsertChatFromBaileys>[0])
    }
    scheduleChatsNotify()
  })

  sock.ev.on('chats.delete', (jids) => {
    deleteChats(jids)
    scheduleChatsNotify(true)
  })

  sock.ev.on('contacts.upsert', (contacts) => {
    upsertContacts(contacts)
    scheduleChatsNotify()
  })

  sock.ev.on('contacts.update', (updates) => {
    upsertContacts(
      updates
        .filter((c) => c.id)
        .map((c) => ({
          id: c.id!,
          name: c.name,
          notify: c.notify,
          verifiedName: c.verifiedName,
        })),
    )
    scheduleChatsNotify()
  })

  sock.ev.on('messages.upsert', ({ messages }) => {
    try {
      for (const msg of messages) {
        const record = upsertMessageFromBaileys(msg, meId)
        if (record) scheduleMessagesNotify(record.chatJid)
      }
      scheduleChatsNotify()
    } catch (err) {
      console.error('[baileys] messages.upsert failed:', err)
    }
  })

  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (!key.remoteJid || !key.id) continue
      if (update.status !== undefined) {
        scheduleMessagesNotify(key.remoteJid)
      }
    }
  })

  sock.ev.on('groups.upsert', (groups) => {
    for (const g of groups) {
      upsertGroupInfo(g)
    }
    scheduleChatsNotify()
  })

  sock.ev.on('groups.update', (groups) => {
    for (const g of groups) {
      if (!g.id) continue
      upsertGroupInfo({
        id: g.id,
        subject: g.subject,
        participants: 'participants' in g ? g.participants : null,
      })
    }
    scheduleChatsNotify()
  })
}

export type BaileysHandlerEvents = keyof BaileysEventMap
