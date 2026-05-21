/** Stable custom-scheme URL for a cached WhatsApp profile picture (jid in path, not host). */
export function avatarUrlForJid(jid: string): string {
  return `wa-avatar://d/${encodeURIComponent(jid)}`
}
