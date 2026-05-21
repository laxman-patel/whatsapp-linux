import type { BaileysEventMap, WASocket } from '@whiskeysockets/baileys'
import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { IPC_CHANNELS } from '../../../src/shared/ipc'
import { broadcast } from '../broadcast'
import {
  deleteChats,
  setGroupParticipantCount,
  upsertChatFromBaileys,
  upsertChatsFromBaileys,
  upsertContacts,
  upsertMessageFromBaileys,
  upsertMessagesFromBaileys,
} from '../db/repositories'

let meId = ''

export function getMeId(): string {
  return meId
}

export function registerBaileysHandlers(sock: WASocket): void {
  meId = jidNormalizedUser(sock.user?.id ?? 'me@s.whatsapp.net')

  const notifyChats = () => broadcast(IPC_CHANNELS.chatsUpdated)
  const notifyMessages = (jid: string) =>
    broadcast(IPC_CHANNELS.messagesUpdated, jid)

  sock.ev.on('messaging-history.set', (data) => {
    try {
      if (data.contacts?.length) upsertContacts(data.contacts)
      if (data.chats?.length) upsertChatsFromBaileys(data.chats)
      if (data.messages?.length) upsertMessagesFromBaileys(data.messages, meId)
      notifyChats()
    } catch (err) {
      console.error('[baileys] messaging-history.set failed:', err)
    }
  })

  sock.ev.on('chats.upsert', (chats) => {
    upsertChatsFromBaileys(chats)
    notifyChats()
  })

  sock.ev.on('chats.update', (updates) => {
    for (const update of updates) {
      if (update.id) upsertChatFromBaileys(update as Parameters<typeof upsertChatFromBaileys>[0])
    }
    notifyChats()
  })

  sock.ev.on('chats.delete', (jids) => {
    deleteChats(jids)
    notifyChats()
  })

  sock.ev.on('contacts.upsert', (contacts) => {
    upsertContacts(contacts)
    notifyChats()
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
    notifyChats()
  })

  sock.ev.on('messages.upsert', ({ messages }) => {
    try {
      for (const msg of messages) {
        const record = upsertMessageFromBaileys(msg, meId)
        if (record) notifyMessages(record.chatJid)
      }
      notifyChats()
    } catch (err) {
      console.error('[baileys] messages.upsert failed:', err)
    }
  })

  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (!key.remoteJid || !key.id) continue
      // Status updates handled in Phase 4; still refresh thread
      if (update.status !== undefined) {
        notifyMessages(key.remoteJid)
      }
    }
  })

  sock.ev.on('groups.upsert', (groups) => {
    for (const g of groups) {
      setGroupParticipantCount(g.id, g.participants?.length ?? 0)
    }
    notifyChats()
  })
}

export type BaileysHandlerEvents = keyof BaileysEventMap
