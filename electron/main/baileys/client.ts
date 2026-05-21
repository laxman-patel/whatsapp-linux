import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import path from 'node:path'
import fs from 'node:fs/promises'
import { app } from 'electron'
import QRCode from 'qrcode'
import type { ConnectionStatus } from '../../../src/shared/ipc'
import { IPC_CHANNELS } from '../../../src/shared/ipc'
import { broadcast } from '../broadcast'
import { clearDatabase } from '../db'
import { registerBaileysHandlers } from './handlers'
import { beginSync, resetSyncProgress, scheduleSyncIdleFallback } from '../sync-progress'

export interface ConnectionPayload {
  status: ConnectionStatus
  message?: string
}

type ConnectionListener = (payload: ConnectionPayload) => void
type QrListener = (dataUrl: string) => void

let socket: WASocket | null = null
let starting = false
let currentState: ConnectionPayload = { status: 'disconnected' }

const connectionListeners = new Set<ConnectionListener>()
const qrListeners = new Set<QrListener>()

export function getAuthDir(): string {
  return path.join(app.getPath('userData'), 'baileys-auth')
}

export function getConnectionState(): ConnectionPayload {
  return { ...currentState }
}

export function onConnectionUpdate(listener: ConnectionListener): () => void {
  connectionListeners.add(listener)
  return () => connectionListeners.delete(listener)
}

export function onAuthQr(listener: QrListener): () => void {
  qrListeners.add(listener)
  return () => qrListeners.delete(listener)
}

function setState(payload: ConnectionPayload) {
  currentState = payload
  for (const listener of connectionListeners) listener(payload)
}

function emitQr(dataUrl: string) {
  for (const listener of qrListeners) listener(dataUrl)
}

export function getSocket(): WASocket | null {
  return socket
}

export async function startWhatsApp(): Promise<void> {
  if (socket || starting) return

  starting = true
  setState({ status: 'connecting', message: 'Connecting to WhatsApp…' })

  try {
    const authDir = getAuthDir()
    await fs.mkdir(authDir, { recursive: true })

    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['WhatsApp Desktop', 'Linux', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async () => undefined,
    })

    socket = sock
    registerBaileysHandlers(sock)
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        setState({ status: 'qr', message: 'Scan with WhatsApp on your phone' })
        try {
          const dataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 280 })
          emitQr(dataUrl)
        } catch {
          emitQr(qr)
        }
      }

      if (connection === 'open') {
        setState({ status: 'connected' })
        beginSync()
        scheduleSyncIdleFallback()
        broadcast(IPC_CHANNELS.chatsUpdated)
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode
        socket = null

        if (statusCode === DisconnectReason.loggedOut) {
          setState({
            status: 'error',
            message: 'Session ended. Scan QR to link again.',
          })
          return
        }

        if (statusCode === DisconnectReason.restartRequired) {
          setState({ status: 'connecting', message: 'Restarting session…' })
          void startWhatsApp()
          return
        }

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut
        if (shouldReconnect) {
          setState({ status: 'connecting', message: 'Reconnecting…' })
          setTimeout(() => void startWhatsApp(), 2000)
        } else {
          setState({
            status: 'error',
            message: `Disconnected (code ${statusCode ?? 'unknown'})`,
          })
        }
      }
    })
  } catch (err) {
    socket = null
    const msg =
      err instanceof Error ? err.message : 'Failed to start WhatsApp client'
    setState({ status: 'error', message: msg })
  } finally {
    starting = false
  }
}

export async function logoutWhatsApp(): Promise<void> {
  const sock = socket
  socket = null
  starting = false

  if (sock) {
    try {
      await sock.logout()
    } catch {
      // Session may already be invalid
    }
  }

  try {
    await fs.rm(getAuthDir(), { recursive: true, force: true })
  } catch {
    // ignore missing auth dir
  }

  clearDatabase()
  resetSyncProgress()

  setState({ status: 'connecting', message: 'Starting fresh session…' })
  await startWhatsApp()
}

export async function retryWhatsApp(): Promise<void> {
  socket = null
  starting = false
  await startWhatsApp()
}
