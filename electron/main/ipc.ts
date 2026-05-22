import { ipcMain } from 'electron'
import Store from 'electron-store'
import type { ChatFilter, ColorScheme } from '../../src/shared/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipc'
import {
  getConnectionState,
  logoutWhatsApp,
  retryWhatsApp,
} from './connection-bridge'
import { getClient } from './whatsmeow/client'
import { sendTextMessage } from './whatsmeow/send'
import {
  listChatsFromDb,
  listChatsMissingAvatar,
  listMessagesFromDb,
  markChatRead,
  repairGroupChatSenderNames,
  upsertGroupInfo,
} from './db/repositories'
import { chatJidIsGroup } from './whatsmeow/message-utils'
import {
  beginSync,
  getSyncProgress,
  scheduleChatsNotify,
  scheduleMessagesNotify,
  scheduleSyncIdleFallback,
} from './sync-progress'
import { setActiveChat } from './active-chat'
import { queueAvatarFetches } from './whatsmeow/avatars'
import { hydrateContactAliasesFromPhonebook } from './whatsmeow/contact-aliases'

interface StoredSettings extends Record<string, ChatFilter | ColorScheme> {
  chatFilter: ChatFilter
  colorScheme: ColorScheme
}

const store = new Store<StoredSettings>({
  defaults: { chatFilter: 'all', colorScheme: 'system' },
})

export function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => ({
    chatFilter: store.get('chatFilter'),
    colorScheme: store.get('colorScheme'),
  }))

  ipcMain.handle(IPC_CHANNELS.settingsSetFilter, (_, filter: ChatFilter) => {
    store.set('chatFilter', filter)
  })

  ipcMain.handle(IPC_CHANNELS.settingsSetColorScheme, (_, scheme: ColorScheme) => {
    store.set('colorScheme', scheme)
  })

  ipcMain.handle(IPC_CHANNELS.authStatus, () => getConnectionState())

  ipcMain.handle(IPC_CHANNELS.syncGet, () => getSyncProgress())

  ipcMain.handle(IPC_CHANNELS.authLogout, async () => {
    await logoutWhatsApp()
  })

  ipcMain.handle(IPC_CHANNELS.authRetry, async () => {
    await retryWhatsApp()
  })

  ipcMain.handle(
    IPC_CHANNELS.chatsList,
    (_, filter: ChatFilter, search?: string) => listChatsFromDb(filter, search),
  )

  ipcMain.handle(IPC_CHANNELS.chatOpen, async (_, jid: string) => {
    if (!chatJidIsGroup(jid)) return null

    const wa = getClient()
    if (!wa) {
      repairGroupChatSenderNames(jid)
      scheduleMessagesNotify(jid)
      scheduleChatsNotify(true)
      return null
    }

    try {
      const meta = await wa.getGroupInfo(jid)
      const count = meta.participants?.length ?? 0
      upsertGroupInfo({
        id: meta.jid,
        subject: meta.name,
        participants: meta.participants.map((p) => ({ id: p.jid, jid: p.jid })),
      })
      void hydrateContactAliasesFromPhonebook(wa)
      queueAvatarFetches(meta.participants.map((p) => p.jid))
      repairGroupChatSenderNames(jid)
      scheduleMessagesNotify(jid)
      scheduleChatsNotify(true)
      return { participantCount: count }
    } catch {
      repairGroupChatSenderNames(jid)
      scheduleMessagesNotify(jid)
      scheduleChatsNotify(true)
      return { participantCount: undefined }
    }
  })

  ipcMain.handle(IPC_CHANNELS.chatMarkRead, (_, jid: string) => {
    markChatRead(jid)
    scheduleChatsNotify(true)
  })

  ipcMain.handle(IPC_CHANNELS.chatSetActive, (_, jid: string | null) => {
    setActiveChat(jid)
    if (jid) {
      markChatRead(jid)
      scheduleChatsNotify(true)
    }
  })

  ipcMain.handle(IPC_CHANNELS.syncTrigger, () => {
    queueAvatarFetches(listChatsMissingAvatar())
    void hydrateContactAliasesFromPhonebook(getClient())
    beginSync()
    scheduleSyncIdleFallback(8000)
    scheduleChatsNotify(true)
  })

  ipcMain.handle(IPC_CHANNELS.messagesList, (_, jid: string, cursor?: string) =>
    listMessagesFromDb(jid, cursor),
  )

  ipcMain.handle(IPC_CHANNELS.messagesSendText, async (_, jid: string, text: string) =>
    sendTextMessage(jid, text),
  )
}
