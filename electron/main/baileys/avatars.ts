import { app, net, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { getChatAvatarPath, setChatAvatarPath } from '../db/repositories'
import { broadcast } from '../broadcast'
import { IPC_CHANNELS } from '../../../src/shared/ipc'
import { getSocket } from './client'
import { isRenderableChatJid } from './message-utils'

/**
 * Avatar (WhatsApp profile picture) cache.
 *
 * Calls `sock.profilePictureUrl(jid, 'preview')` to discover the current photo
 * URL, downloads it to disk, and remembers the local path in the chats table.
 *
 * Strict rate-limit because WhatsApp will outright stop serving these (and may
 * temporarily ratelimit the account) if we hammer too fast.
 */

const AVATAR_FETCH_CONCURRENCY = 2
const AVATAR_FETCH_DELAY_MS = 250
const queue: string[] = []
const seen = new Set<string>()
let running = 0
let drainTimer: ReturnType<typeof setTimeout> | null = null

function avatarDir(): string {
  return path.join(app.getPath('userData'), 'avatars')
}

function avatarFilePath(jid: string): string {
  const hash = crypto.createHash('sha1').update(jid).digest('hex')
  return path.join(avatarDir(), `${hash}.jpg`)
}

export function registerAvatarProtocol(): void {
  protocol.handle('wa-avatar', async (request) => {
    try {
      const url = new URL(request.url)
      // wa-avatar://<encoded jid>
      const jid = decodeURIComponent(url.hostname || url.pathname.replace(/^\/+/, ''))
      const stored = getChatAvatarPath(jid)
      if (!stored) return new Response('Not found', { status: 404 })

      try {
        await fs.access(stored)
      } catch {
        return new Response('Not found', { status: 404 })
      }

      return net.fetch(pathToFileURL(stored).toString())
    } catch (err) {
      console.error('[avatars] protocol error:', err)
      return new Response('Error', { status: 500 })
    }
  })
}

export function queueAvatarFetches(jids: string[]): void {
  let added = false
  for (const jid of jids) {
    if (!isRenderableChatJid(jid)) continue
    if (seen.has(jid)) continue
    if (getChatAvatarPath(jid)) {
      seen.add(jid)
      continue
    }
    seen.add(jid)
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
    void fetchOne(jid).finally(() => {
      running--
      if (queue.length > 0) {
        setTimeout(() => void drain(), AVATAR_FETCH_DELAY_MS)
      }
    })
  }
}

async function fetchOne(jid: string): Promise<void> {
  const sock = getSocket()
  if (!sock) return

  let url: string | undefined
  try {
    url = await sock.profilePictureUrl(jid, 'preview')
  } catch {
    // 401 / 404 / privacy blocked. Mark seen so we don't retry every chunk.
    return
  }
  if (!url) return

  try {
    await fs.mkdir(avatarDir(), { recursive: true })
    const response = await fetch(url)
    if (!response.ok) return
    const buffer = Buffer.from(await response.arrayBuffer())
    const filePath = avatarFilePath(jid)
    await fs.writeFile(filePath, buffer)
    setChatAvatarPath(jid, filePath)
    // Tell the renderer to re-pull the sidebar so the new avatar URL appears.
    broadcast(IPC_CHANNELS.chatsUpdated)
  } catch (err) {
    console.warn('[avatars] failed to fetch', jid, err)
  }
}

export function resetAvatarCache(): void {
  queue.length = 0
  seen.clear()
}
