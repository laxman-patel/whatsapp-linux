import type { WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node'
import {
  linkContactAlias,
  listKnownPhoneJids,
  repairGroupSenderNamesForJids,
} from '../db/repositories'
import { scheduleChatsNotify } from '../sync-progress'
import { phoneDigitsFromJid } from './message-utils'

const ALIAS_BATCH_SIZE = 50
let hydrateInFlight = false

export async function hydrateContactAliasesFromPhonebook(
  client: WhatsmeowClient | null | undefined,
): Promise<void> {
  if (hydrateInFlight) return
  if (!client) return

  const phoneJids = listKnownPhoneJids()
  if (phoneJids.length === 0) return

  hydrateInFlight = true
  const touchedSenderJids = new Set<string>()
  try {
    for (let i = 0; i < phoneJids.length; i += ALIAS_BATCH_SIZE) {
      const batch = phoneJids.slice(i, i + ALIAS_BATCH_SIZE)
      const phones = batch
        .map((jid) => phoneDigitsFromJid(jid))
        .filter(Boolean) as string[]
      if (phones.length === 0) continue

      try {
        const results = await client.isOnWhatsApp(phones)
        for (const result of results ?? []) {
          const jid = result.jid
          if (!result.isIn || !jid) continue
          // whatsmeow may return LID in query when input was phone — link if we know both
          const queryJid = batch.find(
            (b) => phoneDigitsFromJid(b) === result.query.replace(/\D/g, ''),
          )
          if (queryJid && queryJid !== jid && queryJid.endsWith('@lid')) {
            for (const key of linkContactAlias(queryJid, jid)) {
              touchedSenderJids.add(key)
            }
          }
        }
      } catch (err) {
        console.warn('[contacts] failed to hydrate aliases:', err)
      }
    }

    repairGroupSenderNamesForJids([...touchedSenderJids])
    scheduleChatsNotify(true)
  } finally {
    hydrateInFlight = false
  }
}
