import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/shared/ipc'
import {
  getConnectionState,
  logoutWhatsApp,
  onAuthQr,
  onConnectionUpdate,
  retryWhatsApp,
  startWhatsApp,
} from './whatsmeow/client'

function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

export function initConnectionBridge() {
  onConnectionUpdate((payload) => {
    broadcast(IPC_CHANNELS.connectionUpdate, payload)
  })

  onAuthQr((dataUrl) => {
    broadcast(IPC_CHANNELS.authQr, dataUrl)
  })
}

export {
  getConnectionState,
  logoutWhatsApp,
  retryWhatsApp,
  startWhatsApp,
}
