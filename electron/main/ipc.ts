import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import type { ChatFilter, ConnectionStatus } from '../../src/shared/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipc'
import {
  getMockGroupMeta,
  getMockMessages,
  listMockChats,
  sendMockText,
} from './mock-data'

interface AppSettings extends Record<string, ChatFilter> {
  chatFilter: ChatFilter
}

const store = new Store<AppSettings>({
  defaults: { chatFilter: 'all' },
})

function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

export function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => ({
    chatFilter: store.get('chatFilter'),
  }))

  ipcMain.handle(IPC_CHANNELS.settingsSetFilter, (_, filter: ChatFilter) => {
    store.set('chatFilter', filter)
  })

  ipcMain.handle(IPC_CHANNELS.authStatus, () => ({
    status: 'connected' as ConnectionStatus,
    message: 'Mock session (Phase 0)',
  }))

  ipcMain.handle(
    IPC_CHANNELS.chatsList,
    (_, filter: ChatFilter, search?: string) => listMockChats(filter, search),
  )

  ipcMain.handle(IPC_CHANNELS.chatOpen, (_, jid: string) => {
    return getMockGroupMeta(jid) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.messagesList, (_, jid: string) => ({
    messages: getMockMessages(jid),
  }))

  ipcMain.handle(IPC_CHANNELS.messagesSendText, (_, jid: string, text: string) => {
    const message = sendMockText(jid, text)
    broadcast(IPC_CHANNELS.messagesUpdated, jid)
    broadcast(IPC_CHANNELS.chatsUpdated)
    return message
  })
}
