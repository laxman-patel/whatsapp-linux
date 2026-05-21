import type { ChatFilter, ChatSummary, MessageRecord } from '../../src/shared/ipc'

const CURRENT_USER_ID = 'me@s.whatsapp.net'

const chats: ChatSummary[] = [
  {
    id: 'alice',
    jid: '12025550101@s.whatsapp.net',
    title: 'Alice Chen',
    isGroup: false,
    lastMessage: 'See you tomorrow!',
    lastMessageTime: Date.now() - 1000 * 60 * 15,
    unreadCount: 2,
  },
  {
    id: 'bob',
    jid: '12025550102@s.whatsapp.net',
    title: 'Bob Martinez',
    isGroup: false,
    lastMessage: 'Thanks for the photos',
    lastMessageTime: Date.now() - 1000 * 60 * 60 * 3,
    unreadCount: 0,
  },
  {
    id: 'family',
    jid: '12036300101@g.us',
    title: 'Family Group',
    isGroup: true,
    lastMessage: 'Mom: Dinner at 7?',
    lastMessageTime: Date.now() - 1000 * 60 * 45,
    unreadCount: 5,
  },
  {
    id: 'work',
    jid: '12036300102@g.us',
    title: 'Work Team',
    isGroup: true,
    lastMessage: 'Sarah: Standup moved to 10am',
    lastMessageTime: Date.now() - 1000 * 60 * 60 * 2,
    unreadCount: 0,
  },
]

const messagesByJid: Record<string, MessageRecord[]> = {
  '12025550101@s.whatsapp.net': [
    {
      id: 'm1',
      chatJid: '12025550101@s.whatsapp.net',
      senderId: '12025550101@s.whatsapp.net',
      senderName: 'Alice Chen',
      text: 'Hey! Are we still on for coffee?',
      timestamp: Date.now() - 1000 * 60 * 60,
      isFromMe: false,
    },
    {
      id: 'm2',
      chatJid: '12025550101@s.whatsapp.net',
      senderId: CURRENT_USER_ID,
      senderName: 'You',
      text: 'Yes, 3pm works for me',
      timestamp: Date.now() - 1000 * 60 * 30,
      status: 'read',
      isFromMe: true,
    },
    {
      id: 'm3',
      chatJid: '12025550101@s.whatsapp.net',
      senderId: '12025550101@s.whatsapp.net',
      senderName: 'Alice Chen',
      text: 'See you tomorrow!',
      timestamp: Date.now() - 1000 * 60 * 15,
      isFromMe: false,
    },
  ],
  '12025550102@s.whatsapp.net': [
    {
      id: 'm4',
      chatJid: '12025550102@s.whatsapp.net',
      senderId: CURRENT_USER_ID,
      senderName: 'You',
      text: 'Here are the photos from the hike',
      timestamp: Date.now() - 1000 * 60 * 60 * 5,
      status: 'delivered',
      isFromMe: true,
    },
    {
      id: 'm5',
      chatJid: '12025550102@s.whatsapp.net',
      senderId: '12025550102@s.whatsapp.net',
      senderName: 'Bob Martinez',
      text: 'Thanks for the photos',
      timestamp: Date.now() - 1000 * 60 * 60 * 3,
      isFromMe: false,
    },
  ],
  '12036300101@g.us': [
    {
      id: 'm6',
      chatJid: '12036300101@g.us',
      senderId: '12025550103@s.whatsapp.net',
      senderName: 'Mom',
      text: 'Who is bringing dessert?',
      timestamp: Date.now() - 1000 * 60 * 90,
      isFromMe: false,
    },
    {
      id: 'm7',
      chatJid: '12036300101@g.us',
      senderId: CURRENT_USER_ID,
      senderName: 'You',
      text: 'I can bring apple pie',
      timestamp: Date.now() - 1000 * 60 * 60,
      status: 'read',
      isFromMe: true,
    },
    {
      id: 'm8',
      chatJid: '12036300101@g.us',
      senderId: '12025550103@s.whatsapp.net',
      senderName: 'Mom',
      text: 'Dinner at 7?',
      timestamp: Date.now() - 1000 * 60 * 45,
      isFromMe: false,
    },
  ],
  '12036300102@g.us': [
    {
      id: 'm9',
      chatJid: '12036300102@g.us',
      senderId: '12025550104@s.whatsapp.net',
      senderName: 'Sarah',
      text: 'Standup moved to 10am',
      timestamp: Date.now() - 1000 * 60 * 60 * 2,
      isFromMe: false,
    },
    {
      id: 'm10',
      chatJid: '12036300102@g.us',
      senderId: CURRENT_USER_ID,
      senderName: 'You',
      text: 'Got it, thanks!',
      timestamp: Date.now() - 1000 * 60 * 60,
      status: 'sent',
      isFromMe: true,
    },
  ],
}

const groupMeta: Record<string, { participantCount: number }> = {
  '12036300101@g.us': { participantCount: 6 },
  '12036300102@g.us': { participantCount: 12 },
}

export function listMockChats(filter: ChatFilter, search?: string): ChatSummary[] {
  let result = chats

  if (filter === 'dm') {
    result = result.filter((c) => !c.isGroup)
  } else if (filter === 'group') {
    result = result.filter((c) => c.isGroup)
  }

  if (search?.trim()) {
    const q = search.trim().toLowerCase()
    result = result.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.lastMessage?.toLowerCase().includes(q),
    )
  }

  return [...result].sort(
    (a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0),
  )
}

export function getMockMessages(jid: string): MessageRecord[] {
  return messagesByJid[jid] ?? []
}

export function getMockGroupMeta(jid: string) {
  return groupMeta[jid]
}

export function sendMockText(jid: string, text: string): MessageRecord {
  const msg: MessageRecord = {
    id: `m-${Date.now()}`,
    chatJid: jid,
    senderId: CURRENT_USER_ID,
    senderName: 'You',
    text,
    timestamp: Date.now(),
    status: 'sent',
    isFromMe: true,
  }

  if (!messagesByJid[jid]) {
    messagesByJid[jid] = []
  }
  messagesByJid[jid].push(msg)

  const chat = chats.find((c) => c.jid === jid)
  if (chat) {
    chat.lastMessage = text
    chat.lastMessageTime = msg.timestamp
  }

  return msg
}

export { CURRENT_USER_ID }
