import type { MessageRecord } from '../../../src/shared/ipc'
import { broadcast } from '../broadcast'
import { IPC_CHANNELS } from '../../../src/shared/ipc'
import { upsertMessageFromProtocol } from '../db/repositories'
import { getClient } from './client'
import { getMeId } from './handlers'
import { sentMessageToProtocol } from './adapter'

export async function sendTextMessage(
  jid: string,
  text: string,
): Promise<MessageRecord> {
  const wa = getClient()
  if (!wa) throw new Error('Not connected to WhatsApp')

  const trimmed = text.trim()
  if (!trimmed) throw new Error('Message cannot be empty')

  const sent = await wa.sendMessage(jid, { conversation: trimmed })
  const protocolMsg = sentMessageToProtocol(jid, trimmed, sent)

  const record =
    upsertMessageFromProtocol(protocolMsg, getMeId()) ??
    ({
      id: `${jid}:${sent.id}`,
      chatJid: jid,
      senderId: getMeId(),
      senderName: 'You',
      text: trimmed,
      timestamp: sent.timestamp * 1000,
      status: 'sent',
      isFromMe: true,
    } satisfies MessageRecord)

  broadcast(IPC_CHANNELS.messagesUpdated, jid)
  broadcast(IPC_CHANNELS.chatsUpdated)

  return record
}
