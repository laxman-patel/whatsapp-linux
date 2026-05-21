import type { Chat, Contact, WAMessage } from '@whiskeysockets/baileys'
import {
  bulkUpsertHistoryMessages,
  upsertChatsFromBaileys,
  upsertContacts,
} from '../db/repositories'
import {
  recordHistoryChunk,
  scheduleChatsNotify,
} from '../sync-progress'

interface HistoryChunk {
  chats?: Chat[]
  contacts?: Contact[]
  messages?: WAMessage[]
  progress?: number | null
  isLatest?: boolean
}

const queue: HistoryChunk[] = []
let draining = false
let meId = 'me@s.whatsapp.net'

export function setSyncQueueMeId(id: string): void {
  meId = id
}

/**
 * Enqueue a `messaging-history.set` chunk. Chunks arrive faster than SQLite can
 * commit them on first sync, so we coalesce as many pending chunks as possible
 * into a single transaction and yield between batches so Baileys can keep
 * decrypting in parallel.
 */
export function enqueueHistoryChunk(chunk: HistoryChunk): void {
  queue.push(chunk)
  if (!draining) void drain()
}

async function drain(): Promise<void> {
  draining = true
  try {
    while (queue.length > 0) {
      // Take everything that's already buffered. Newer chunks that arrive
      // while we flush will be picked up on the next loop iteration.
      const batch = queue.splice(0, queue.length)

      const chats: Chat[] = []
      const contacts: Contact[] = []
      const messages: WAMessage[] = []
      let lastProgress: number | null | undefined
      let isLatest = false

      for (const c of batch) {
        if (c.chats?.length) chats.push(...c.chats)
        if (c.contacts?.length) contacts.push(...c.contacts)
        if (c.messages?.length) messages.push(...c.messages)
        if (c.progress != null) lastProgress = c.progress
        if (c.isLatest) isLatest = true
      }

      try {
        if (contacts.length) upsertContacts(contacts)
        if (chats.length) upsertChatsFromBaileys(chats)

        // Get the sidebar to paint before the heavy message insert runs.
        if (chats.length || contacts.length) {
          recordHistoryChunk({
            chats: chats.length,
            contacts: contacts.length,
            progress: lastProgress ?? undefined,
            isLatest: messages.length === 0 ? isLatest : undefined,
          })
          scheduleChatsNotify(true)
        }

        if (messages.length) {
          // Yield once so the chat-list refresh paints first.
          await new Promise<void>((resolve) => setImmediate(resolve))

          const inserted = bulkUpsertHistoryMessages(messages, meId)
          recordHistoryChunk({
            messages: inserted,
            progress: lastProgress ?? undefined,
            isLatest,
          })
          scheduleChatsNotify()
        }
      } catch (err) {
        console.error('[sync-queue] flush failed:', err)
      }

      // Co-operative yield so Baileys can keep emitting / decrypting.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  } finally {
    draining = false
  }
}
