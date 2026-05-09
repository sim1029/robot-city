const DISCORD_API = 'https://discord.com/api/v10'
const GUILD_FORUM = 15

export interface ForumChannelResult {
  guildId: string
  channelId: string
  channelLink: string
}

export async function getOrCreateForumChannel(guildId: string): Promise<ForumChannelResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN must be set')

  const headers = {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  }

  const listRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers })
  if (!listRes.ok) {
    throw new Error(`Failed to list channels: ${listRes.status} ${await listRes.text()}`)
  }
  const channels = (await listRes.json()) as Array<{ id: string; name: string; type: number }>

  const existing = channels.find(ch => ch.type === GUILD_FORUM && ch.name === 'robot-city')
  if (existing) {
    return {
      guildId,
      channelId: existing.id,
      channelLink: `https://discord.com/channels/${guildId}/${existing.id}`,
    }
  }

  const createRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'robot-city',
      type: GUILD_FORUM,
      topic: 'Your AI concierge — each post is an isolated session.',
    }),
  })
  if (!createRes.ok) {
    const body = await createRes.text()
    if (createRes.status === 403) {
      throw new Error(
        'Bot is missing Manage Channels permission in this server.\n' +
        'Remove the bot from the server, then run "npm run init" again to re-authorize with the correct permissions.'
      )
    }
    throw new Error(`Failed to create forum channel: ${createRes.status} ${body}`)
  }
  const channel = (await createRes.json()) as { id: string }

  return {
    guildId,
    channelId: channel.id,
    channelLink: `https://discord.com/channels/${guildId}/${channel.id}`,
  }
}
