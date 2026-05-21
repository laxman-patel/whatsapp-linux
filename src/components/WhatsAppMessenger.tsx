import { useCallback, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import {
  ChatProvider,
  ChatMessages,
  ChatComposer,
  ChatHeader,
  ChatConversationItem,
  type ChatMessageData,
  type SidebarConversation,
} from '@/components/ui/chat'
import { ChatFilterToggle } from '@/components/ChatFilterToggle'
import { cn } from '@/lib/utils'
import type { ChatFilter } from '@/shared/ipc'

interface WhatsAppMessengerProps {
  currentUser: { id: string; name: string }
  conversations: SidebarConversation[]
  activeConversationId?: string
  onSelectConversation: (id: string) => void
  messages: ChatMessageData[]
  onSend: (text: string) => void
  filter: ChatFilter
  onFilterChange: (filter: ChatFilter) => void
  search: string
  onSearchChange: (search: string) => void
  headerSubtitle?: string
  className?: string
}

export function WhatsAppMessenger({
  currentUser,
  conversations,
  activeConversationId,
  onSelectConversation,
  messages,
  onSend,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  headerSubtitle,
  className,
}: WhatsAppMessengerProps) {
  const activeConvo = conversations.find((c) => c.id === activeConversationId)

  const composerPlaceholder = activeConvo
    ? `Message ${activeConvo.title}…`
    : 'Select a conversation'

  const itemContent = useCallback(
    (index: number) => {
      const convo = conversations[index]
      return (
        <ChatConversationItem
          convo={convo}
          isActive={convo.id === activeConversationId}
          onClick={() => onSelectConversation(convo.id)}
        />
      )
    },
    [conversations, activeConversationId, onSelectConversation],
  )

  const emptyState = useMemo(
    () => (
      <div className="px-4 py-8 text-center text-[13px] text-[var(--chat-text-tertiary)]">
        No conversations match your filter
      </div>
    ),
    [],
  )

  return (
    <ChatProvider
      currentUser={currentUser}
      theme="lunar"
      className="h-full"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div className={cn('flex h-full min-h-0 bg-[var(--chat-bg-app)]', className)}>
        <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--chat-border-strong)] bg-[var(--chat-bg-sidebar)] min-h-0">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] font-semibold text-[var(--chat-text-primary)]">
              Messages
            </span>
          </div>

          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-[10px] bg-[var(--chat-bg-main)] px-3 py-2 ring-1 ring-[var(--chat-border)]">
              <Search className="size-3.5 shrink-0 text-[var(--chat-text-tertiary)]" />
              <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search conversations"
                className="w-full bg-transparent text-[14px] text-[var(--chat-text-primary)] outline-none placeholder:text-[var(--chat-text-tertiary)]"
              />
            </div>
          </div>

          <ChatFilterToggle value={filter} onChange={onFilterChange} />

          <div className="min-h-0 flex-1">
            {conversations.length === 0 ? (
              emptyState
            ) : (
              <Virtuoso
                style={{ height: '100%' }}
                data={conversations}
                itemContent={itemContent}
              />
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col bg-[var(--chat-bg-main)]">
          {activeConvo ? (
            <>
              <ChatHeader
                title={activeConvo.title}
                subtitle={headerSubtitle}
                avatar={
                  <div className="flex size-10 items-center justify-center rounded-full bg-[var(--chat-bubble-incoming)] text-sm font-semibold text-[var(--chat-text-primary)]">
                    {activeConvo.title.charAt(0).toUpperCase()}
                  </div>
                }
              />
              <ChatMessages
                key={activeConversationId}
                conversationKey={activeConversationId}
                messages={messages}
                className="min-h-0 flex-1"
              />
              <ChatComposer onSend={onSend} placeholder={composerPlaceholder} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[15px] text-[var(--chat-text-secondary)]">
                Select a conversation
              </p>
            </div>
          )}
        </main>
      </div>
    </ChatProvider>
  )
}
