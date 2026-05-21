/**
 * Tracks which chat the renderer currently has open so live incoming messages
 * can update the unread badge correctly (no badge for the chat you're already
 * looking at, +1 for everything else).
 */

let activeChatJid: string | null = null

export function setActiveChat(jid: string | null): void {
  activeChatJid = jid
}

export function getActiveChat(): string | null {
  return activeChatJid
}
