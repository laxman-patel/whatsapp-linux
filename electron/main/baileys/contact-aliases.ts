import type { WASocket } from '@whiskeysockets/baileys'
import {
  linkContactAlias,
  listKnownPhoneJids,
  repairGroupSenderNamesForJids,
} from '../db/repositories'
import { scheduleChatsNotify } from '../sync-progress'

const ALIAS_BATCH_SIZE = 50
let hydrateInFlight = false

export async function hydrateContactAliasesFromPhonebook(
  sock: WASocket | null | undefined,
): Promise<void> {
  if (hydrateInFlight) return
  if (!sock) return

  const phoneJids = listKnownPhoneJids()
  if (phoneJids.length === 0) return

  hydrateInFlight = true
  const touchedSenderJids = new Set<string>()
  try {
    for (let i = 0; i < phoneJids.length; i += ALIAS_BATCH_SIZE) {
      const batch = phoneJids.slice(i, i + ALIAS_BATCH_SIZE)
      try {
        const results = await sock.onWhatsApp(...batch)
        for (const result of results ?? []) {
          const lid = typeof result.lid === 'string' ? result.lid : undefined
          const jid = typeof result.jid === 'string' ? result.jid : undefined
          if (result.exists && lid && jid) {
            for (const key of linkContactAlias(lid, jid)) {
              touchedSenderJids.add(key)
            }
          }
        }
      } catch (err) {
        console.warn('[contacts] failed to hydrate LID aliases:', err)
      }
    }

    repairGroupSenderNamesForJids([...touchedSenderJids])
    scheduleChatsNotify(true)
  } finally {
    hydrateInFlight = false
  }
}
