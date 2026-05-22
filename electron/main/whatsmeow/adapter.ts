import type { MessageInfo, SendResponse } from '@whatsmeow-node/whatsmeow-node'
import type { ProtocolChat, ProtocolContact, ProtocolMessage } from '../protocol/types'

export function messageEventToProtocol(
  info: MessageInfo,
  message: Record<string, unknown>,
): ProtocolMessage {
  const sender = info.sender
  return {
    key: {
      remoteJid: info.chat,
      id: info.id,
      fromMe: info.isFromMe,
      participant: info.isGroup ? sender : undefined,
      participantPn: sender.endsWith('@s.whatsapp.net') ? sender : undefined,
      participantLid: sender.endsWith('@lid') ? sender : undefined,
    },
    message,
    messageTimestamp: info.timestamp,
    pushName: info.pushName,
  }
}

export function sentMessageToProtocol(
  jid: string,
  text: string,
  sent: SendResponse,
): ProtocolMessage {
  return {
    key: {
      remoteJid: jid,
      id: sent.id,
      fromMe: true,
    },
    message: { conversation: text },
    messageTimestamp: sent.timestamp,
    pushName: 'You',
    status: 2,
  }
}

export function groupInfoToProtocolChat(jid: string, name: string): ProtocolChat {
  return { id: jid, name }
}

export function pushNameToContact(jid: string, pushName: string): ProtocolContact {
  return {
    id: jid,
    jid,
    notify: pushName,
  }
}
