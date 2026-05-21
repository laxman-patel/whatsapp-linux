import { useCallback, useEffect, useState } from 'react'
import type {
  ChatFilter,
  ChatSummary,
  ColorScheme,
  ConnectionPayload,
  MessageRecord,
  SyncProgressPayload,
} from '@/shared/ipc'

function resolveDark(scheme: ColorScheme): boolean {
  if (scheme === 'dark') return true
  if (scheme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyColorScheme(scheme: ColorScheme) {
  document.documentElement.classList.toggle('dark', resolveDark(scheme))
}

export function useSettings() {
  const [chatFilter, setChatFilterState] = useState<ChatFilter>('all')
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>('system')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setChatFilterState(s.chatFilter)
      setColorSchemeState(s.colorScheme)
      applyColorScheme(s.colorScheme)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!loaded || colorScheme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyColorScheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [colorScheme, loaded])

  const setChatFilter = useCallback(async (filter: ChatFilter) => {
    setChatFilterState(filter)
    await window.api.setChatFilter(filter)
  }, [])

  const setColorScheme = useCallback(async (scheme: ColorScheme) => {
    setColorSchemeState(scheme)
    applyColorScheme(scheme)
    await window.api.setColorScheme(scheme)
  }, [])

  return { chatFilter, setChatFilter, colorScheme, setColorScheme, loaded }
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

const IDLE_SYNC: SyncProgressPayload = {
  active: false,
  progress: 100,
  phase: 'idle',
  message: '',
}

export function useSyncProgress() {
  const [sync, setSync] = useState<SyncProgressPayload>(IDLE_SYNC)

  useEffect(() => {
    window.api.getSyncProgress().then(setSync)
    return window.api.onSyncUpdate(setSync)
  }, [])

  return sync
}

export function useAuth() {
  const [state, setState] = useState<ConnectionPayload>({ status: 'connecting' })
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    window.api.getAuthStatus().then(setState)

    const unsubConnection = window.api.onConnectionUpdate((payload) => {
      setState(payload)
      if (payload.status !== 'qr') setQrDataUrl(null)
    })

    const unsubQr = window.api.onAuthQr((dataUrl) => setQrDataUrl(dataUrl))

    return () => {
      unsubConnection()
      unsubQr()
    }
  }, [])

  const retry = useCallback(() => window.api.authRetry(), [])
  const logout = useCallback(() => window.api.authLogout(), [])

  return {
    status: state.status,
    message: state.message,
    qrDataUrl,
    retry,
    logout,
    isConnected: state.status === 'connected',
  }
}
