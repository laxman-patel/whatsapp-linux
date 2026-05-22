import Database from 'better-sqlite3'
import path from 'node:path'
import type { WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node'
import {
  countMessagesForChat,
  getOldestMessageAnchor,
} from '../db/repositories'
import { getAuthDir } from './client'
import { recordHistoryChunk } from '../sync-progress'
import { getHistoryQueueLength, isHistoryQueueDraining } from './sync-queue'

const PARALLEL_REQUESTS = 12
const HISTORY_PAGE_SIZE = 50
const RESPONSE_WAIT_MS = 2000
const MAX_PAGES_PER_CHAT = 300
const EMPTY_PAGES_BEFORE_DONE = 2
const RESCAN_MS = 12_000
const IDLE_DEBOUNCE_MS = 4000

interface MessageAnchor {
  chat: string
  sender: string
  id: string
  timestamp: number
}

interface PendingRequest {
  countAtSend: number
  sentAt: number
}

interface ChatProgress {
  pages: number
  emptyPages: number
  noAnchor: boolean
}

const pending = new Set<string>()
const inFlight = new Set<string>()
const exhausted = new Set<string>()
const awaitingResponse = new Map<string, PendingRequest>()
const chatProgress = new Map<string, ChatProgress>()

let clientRef: WhatsmeowClient | null = null
let requestPumpRunning = false
let responsePollerRunning = false
let rescanTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let idleListener: (() => void) | null = null
let sessionAnchorsCache: Map<string, MessageAnchor> | null = null
let lidPhoneCache: Map<string, string> | null = null
let totalPagesRequested = 0
let responsePollerTimer: ReturnType<typeof setInterval> | null = null

export function onHistoryBackfillIdle(listener: () => void): void {
  idleListener = listener
}

export function isBackfillBusy(): boolean {
  return (
    pending.size > 0 ||
    inFlight.size > 0 ||
    awaitingResponse.size > 0 ||
    requestPumpRunning ||
    responsePollerRunning ||
    isHistoryQueueDraining() ||
    getHistoryQueueLength() > 0
  )
}

export function getBackfillStats() {
  return {
    pending: pending.size,
    inFlight: inFlight.size,
    awaiting: awaitingResponse.size,
    exhausted: exhausted.size,
    pagesRequested: totalPagesRequested,
  }
}

function normalizeJid(raw: string, suffix: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.includes('@')) return trimmed
  return `${trimmed}${suffix}`
}

function readSessionAnchors(): Map<string, MessageAnchor> {
  if (sessionAnchorsCache) return sessionAnchorsCache
  const sessionPath = path.join(getAuthDir(), 'session.db')
  const anchors = new Map<string, MessageAnchor>()

  let sessionDb: Database.Database
  try {
    sessionDb = new Database(sessionPath, { readonly: true, fileMustExist: true })
  } catch {
    return anchors
  }

  try {
    const rows = sessionDb
      .prepare(
        `SELECT chat_jid, sender_jid, message_id
         FROM whatsmeow_message_secrets
         WHERE chat_jid NOT LIKE '0@%'
         GROUP BY chat_jid`,
      )
      .all() as { chat_jid: string; sender_jid: string; message_id: string }[]

    const nowSec = Math.floor(Date.now() / 1000)
    for (const row of rows) {
      const chat = row.chat_jid.trim()
      if (!chat || chat === '0@s.whatsapp.net') continue
      anchors.set(chat, {
        chat,
        sender: normalizeJid(row.sender_jid, '@s.whatsapp.net'),
        id: row.message_id,
        timestamp: nowSec,
      })
    }
  } finally {
    sessionDb.close()
  }

  sessionAnchorsCache = anchors
  return anchors
}

function readLidPhoneMap(): Map<string, string> {
  if (lidPhoneCache) return lidPhoneCache
  const map = new Map<string, string>()
  const sessionPath = path.join(getAuthDir(), 'session.db')
  let sessionDb: Database.Database
  try {
    sessionDb = new Database(sessionPath, { readonly: true, fileMustExist: true })
  } catch {
    return map
  }
  try {
    const rows = sessionDb
      .prepare('SELECT lid, pn FROM whatsmeow_lid_map')
      .all() as { lid: string; pn: string }[]
    for (const row of rows) {
      map.set(normalizeJid(row.lid, '@lid'), normalizeJid(row.pn, '@s.whatsapp.net'))
    }
  } finally {
    sessionDb.close()
  }
  lidPhoneCache = map
  return map
}

function anchorForChat(chatJid: string): MessageAnchor | null {
  const fromDb = getOldestMessageAnchor(chatJid)
  if (fromDb) return fromDb
  return readSessionAnchors().get(chatJid) ?? null
}

function anchorCandidates(chatJid: string): MessageAnchor[] {
  const primary = anchorForChat(chatJid)
  if (!primary) return []

  const candidates = [primary]
  if (chatJid.endsWith('@lid')) {
    const phoneJid = readLidPhoneMap().get(chatJid)
    if (phoneJid) candidates.push({ ...primary, chat: phoneJid })
  }
  return candidates
}

function progressFor(chatJid: string): ChatProgress {
  let p = chatProgress.get(chatJid)
  if (!p) {
    p = { pages: 0, emptyPages: 0, noAnchor: false }
    chatProgress.set(chatJid, p)
  }
  return p
}

function discoverBackfillTargets(): string[] {
  const targets = new Set<string>()

  for (const chat of readSessionAnchors().keys()) {
    if (!chat.endsWith('@newsletter') && chat !== 'status@broadcast') {
      targets.add(chat)
    }
  }

  return [...targets].filter((jid) => !exhausted.has(jid))
}

function enqueue(chatJid: string): void {
  if (exhausted.has(chatJid)) return
  pending.add(chatJid)
}

function scheduleIdleCheck(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!isBackfillBusy()) idleListener?.()
  }, IDLE_DEBOUNCE_MS)
}

async function sendHistoryRequest(
  client: WhatsmeowClient,
  chatJid: string,
): Promise<boolean> {
  const candidates = anchorCandidates(chatJid)
  if (candidates.length === 0) {
    progressFor(chatJid).noAnchor = true
    exhausted.add(chatJid)
    return false
  }

  for (const anchor of candidates) {
    try {
      const req = await client.buildHistorySyncRequest(
        {
          chat: anchor.chat,
          sender: anchor.sender,
          id: anchor.id,
          timestamp: anchor.timestamp,
        },
        HISTORY_PAGE_SIZE,
      )
      await client.sendPeerMessage(req)
      totalPagesRequested++
      awaitingResponse.set(chatJid, {
        countAtSend: countMessagesForChat(chatJid),
        sentAt: Date.now(),
      })
      return true
    } catch (err) {
      console.warn('[whatsmeow] history request failed', chatJid, anchor.chat, err)
    }
  }

  progressFor(chatJid).noAnchor = true
  exhausted.add(chatJid)
  return false
}

async function processOneChat(client: WhatsmeowClient, chatJid: string): Promise<void> {
  const prog = progressFor(chatJid)
  if (exhausted.has(chatJid) || prog.noAnchor) return
  if (prog.pages >= MAX_PAGES_PER_CHAT) {
    exhausted.add(chatJid)
    return
  }

  const sent = await sendHistoryRequest(client, chatJid)
  if (!sent) return

  prog.pages++
}

async function requestPump(): Promise<void> {
  if (requestPumpRunning) return
  requestPumpRunning = true

  try {
    const client = clientRef
    if (!client) return

    while (pending.size > 0 && inFlight.size < PARALLEL_REQUESTS) {
      const batch: string[] = []
      for (const jid of pending) {
        if (batch.length >= PARALLEL_REQUESTS) break
        if (inFlight.has(jid) || exhausted.has(jid)) continue
        batch.push(jid)
      }

      if (batch.length === 0) {
        for (const jid of [...pending]) {
          if (exhausted.has(jid) || inFlight.has(jid) || awaitingResponse.has(jid)) {
            pending.delete(jid)
          }
        }
        if (pending.size > 0) continue
        break
      }

      for (const jid of batch) {
        pending.delete(jid)
        inFlight.add(jid)
      }

      await Promise.all(batch.map((jid) => processOneChat(client, jid)))

      for (const jid of batch) inFlight.delete(jid)
    }
  } finally {
    requestPumpRunning = false
    scheduleIdleCheck()
  }
}

async function responsePoller(): Promise<void> {
  if (responsePollerRunning) return
  responsePollerRunning = true

  try {
    const now = Date.now()
    const ready: string[] = []

    for (const [chatJid, req] of awaitingResponse) {
      if (now - req.sentAt < RESPONSE_WAIT_MS) continue
      ready.push(chatJid)
    }

    for (const chatJid of ready) {
      const req = awaitingResponse.get(chatJid)
      if (!req) continue
      awaitingResponse.delete(chatJid)
      const prog = progressFor(chatJid)
      const after = countMessagesForChat(chatJid)
      const grew = after > req.countAtSend

      if (grew) {
        prog.emptyPages = 0
        recordHistoryChunk({ messages: after - req.countAtSend })
        if (prog.pages < MAX_PAGES_PER_CHAT && !prog.noAnchor) {
          enqueue(chatJid)
        } else {
          exhausted.add(chatJid)
        }
      } else {
        prog.emptyPages++
        if (prog.emptyPages >= EMPTY_PAGES_BEFORE_DONE || prog.noAnchor) {
          exhausted.add(chatJid)
        } else if (prog.pages < MAX_PAGES_PER_CHAT && !prog.noAnchor) {
          enqueue(chatJid)
        }
      }
    }

    if (ready.length > 0 || pending.size > 0) {
      void requestPump()
    }
  } finally {
    responsePollerRunning = false
    scheduleIdleCheck()
  }
}

function startRescanLoop(): void {
  if (rescanTimer) return
  rescanTimer = setInterval(() => {
    for (const jid of discoverBackfillTargets()) {
      if (!exhausted.has(jid) && !inFlight.has(jid) && !awaitingResponse.has(jid)) {
        enqueue(jid)
      }
    }
    void requestPump()
    void responsePoller()
  }, RESCAN_MS)
}

function stopRescanLoop(): void {
  if (rescanTimer) {
    clearInterval(rescanTimer)
    rescanTimer = null
  }
}

export function attachHistoryBackfillClient(client: WhatsmeowClient | null): void {
  clientRef = client
  if (client) {
    startRescanLoop()
    if (!responsePollerTimer) {
      responsePollerTimer = setInterval(() => void responsePoller(), 1000)
    }
  } else {
    stopRescanLoop()
    if (responsePollerTimer) {
      clearInterval(responsePollerTimer)
      responsePollerTimer = null
    }
  }
}

export function queueHistoryBackfill(chatJids?: string[]): void {
  if (!clientRef) return

  const targets = chatJids ?? discoverBackfillTargets()

  for (const jid of targets) {
    enqueue(jid)
  }

  void requestPump()
}

export function resetHistoryBackfill(): void {
  pending.clear()
  inFlight.clear()
  exhausted.clear()
  awaitingResponse.clear()
  chatProgress.clear()
  clientRef = null
  sessionAnchorsCache = null
  lidPhoneCache = null
  totalPagesRequested = 0
  stopRescanLoop()
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (responsePollerTimer) {
    clearInterval(responsePollerTimer)
    responsePollerTimer = null
  }
}
