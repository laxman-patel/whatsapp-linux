import { ipcRenderer, contextBridge, IpcRendererEvent } from 'electron'
import type {
  ChatFilter,
  ConnectionPayload,
  IpcApi,
  SyncProgressPayload,
} from '../../src/shared/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipc'

function subscribe<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void,
) {
  const listener = (_event: IpcRendererEvent, ...args: T) => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: IpcApi = {
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
  setChatFilter: (filter) => ipcRenderer.invoke(IPC_CHANNELS.settingsSetFilter, filter),
  setColorScheme: (scheme) =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSetColorScheme, scheme),
  getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.authStatus),
  authLogout: () => ipcRenderer.invoke(IPC_CHANNELS.authLogout),
  authRetry: () => ipcRenderer.invoke(IPC_CHANNELS.authRetry),
  listChats: (filter, search) => ipcRenderer.invoke(IPC_CHANNELS.chatsList, filter, search),
  openChat: (jid) => ipcRenderer.invoke(IPC_CHANNELS.chatOpen, jid),
  listMessages: (jid, cursor) => ipcRenderer.invoke(IPC_CHANNELS.messagesList, jid, cursor),
  sendText: (jid, text) => ipcRenderer.invoke(IPC_CHANNELS.messagesSendText, jid, text),
  getSyncProgress: () => ipcRenderer.invoke(IPC_CHANNELS.syncGet),
  onConnectionUpdate: (cb) =>
    subscribe<[ConnectionPayload]>(IPC_CHANNELS.connectionUpdate, (payload) => cb(payload)),
  onAuthQr: (cb) => subscribe<[string]>(IPC_CHANNELS.authQr, (dataUrl) => cb(dataUrl)),
  onSyncUpdate: (cb) =>
    subscribe<[SyncProgressPayload]>(IPC_CHANNELS.syncUpdate, (payload) => cb(payload)),
  onChatsUpdated: (cb) => subscribe<[]>(IPC_CHANNELS.chatsUpdated, () => cb()),
  onMessagesUpdated: (cb) =>
    subscribe<[string]>(IPC_CHANNELS.messagesUpdated, (jid) => cb(jid)),
}

contextBridge.exposeInMainWorld('api', api)
