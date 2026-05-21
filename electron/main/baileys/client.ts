import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
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
import { listPlaceholderGroupJids, upsertGroupInfo } from '../db/repositories'

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

function shouldSyncFastHistory(
  msg: proto.Message.IHistorySyncNotification,
): boolean {
  const type = msg.syncType

  // Match Baileys' default: accept everything except FULL. We're on 6.x now,
  // where the enum lives under proto.Message.HistorySyncNotification.
  return type !== proto.Message.HistorySyncNotification.HistorySyncType.FULL
}

// Bump this whenever switching Baileys major versions so we don't carry an
// incompatible auth state across the change.
const AUTH_FORMAT_VERSION = 'baileys-6'

async function ensureCompatibleAuthState(): Promise<void> {
  const dir = getAuthDir()
  const stampFile = path.join(dir, '.app-auth-version')
  await fs.mkdir(dir, { recursive: true })
  let stamp = ''
  try {
    stamp = (await fs.readFile(stampFile, 'utf8')).trim()
  } catch {
    // first launch on this version: stamp + reset auth if anything exists.
  }
  if (stamp !== AUTH_FORMAT_VERSION) {
    await fs.rm(dir, { recursive: true, force: true })
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(stampFile, AUTH_FORMAT_VERSION, 'utf8')
    try {
      clearDatabase()
    } catch (err) {
      console.warn('[baileys] clearDatabase during downgrade failed:', err)
    }
  }
}

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
    await ensureCompatibleAuthState()
    const authDir = getAuthDir()

    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      // info level surfaces Baileys' own history-sync diagnostics so we can
      // tell whether decryption / download silently fails on 7.0 RC.
      logger: pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'warn' }),
      printQRInTerminal: false,
      // Per official Baileys docs: desktop-identified browsers receive full
      // history. Anything else (custom tuple, mobile identifier) makes WA
      // return 'complete' with no actual set events on 7.0 RC.
      browser: Browsers.macOS('Desktop'),
      // syncFullHistory must be true in 7.x RCs to trigger history sync at
      // all; we still filter the heavy FULL type via shouldSyncHistoryMessage.
      syncFullHistory: true,
      shouldSyncHistoryMessage: shouldSyncFastHistory,
      // Required for the phone to keep pushing history; passive presence
      // sometimes makes WA short-circuit the bootstrap.
      markOnlineOnConnect: true,
      getMessage: async () => undefined,
    })

    socket = sock
    registerBaileysHandlers(sock)
    sock.ev.on('creds.update', saveCreds)

    // Diagnostics so we can see why history doesn't arrive.
    sock.ev.on('messaging-history.set', (data) => {
      console.log(
        '[baileys] messaging-history.set',
        'chats=' + (data.chats?.length ?? 0),
        'contacts=' + (data.contacts?.length ?? 0),
        'messages=' + (data.messages?.length ?? 0),
        'progress=' + (data.progress ?? 'n/a'),
        'syncType=' + data.syncType,
        'isLatest=' + data.isLatest,
      )
    })
    sock.ev.on('chats.upsert', (chats) => {
      console.log('[baileys] chats.upsert count=' + chats.length)
    })
    sock.ev.on('contacts.upsert', (contacts) => {
      console.log('[baileys] contacts.upsert count=' + contacts.length)
    })
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      console.log(
        '[baileys] messages.upsert',
        'count=' + messages.length,
        'type=' + type,
      )
    })

    // If neither chats nor history arrive within 15s after connect we log a
    // clear diagnostic so it's obvious WA is short-circuiting the bootstrap.
    let sawAnyData = false
    const markData = () => {
      sawAnyData = true
    }
    sock.ev.on('messaging-history.set', markData)
    sock.ev.on('chats.upsert', markData)
    sock.ev.on('contacts.upsert', markData)
    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'open') {
        setTimeout(() => {
          if (!sawAnyData) {
            console.warn(
              '[baileys] no chats / contacts / history after 15s. WhatsApp may have already synced this device. Try Relink and on the phone first remove the existing linked device.',
            )
          }
        }, 15000)
      }
    })

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
        scheduleSyncIdleFallback(30000)
        broadcast(IPC_CHANNELS.chatsUpdated)
        void hydrateMissingGroupNames(sock)
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

async function hydrateMissingGroupNames(sock: WASocket): Promise<void> {
  const jids = listPlaceholderGroupJids()
  if (jids.length === 0) return

  for (const jid of jids) {
    try {
      const meta = await sock.groupMetadata(jid)
      upsertGroupInfo(meta)
      broadcast(IPC_CHANNELS.chatsUpdated)
    } catch {
      // Group metadata can fail for stale/left groups; keep the placeholder.
    }
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
