import { app, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { getChatAvatarPath, setChatAvatarPath } from '../db/repositories'
import { broadcast } from '../broadcast'
import { IPC_CHANNELS } from '../../../src/shared/ipc'
import { getSocket } from './client'

// Re-export for main-side URL building (shared module is renderer-safe).
export { avatarUrlForJid } from '../../../src/shared/avatar'

/**
 * Avatar (WhatsApp profile picture) cache.
 *
 * Calls `sock.profilePictureUrl(jid)` to discover the current photo URL,
 * downloads it to disk, and serves it via the `wa-avatar://` protocol.
 */

const AVATAR_FETCH_CONCURRENCY = 3
const AVATAR_FETCH_DELAY_MS = 200
const AVATAR_FETCH_TIMEOUT_MS = 20_000
const queue: string[] = []
const inFlight = new Set<string>()
let running = 0
let drainTimer: ReturnType<typeof setTimeout> | null = null

function avatarDir(): string {
  return path.join(app.getPath('userData'), 'avatars')
}

export function avatarFilePath(jid: string): string {
  const hash = crypto.createHash('sha1').update(jid).digest('hex')
  return path.join(avatarDir(), `${hash}.jpg`)
}

function parseJidFromRequest(url: string): string | null {
  try {
    const parsed = new URL(url)
    // wa-avatar://d/<encoded-jid>
    const encoded = parsed.pathname.replace(/^\/+/, '')
    if (!encoded) return null
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

async function resolveAvatarFile(jid: string): Promise<string | null> {
  const candidates = [getChatAvatarPath(jid), avatarFilePath(jid)].filter(Boolean) as string[]
  for (const filePath of candidates) {
    try {
      await fs.access(filePath)
      return filePath
    } catch {
      /* try next */
    }
  }
  return null
}

export function registerAvatarProtocol(): void {
  protocol.handle('wa-avatar', async (request) => {
    try {
      const jid = parseJidFromRequest(request.url)
      if (!jid) return new Response('Bad request', { status: 400 })

      const filePath = await resolveAvatarFile(jid)
      if (!filePath) return new Response('Not found', { status: 404 })

      const data = await fs.readFile(filePath)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } catch (err) {
      console.error('[avatars] protocol error:', err)
      return new Response('Error', { status: 500 })
    }
  })
}

export async function hydrateAvatarCacheFromDisk(): Promise<void> {
  try {
    const dir = avatarDir()
    const files = await fs.readdir(dir)
    for (const file of files) {
      if (!file.endsWith('.jpg')) continue
      // Files are keyed by sha1(jid); DB rows are reconciled on next successful fetch.
      void file
    }
  } catch {
    /* no cache dir yet */
  }
}

export function queueAvatarFetches(jids: string[]): void {
  let added = false
  for (const jid of jids) {
    const canFetchAvatar =
      jid.endsWith('@s.whatsapp.net') ||
      jid.endsWith('@g.us') ||
      jid.endsWith('@lid')
    if (!canFetchAvatar) continue
    if (inFlight.has(jid) || queue.includes(jid)) continue
    if (getChatAvatarPath(jid)) continue
    queue.push(jid)
    added = true
  }
  if (added) scheduleDrain()
}

function scheduleDrain(): void {
  if (drainTimer) return
  drainTimer = setTimeout(() => {
    drainTimer = null
    void drain()
  }, 0)
}

async function drain(): Promise<void> {
  while (queue.length > 0 && running < AVATAR_FETCH_CONCURRENCY) {
    const jid = queue.shift()
    if (!jid) break
    running++
    inFlight.add(jid)
    void fetchOne(jid).finally(() => {
      running--
      inFlight.delete(jid)
      if (queue.length > 0) {
        setTimeout(() => void drain(), AVATAR_FETCH_DELAY_MS)
      }
    })
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function fetchOne(jid: string): Promise<void> {
  const sock = getSocket()
  if (!sock) return

  const filePath = avatarFilePath(jid)
  if (await fileExists(filePath)) {
    setChatAvatarPath(jid, filePath)
    broadcast(IPC_CHANNELS.chatsUpdated)
    return
  }

  let url: string | undefined
  for (const type of ['image', 'preview'] as const) {
    try {
      url = await sock.profilePictureUrl(jid, type, AVATAR_FETCH_TIMEOUT_MS)
      if (url) break
    } catch {
      /* try next size / privacy block */
    }
  }
  if (!url) return

  try {
    await fs.mkdir(avatarDir(), { recursive: true })
    const response = await fetch(url)
    if (!response.ok) return
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 64) return
    await fs.writeFile(filePath, buffer)
    setChatAvatarPath(jid, filePath)
    broadcast(IPC_CHANNELS.chatsUpdated)
  } catch (err) {
    console.warn('[avatars] failed to fetch', jid, err)
  }
}

export function resetAvatarCache(): void {
  queue.length = 0
  inFlight.clear()
}
