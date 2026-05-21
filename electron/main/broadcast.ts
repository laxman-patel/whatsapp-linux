import { BrowserWindow } from 'electron'

export function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    try {
      win.webContents.send(channel, ...args)
    } catch (err) {
      // The renderer can be disposed during Vite reloads/window teardown.
      // Dropping that transient notification is safer than crashing main.
      console.warn('[broadcast] dropped message:', channel, err)
    }
  }
}
