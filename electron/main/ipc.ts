import { ipcMain } from 'electron'
import Store from 'electron-store'
import type { ChatFilter, ColorScheme } from '../../src/shared/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipc'
import {
  getConnectionState,
  logoutWhatsApp,
  retryWhatsApp,
} from './connection-bridge'
import { getSocket } from './baileys/client'
import { sendTextMessage } from './baileys/send'
import {
  listChatsFromDb,
  listMessagesFromDb,
  setGroupParticipantCount,
} from './db/repositories'
import { chatJidIsGroup } from './baileys/message-utils'

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

    const sock = getSocket()
    if (!sock) return null

    try {
      const meta = await sock.groupMetadata(jid)
      const count = meta.participants?.length ?? 0
      setGroupParticipantCount(jid, count)
      return { participantCount: count }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.messagesList, (_, jid: string, cursor?: string) =>
    listMessagesFromDb(jid, cursor),
  )

  ipcMain.handle(IPC_CHANNELS.messagesSendText, async (_, jid: string, text: string) =>
    sendTextMessage(jid, text),
  )
}
