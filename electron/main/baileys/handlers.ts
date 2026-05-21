import type { BaileysEventMap, WASocket } from '@whiskeysockets/baileys'
import { jidNormalizedUser } from '@whiskeysockets/baileys'
import {
  deleteChats,
  setGroupParticipantCount,
  upsertChatFromBaileys,
  upsertChatsFromBaileys,
  upsertContacts,
  upsertMessageFromBaileys,
  upsertRecentMessagesFromHistory,
} from '../db/repositories'
import {
  onHistorySyncComplete,
  recordHistoryChunk,
  scheduleChatsNotify,
  scheduleMessagesNotify,
} from '../sync-progress'

let meId = ''

export function getMeId(): string {
  return meId
}

export function registerBaileysHandlers(sock: WASocket): void {
  meId = jidNormalizedUser(sock.user?.id ?? 'me@s.whatsapp.net')

  sock.ev.on('messaging-history.set', (data) => {
    try {
      const msgCount = data.messages?.length ?? 0
      const chatCount = data.chats?.length ?? 0
      const contactCount = data.contacts?.length ?? 0

      if (data.contacts?.length) upsertContacts(data.contacts)
      if (data.chats?.length) upsertChatsFromBaileys(data.chats)

      // Show latest chats immediately; message import runs next tick so the
      // renderer can paint the sidebar before heavier SQLite work starts.
      recordHistoryChunk({
        chats: chatCount,
        contacts: contactCount,
        progress: data.progress ?? undefined,
        isLatest: msgCount === 0 ? data.isLatest ?? undefined : undefined,
      })
      scheduleChatsNotify(true)

      if (data.messages?.length) {
        const messages = data.messages
        setTimeout(() => {
          try {
            const inserted = upsertRecentMessagesFromHistory(messages, meId)
            recordHistoryChunk({
              messages: inserted,
              deferredMessages: Math.max(0, messages.length - inserted),
              progress: data.progress ?? undefined,
              isLatest: data.isLatest ?? undefined,
            })
            scheduleChatsNotify()
          } catch (err) {
            console.error('[baileys] history message import failed:', err)
          }
        }, 0)
      }
    } catch (err) {
      console.error('[baileys] messaging-history.set failed:', err)
    }
  })

  sock.ev.on('messaging-history.status', ({ status }) => {
    if (status === 'complete') {
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
      setGroupParticipantCount(g.id, g.participants?.length ?? 0)
    }
    scheduleChatsNotify()
  })
}

export type BaileysHandlerEvents = keyof BaileysEventMap
