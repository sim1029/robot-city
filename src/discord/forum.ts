import { db } from '../db/client'
import { DEFAULT_FORUM_NAME, getOrCreateForumChannel } from './setup'

interface ResolvedForum {
  guildId: string
  forumId: string
  forumName: string
}

let cached: ResolvedForum | null = null

function lookupGuildId(): string {
  const fromEnv = process.env.DISCORD_GUILD_ID?.trim()
  if (fromEnv) return fromEnv
  const row = db.query('SELECT guild_id FROM discord_tokens WHERE guild_id IS NOT NULL LIMIT 1').get() as
    | { guild_id: string | null }
    | null
  if (row?.guild_id) return row.guild_id
  throw new Error(
    'No Discord guild ID available. Set DISCORD_GUILD_ID in your env or run `bun run init` to install the bot.',
  )
}

function lookupForumName(): string {
  const fromEnv = process.env.DISCORD_FORUM_NAME?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_FORUM_NAME
}

export async function resolveForumChannel(): Promise<ResolvedForum> {
  const guildId = lookupGuildId()
  const forumName = lookupForumName()
  const result = await getOrCreateForumChannel(guildId, forumName)
  cached = { guildId, forumId: result.channelId, forumName }
  return cached
}

export function getResolvedForumId(): string {
  if (!cached) throw new Error('Forum not resolved yet — call resolveForumChannel() during startup.')
  return cached.forumId
}

export function _resetResolvedForumForTests() {
  cached = null
}
