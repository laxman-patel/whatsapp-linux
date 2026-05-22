/** Minimal JID normalization (replaces Baileys jidNormalizedUser). */
export function jidNormalizedUser(jid: string): string {
  const trimmed = jid.trim()
  if (!trimmed.includes('@')) return trimmed
  const [userPart, server] = trimmed.split('@')
  const user = (userPart ?? '').replace(/:\d+$/, '')
  return `${user}@${server}`
}

export function isJidGroup(jid: string): boolean {
  return jid.endsWith('@g.us')
}
