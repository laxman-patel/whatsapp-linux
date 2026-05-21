import { useCallback, useEffect, useMemo, useState } from 'react'
import { WhatsAppMessenger } from '@/components/WhatsAppMessenger'
import { QrLoginScreen } from '@/components/QrLoginScreen'
import {
  chatSummaryToSidebar,
  CURRENT_USER,
  messageToChatcn,
} from '@/lib/adapters/baileys-to-chatcn'
import { useAuth, useChats, useMessages, useSettings } from '@/hooks/useChats'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { ChatFilter, ColorScheme } from '@/shared/ipc'

function TitleBar({
  colorScheme,
  onColorSchemeChange,
}: {
  colorScheme: ColorScheme
  onColorSchemeChange: (scheme: ColorScheme) => void
}) {
  return (
    <div className="titlebar relative flex h-8 shrink-0 items-center justify-center border-b border-[var(--titlebar-border)] bg-[var(--titlebar-bg)] px-3 text-[12px] font-medium text-[var(--titlebar-text)]">
      <span>WhatsApp Desktop</span>
      <div className="absolute right-2">
        <ThemeToggle value={colorScheme} onChange={onColorSchemeChange} />
      </div>
    </div>
  )
}

function App() {
  const { chatFilter, setChatFilter, colorScheme, setColorScheme, loaded } = useSettings()
  const { status, message, qrDataUrl, retry, logout, isConnected } = useAuth()
  const [search, setSearch] = useState('')
  const [activeJid, setActiveJid] = useState<string | undefined>()
  const [headerSubtitle, setHeaderSubtitle] = useState<string | undefined>()
  const { chats } = useChats(chatFilter, search)
  const { messages } = useMessages(activeJid)

  const sidebarConversations = useMemo(
    () => chats.map(chatSummaryToSidebar),
    [chats],
  )

  const chatMessages = useMemo(() => {
    const activeChat = chats.find((c) => c.jid === activeJid)
    const isGroup = activeChat?.isGroup ?? false
    return messages.map((m) => messageToChatcn(m, isGroup))
  }, [messages, chats, activeJid])

  useEffect(() => {
    if (!activeJid) return
    const stillVisible = chats.some((c) => c.jid === activeJid)
    if (!stillVisible) {
      setActiveJid(undefined)
      setHeaderSubtitle(undefined)
    }
  }, [chats, activeJid])

  const handleSelectConversation = useCallback(
    async (jid: string) => {
      setActiveJid(jid)
      const chat = chats.find((c) => c.jid === jid)
      if (chat?.isGroup) {
        const meta = await window.api.openChat(jid)
        setHeaderSubtitle(
          meta?.participantCount
            ? `${meta.participantCount} participants`
            : 'Group',
        )
      } else {
        setHeaderSubtitle(undefined)
      }
    },
    [chats],
  )

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeJid || !text.trim()) return
      await window.api.sendText(activeJid, text.trim())
    },
    [activeJid],
  )

  const handleFilterChange = useCallback(
    (filter: ChatFilter) => {
      void setChatFilter(filter)
    },
    [setChatFilter],
  )

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--chat-bg-app)] text-sm text-[var(--chat-text-secondary)]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar colorScheme={colorScheme} onColorSchemeChange={setColorScheme} />

      <div className="min-h-0 flex-1">
        {isConnected ? (
          <WhatsAppMessenger
            currentUser={CURRENT_USER}
            conversations={sidebarConversations}
            activeConversationId={activeJid}
            onSelectConversation={handleSelectConversation}
            messages={chatMessages}
            onSend={handleSend}
            filter={chatFilter}
            onFilterChange={handleFilterChange}
            search={search}
            onSearchChange={setSearch}
            headerSubtitle={headerSubtitle}
            className="h-full"
          />
        ) : (
          <QrLoginScreen
            status={status}
            message={message}
            qrDataUrl={qrDataUrl}
            onRetry={() => void retry()}
            onLogout={() => void logout()}
          />
        )}
      </div>
    </div>
  )
}

export default App
