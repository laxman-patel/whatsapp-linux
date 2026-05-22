import {
  createClient,
  type WhatsmeowClient,
} from '@whatsmeow-node/whatsmeow-node'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import QRCode from 'qrcode'
import type { ConnectionStatus } from '../../../src/shared/ipc'
import { IPC_CHANNELS } from '../../../src/shared/ipc'
import { broadcast } from '../broadcast'
import { clearDatabase } from '../db'
import { registerWhatsmeowHandlers, hydrateMissingGroupNames } from './handlers'
import {
  beginSync,
  resetSyncProgress,
  scheduleSyncIdleFallback,
} from '../sync-progress'
import {
  listChatsMissingAvatar,
} from '../db/repositories'
import { queueAvatarFetches, resetAvatarCache } from './avatars'
import { hydrateContactAliasesFromPhonebook } from './contact-aliases'
import { attachHistoryBackfillClient, resetHistoryBackfill } from './history-backfill'

export interface ConnectionPayload {
  status: ConnectionStatus
  message?: string
}

type ConnectionListener = (payload: ConnectionPayload) => void
type QrListener = (dataUrl: string) => void

let client: WhatsmeowClient | null = null
let starting = false
let currentState: ConnectionPayload = { status: 'disconnected' }

const connectionListeners = new Set<ConnectionListener>()
const qrListeners = new Set<QrListener>()

const AUTH_FORMAT_VERSION = 'whatsmeow-1'

async function ensureCompatibleAuthState(): Promise<void> {
  const dir = getAuthDir()
  const stampFile = path.join(dir, '.app-auth-version')
  await fs.mkdir(dir, { recursive: true })
  let stamp = ''
  try {
    stamp = (await fs.readFile(stampFile, 'utf8')).trim()
  } catch {
    // first launch
  }
  if (stamp !== AUTH_FORMAT_VERSION) {
    await fs.rm(dir, { recursive: true, force: true })
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(stampFile, AUTH_FORMAT_VERSION, 'utf8')
    try {
      clearDatabase()
    } catch (err) {
      console.warn('[whatsmeow] clearDatabase during auth reset failed:', err)
    }
  }
}

export function getAuthDir(): string {
  return path.join(app.getPath('userData'), 'whatsmeow-auth')
}

function getSessionStorePath(): string {
  return path.join(getAuthDir(), 'session.db')
}

function resolveWhatsmeowBinary(): string | undefined {
  const name = process.platform === 'win32' ? 'whatsmeow-node.exe' : 'whatsmeow-node'

  const projectBin = path.join(app.getAppPath(), 'bin', name)
  if (existsSync(projectBin)) return projectBin

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'whatsmeow-bin', name)
  }

  return undefined
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

export function getClient(): WhatsmeowClient | null {
  return client
}

/** @deprecated use getClient — kept for ipc migration */
export function getSocket(): WhatsmeowClient | null {
  return client
}

export async function startWhatsApp(): Promise<void> {
  if (client || starting) return

  starting = true
  setState({ status: 'connecting', message: 'Connecting to WhatsApp…' })

  try {
    await ensureCompatibleAuthState()

    const binaryPath = resolveWhatsmeowBinary()
    if (!binaryPath) {
      console.warn(
        '[whatsmeow] Patched binary not found at bin/whatsmeow-node — run npm run build:whatsmeow. Message history may not load.',
      )
    }
    const wa = createClient({
      store: getSessionStorePath(),
      ...(binaryPath ? { binaryPath } : {}),
      commandTimeout: 60_000,
    })

    client = wa
    registerWhatsmeowHandlers(wa)

    wa.on('qr', async ({ code }) => {
      setState({ status: 'qr', message: 'Scan with WhatsApp on your phone' })
      try {
        const dataUrl = await QRCode.toDataURL(code, { margin: 2, width: 280 })
        emitQr(dataUrl)
      } catch {
        emitQr(code)
      }
    })

    wa.on('connected', () => {
      setState({ status: 'connected' })
      attachHistoryBackfillClient(wa)
      beginSync()
      scheduleSyncIdleFallback(600_000)
      broadcast(IPC_CHANNELS.chatsUpdated)
      void hydrateMissingGroupNames(wa)
      void hydrateContactAliasesFromPhonebook(wa)
      queueAvatarFetches(listChatsMissingAvatar())
    })

    wa.on('disconnected', () => {
      if (currentState.status === 'connected') {
        setState({ status: 'connecting', message: 'Reconnecting…' })
      }
    })

    wa.on('logged_out', ({ reason }) => {
      client = null
      setState({
        status: 'error',
        message: reason || 'Session ended. Scan QR to link again.',
      })
    })

    wa.on('error', (err) => {
      console.error('[whatsmeow] client error:', err)
    })

    wa.on('exit', ({ code }) => {
      console.warn('[whatsmeow] subprocess exited code=' + code)
      client = null
      if (currentState.status !== 'error') {
        setState({ status: 'connecting', message: 'Restarting WhatsApp client…' })
        setTimeout(() => void startWhatsApp(), 2000)
      }
    })

    const { jid } = await wa.init()

    if (!jid) {
      await wa.getQRChannel()
    }

    await wa.connect()
  } catch (err) {
    client = null
    const msg =
      err instanceof Error ? err.message : 'Failed to start WhatsApp client'
    setState({ status: 'error', message: msg })
  } finally {
    starting = false
  }
}

export async function logoutWhatsApp(): Promise<void> {
  const wa = client
  client = null
  starting = false

  if (wa) {
    try {
      await wa.logout()
    } catch {
      // session may already be invalid
    }
    try {
      wa.close()
    } catch {
      // ignore
    }
  }

  try {
    await fs.rm(getAuthDir(), { recursive: true, force: true })
  } catch {
    // ignore
  }

  clearDatabase()
  resetSyncProgress()
  resetAvatarCache()
  resetHistoryBackfill()

  setState({ status: 'connecting', message: 'Starting fresh session…' })
  await startWhatsApp()
}

export async function retryWhatsApp(): Promise<void> {
  if (client) {
    try {
      client.close()
    } catch {
      // ignore
    }
  }
  client = null
  starting = false
  await startWhatsApp()
}
