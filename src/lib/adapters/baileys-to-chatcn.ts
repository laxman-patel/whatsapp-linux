import { format, isToday, isYesterday } from 'date-fns'
import type { ChatMessageData, ChatUser } from '@/components/ui/chat'
import type { ChatSummary, MessageRecord } from '@/shared/ipc'

export const CURRENT_USER: ChatUser = {
  id: 'me@s.whatsapp.net',
  name: 'You',
  status: 'online',
}

function formatChatTime(timestamp: number): string {
  if (isToday(timestamp)) return format(timestamp, 'h:mm a')
  if (isYesterday(timestamp)) return 'Yesterday'
  return format(timestamp, 'MMM d')
}

export function chatSummaryToSidebar(convo: ChatSummary) {
  return {
    id: convo.jid,
    title: convo.title,
    lastMessage: convo.lastMessage,
    lastMessageTime: convo.lastMessageTime
      ? formatChatTime(convo.lastMessageTime)
      : undefined,
    unreadCount: convo.unreadCount,
    isGroup: convo.isGroup,
  }
}

export function messageToChatcn(
  msg: MessageRecord,
  isGroup: boolean,
): ChatMessageData {
  return {
    id: msg.id,
    senderId: msg.isFromMe ? CURRENT_USER.id : msg.senderId,
    senderName: msg.isFromMe ? 'You' : msg.senderName,
    text: msg.text,
    timestamp: msg.timestamp,
    status: msg.status,
    // Show sender name above bubble in groups for incoming messages
    ...(isGroup && !msg.isFromMe ? {} : {}),
  }
}
