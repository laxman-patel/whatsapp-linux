import type { WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node'
import {
  deleteChats,
  incrementChatUnread,
  linkContactAlias,
  listPlaceholderGroupJids,
  repairGroupSenderNamesForJids,
  upsertChatFromProtocol,
  upsertChatsFromProtocol,
  upsertContacts,
  upsertGroupInfo,
} from '../db/repositories'
import { getActiveChat } from '../active-chat'
import { queueAvatarFetches } from './avatars'
import { chatJidIsGroup } from './message-utils'
import {
  onHistorySyncComplete,
  recordHistoryChunk,
  scheduleChatsNotify,
  scheduleMessagesNotify,
} from '../sync-progress'
import {
  enqueueHistoryMessage,
  flushHistoryQueue,
  isHistorySyncActive,
  setHistorySyncActive,
  setSyncQueueMeId,
  upsertLiveMessage,
} from './sync-queue'
import { groupInfoToProtocolChat, messageEventToProtocol, pushNameToContact } from './adapter'

let meId = ''

export function getMeId(): string {
  return meId
}

export function registerWhatsmeowHandlers(client: WhatsmeowClient): void {
  client.on('connected', ({ jid }) => {
    meId = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
    setSyncQueueMeId(meId)
    void hydrateInitialData(client)
  })

  client.on('history_sync', ({ type }) => {
    console.log('[whatsmeow] history_sync type=' + type)
    setHistorySyncActive(true)
    recordHistoryChunk({ progress: undefined })
  })

  client.on('message', ({ info, message }) => {
    try {
      const protocolMsg = messageEventToProtocol(info, message)
      const activeJid = getActiveChat()

      if (isHistorySyncActive()) {
        enqueueHistoryMessage(protocolMsg)
      } else {
        const record = upsertLiveMessage(protocolMsg)
        if (!record) return
        scheduleMessagesNotify(record.chatJid)

        if (
          chatJidIsGroup(record.chatJid) &&
          !record.isFromMe &&
          (record.senderId.endsWith('@s.whatsapp.net') ||
            record.senderId.endsWith('@lid'))
        ) {
          queueAvatarFetches([record.senderId])
        }

        if (!record.isFromMe && record.chatJid !== activeJid) {
          incrementChatUnread(record.chatJid)
        }
      }

      if (info.pushName?.trim() && !info.isFromMe) {
        upsertContacts([pushNameToContact(info.sender, info.pushName)])
      }

      scheduleChatsNotify()
    } catch (err) {
      console.error('[whatsmeow] message handler failed:', err)
    }
  })

  client.on('message:receipt', ({ chat, ids }) => {
    if (chat && ids?.length) scheduleMessagesNotify(chat)
  })

  client.on('group:info', (event) => {
    if (!event.jid) return
    upsertGroupInfo({
      id: event.jid,
      subject: event.name ?? undefined,
    })
    queueAvatarFetches([event.jid])
    scheduleChatsNotify()
  })

  client.on('group:joined', ({ jid, name }) => {
    upsertChatFromProtocol(groupInfoToProtocolChat(jid, name))
    queueAvatarFetches([jid])
    scheduleChatsNotify(true)
  })

  client.on('picture', ({ jid, remove }) => {
    if (!remove) queueAvatarFetches([jid])
  })
}

async function hydrateInitialData(client: WhatsmeowClient): Promise<void> {
  setHistorySyncActive(true)

  try {
    await client.fetchAppState('regular_high', true, false)
  } catch (err) {
    console.warn('[whatsmeow] fetchAppState failed:', err)
  }

  try {
    const groups = await client.getJoinedGroups()
    if (groups.length) {
      upsertChatsFromProtocol(groups.map((g) => groupInfoToProtocolChat(g.jid, g.name)))
      for (const g of groups) {
        upsertGroupInfo({
          id: g.jid,
          subject: g.name,
          participants: g.participants.map((p) => ({ id: p.jid, jid: p.jid })),
        })
      }
      queueAvatarFetches(groups.map((g) => g.jid))
      recordHistoryChunk({ chats: groups.length })
      scheduleChatsNotify(true)
    }
  } catch (err) {
    console.warn('[whatsmeow] getJoinedGroups failed:', err)
  }

  // Allow history messages to drain, then mark sync complete.
  setTimeout(async () => {
    await flushHistoryQueue()
    setHistorySyncActive(false)
    onHistorySyncComplete()
    scheduleChatsNotify(true)
  }, 30_000)
}

export async function hydrateMissingGroupNames(client: WhatsmeowClient): Promise<void> {
  const jids = listPlaceholderGroupJids()
  if (jids.length === 0) return

  for (const jid of jids) {
    try {
      const meta = await client.getGroupInfo(jid)
      upsertGroupInfo({
        id: meta.jid,
        subject: meta.name,
        participants: meta.participants.map((p) => ({ id: p.jid, jid: p.jid })),
      })
      scheduleChatsNotify(true)
    } catch {
      // stale / left groups
    }
  }
}

export function handlePhoneNumberShare(lid: string, jid: string): void {
  repairGroupSenderNamesForJids(linkContactAlias(lid, jid))
  scheduleChatsNotify(true)
}

export function handleChatDelete(jids: string[]): void {
  deleteChats(jids)
  scheduleChatsNotify(true)
}
