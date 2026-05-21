import { useCallback, useEffect, useState } from 'react'
import type { ChatFilter, ChatSummary, MessageRecord } from '@/shared/ipc'

export function useSettings() {
  const [chatFilter, setChatFilterState] = useState<ChatFilter>('all')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setChatFilterState(s.chatFilter)
      setLoaded(true)
    })
  }, [])

  const setChatFilter = useCallback(async (filter: ChatFilter) => {
    setChatFilterState(filter)
    await window.api.setChatFilter(filter)
  }, [])

  return { chatFilter, setChatFilter, loaded }
}

export function useChats(filter: ChatFilter, search: string) {
  const [chats, setChats] = useState<ChatSummary[]>([])

  const refresh = useCallback(async () => {
    const list = await window.api.listChats(filter, search)
    setChats(list)
  }, [filter, search])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return window.api.onChatsUpdated(() => {
      void refresh()
    })
  }, [refresh])

  return { chats, refresh }
}

export function useMessages(jid: string | undefined) {
  const [messages, setMessages] = useState<MessageRecord[]>([])

  const refresh = useCallback(async () => {
    if (!jid) {
      setMessages([])
      return
    }
    const result = await window.api.listMessages(jid)
    setMessages(result.messages)
  }, [jid])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!jid) return
    return window.api.onMessagesUpdated((updatedJid) => {
      if (updatedJid === jid) void refresh()
    })
  }, [jid, refresh])

  return { messages, refresh }
}

export function useAuthStatus() {
  const [status, setStatus] = useState<string>('connecting')
  const [message, setMessage] = useState<string | undefined>()

  useEffect(() => {
    window.api.getAuthStatus().then((s) => {
      setStatus(s.status)
      setMessage(s.message)
    })
    return window.api.onConnectionUpdate((s) => setStatus(s))
  }, [])

  return { status, message }
}
