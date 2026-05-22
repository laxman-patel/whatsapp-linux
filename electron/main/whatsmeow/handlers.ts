import type { MessageInfo, WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node'
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
  setHistorySyncActive,
  setSyncQueueMeId,
  upsertLiveMessage,
} from './sync-queue'
import {
  groupInfoToProtocolChat,
  messageEventToProtocol,
  pushNameToContact,
} from './adapter'
import { importFromSessionStore } from './session-import'
import {
  attachHistoryBackfillClient,
  isBackfillBusy,
  queueHistoryBackfill,
  onHistoryBackfillIdle,
} from './history-backfill'

let meId = ''
let syncIdleTimer: ReturnType<typeof setTimeout> | null = null
let initialHistorySyncComplete = false
let lastHistorySyncEventAt = 0

const INITIAL_HISTORY_QUIET_MS = 120_000
const MIN_HISTORY_QUIET_MS = 45_000

interface HistorySyncPayload {
  type?: string
  progress?: number
  historyComplete?: boolean
  parseFailures?: number
  jidAliases?: Array<{ oldJid: string; newJid: string }>
  messages?: Array<{ info: MessageInfo; message: Record<string, unknown> }>
  pushNames?: Array<{ jid: string; pushName: string }>
}

export function getMeId(): string {
  return meId
}

function scheduleSyncIdleCheck(delayMs = 8000): void {
  if (syncIdleTimer) clearTimeout(syncIdleTimer)
  syncIdleTimer = setTimeout(() => {
    syncIdleTimer = null
    void tryCompleteSync()
  }, delayMs)
}

async function tryCompleteSync(): Promise<void> {
  if (isBackfillBusy()) {
    scheduleSyncIdleCheck(15_000)
    return
  }

  const quietFor = Date.now() - lastHistorySyncEventAt
  if (
    lastHistorySyncEventAt > 0 &&
    !initialHistorySyncComplete &&
    quietFor < INITIAL_HISTORY_QUIET_MS
  ) {
    scheduleSyncIdleCheck(INITIAL_HISTORY_QUIET_MS - quietFor + 2000)
    return
  }

  if (lastHistorySyncEventAt > 0 && quietFor < MIN_HISTORY_QUIET_MS) {
    scheduleSyncIdleCheck(MIN_HISTORY_QUIET_MS - quietFor + 2000)
    return
  }

  await flushHistoryQueue()
  if (isBackfillBusy()) {
    scheduleSyncIdleCheck(15_000)
    return
  }
  setHistorySyncActive(false)
  onHistorySyncComplete()
  scheduleChatsNotify(true)
}

function ingestMessage(
  info: MessageInfo,
  message: Record<string, unknown>,
  opts: { history?: boolean } = {},
): void {
  const protocolMsg = messageEventToProtocol(info, message)
  const activeJid = getActiveChat()

  if (opts.history) {
    enqueueHistoryMessage(protocolMsg)
    return
  }

  const record = upsertLiveMessage(protocolMsg)
  if (!record) return

  scheduleMessagesNotify(record.chatJid)

  if (
    chatJidIsGroup(record.chatJid) &&
    !record.isFromMe &&
    (record.senderId.endsWith('@s.whatsapp.net') || record.senderId.endsWith('@lid'))
  ) {
    queueAvatarFetches([record.senderId])
  }

  if (!record.isFromMe && record.chatJid !== activeJid) {
    incrementChatUnread(record.chatJid)
  }
}

function handleHistorySyncPayload(data: HistorySyncPayload): void {
  lastHistorySyncEventAt = Date.now()
  setHistorySyncActive(true)

  if (data.historyComplete || (typeof data.progress === 'number' && data.progress >= 100)) {
    initialHistorySyncComplete = true
  }

  if (typeof data.progress === 'number') {
    recordHistoryChunk({ progress: data.progress })
  } else {
    recordHistoryChunk({ progress: undefined })
  }

  if (data.jidAliases?.length) {
    for (const alias of data.jidAliases) {
      if (alias.oldJid && alias.newJid) {
        linkContactAlias(alias.oldJid, alias.newJid)
      }
    }
  }

  if (data.parseFailures) {
    console.warn(`[whatsmeow] history_sync skipped ${data.parseFailures} messages (parse errors)`)
  }

  if (data.pushNames?.length) {
    upsertContacts(
      data.pushNames
        .filter((pn) => pn.jid && pn.pushName?.trim())
        .map((pn) => pushNameToContact(pn.jid, pn.pushName)),
    )
  }

  if (data.messages?.length) {
    console.log(
      `[whatsmeow] history_sync batch type=${data.type ?? '?'} messages=${data.messages.length} progress=${data.progress ?? 'n/a'}`,
    )
    for (const item of data.messages) {
      ingestMessage(item.info, item.message, { history: true })
    }
    scheduleSyncIdleCheck(INITIAL_HISTORY_QUIET_MS)
  } else {
    scheduleSyncIdleCheck(initialHistorySyncComplete ? MIN_HISTORY_QUIET_MS : INITIAL_HISTORY_QUIET_MS)
  }
}

export function registerWhatsmeowHandlers(client: WhatsmeowClient): void {
  attachHistoryBackfillClient(client)

  onHistoryBackfillIdle(() => {
    void tryCompleteSync()
  })

  client.on('connected', ({ jid }) => {
    meId = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
    setSyncQueueMeId(meId)
    void bootstrapAfterConnect(client)
  })

  client.on('history_sync', (data: HistorySyncPayload) => {
    console.log(
      `[whatsmeow] history_sync type=${data.type ?? '?'} progress=${data.progress ?? 'n/a'} messages=${data.messages?.length ?? 0}`,
    )
    handleHistorySyncPayload(data)
  })

  client.on('message', ({ info, message }) => {
    try {
      const duringSync = isBackfillBusy() || !initialHistorySyncComplete
      ingestMessage(info, message, duringSync ? { history: true } : undefined)

      if (info.pushName?.trim() && !info.isFromMe) {
        upsertContacts([pushNameToContact(info.sender, info.pushName)])
      }

      scheduleChatsNotify()
      if (duringSync) {
        lastHistorySyncEventAt = Date.now()
        scheduleSyncIdleCheck(MIN_HISTORY_QUIET_MS)
      } else {
        scheduleSyncIdleCheck(4000)
      }
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

async function bootstrapAfterConnect(client: WhatsmeowClient): Promise<void> {
  initialHistorySyncComplete = false
  lastHistorySyncEventAt = 0
  setHistorySyncActive(true)

  importFromSessionStore()
  scheduleChatsNotify(true)

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

  queueHistoryBackfill()
  scheduleSyncIdleCheck(INITIAL_HISTORY_QUIET_MS)
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

export function requestChatHistory(_client: WhatsmeowClient, chatJid: string): void {
  queueHistoryBackfill([chatJid], true)
}
