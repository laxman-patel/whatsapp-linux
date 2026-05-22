import type { ProtocolMessage } from '../protocol/types'
import {
  bulkUpsertHistoryMessages,
  upsertMessageFromProtocol,
} from '../db/repositories'
import { recordHistoryChunk, scheduleChatsNotify } from '../sync-progress'

const queue: ProtocolMessage[] = []
let draining = false
let meId = 'me@s.whatsapp.net'
let historySyncActive = false

export function setSyncQueueMeId(id: string): void {
  meId = id
}

export function setHistorySyncActive(active: boolean): void {
  historySyncActive = active
}

export function isHistorySyncActive(): boolean {
  return historySyncActive
}

/** Batch history messages during initial sync for better SQLite throughput. */
export function enqueueHistoryMessage(msg: ProtocolMessage): void {
  queue.push(msg)
  if (!draining) void drain()
}

export function upsertLiveMessage(msg: ProtocolMessage): ReturnType<typeof upsertMessageFromProtocol> {
  return upsertMessageFromProtocol(msg, meId)
}

async function drain(): Promise<void> {
  draining = true
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, Math.min(queue.length, 500))

      try {
        const inserted = bulkUpsertHistoryMessages(batch, meId)
        if (inserted > 0) {
          recordHistoryChunk({ messages: inserted })
          scheduleChatsNotify(true)
        }
      } catch (err) {
        console.error('[whatsmeow] history batch flush failed:', err)
      }

      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  } finally {
    draining = false
  }
}

export async function flushHistoryQueue(): Promise<void> {
  while (queue.length > 0 || draining) {
    if (!draining && queue.length > 0) await drain()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}
