import { db } from '../db/client'
import { listHistory, getProfile, GmailHistoryGoneError } from './client'
import { getValidGmailAccessToken, loadGmailTokens, setGmailHistoryId } from './tokens'

export type PollOutcome =
  | { kind: 'baselined'; historyId: string; newMessageIds: [] }
  | { kind: 'synced'; historyId: string; newMessageIds: string[] }
  | { kind: 'gap-recovered'; historyId: string; previousHistoryId: string; newMessageIds: [] }

export async function pollGmail(userId: string): Promise<PollOutcome> {
  const tokens = loadGmailTokens(userId)
  if (!tokens) throw new Error(`No Gmail tokens stored for ${userId}`)

  const accessToken = await getValidGmailAccessToken(userId)
  const watermark = tokens.history_id

  if (!watermark) {
    const profile = await getProfile(accessToken)
    setGmailHistoryId(userId, profile.historyId)
    return { kind: 'baselined', historyId: profile.historyId, newMessageIds: [] }
  }

  try {
    const result = await listHistory(accessToken, watermark)
    setGmailHistoryId(userId, result.historyId)
    return { kind: 'synced', historyId: result.historyId, newMessageIds: result.addedMessageIds }
  } catch (err) {
    if (err instanceof GmailHistoryGoneError) {
      const profile = await getProfile(accessToken)
      setGmailHistoryId(userId, profile.historyId)
      logGapEvent(userId, watermark, profile.historyId)
      return {
        kind: 'gap-recovered',
        historyId: profile.historyId,
        previousHistoryId: watermark,
        newMessageIds: [],
      }
    }
    throw err
  }
}

function logGapEvent(userId: string, fromHistoryId: string, recoveredHistoryId: string) {
  db.run(
    `INSERT INTO events (session_id, type, payload) VALUES (?, ?, ?)`,
    [
      null,
      'gmail:gap',
      JSON.stringify({ user_id: userId, from_history_id: fromHistoryId, recovered_history_id: recoveredHistoryId }),
    ]
  )
}
