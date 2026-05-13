import { isPaused, setPaused } from '../system/pause'

const DISCORD_API = 'https://discord.com/api/v10'

interface SlashCommandDef {
  name: string
  description: string
}

const COMMANDS: SlashCommandDef[] = [
  { name: 'pause', description: 'Pause the assistant: stop briefs, triage, and thread replies.' },
  { name: 'resume', description: 'Resume the assistant.' },
  { name: 'status', description: 'Show whether the assistant is currently paused or active.' },
]

export async function registerGuildSlashCommands(applicationId: string, guildId: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN must be set')

  const res = await fetch(`${DISCORD_API}/applications/${applicationId}/guilds/${guildId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(COMMANDS),
  })
  if (!res.ok) {
    throw new Error(`Discord slash command register ${res.status}: ${await res.text()}`)
  }
}

export interface SlashCommandResult {
  content: string
  ephemeral: true
}

export function handleSlashCommand(args: { name: string; userId: string }): SlashCommandResult {
  const ownerId = process.env.OWNER_DISCORD_ID
  if (!ownerId || args.userId !== ownerId) {
    return { content: 'Only the configured owner can run this command.', ephemeral: true }
  }

  if (args.name === 'pause') {
    if (isPaused()) return { content: '🛑 Already paused.', ephemeral: true }
    setPaused(true, 'discord')
    return { content: '🛑 Paused. Briefs, Gmail triage, and thread replies will no-op.', ephemeral: true }
  }

  if (args.name === 'resume') {
    if (!isPaused()) return { content: '✅ Already active.', ephemeral: true }
    setPaused(false, 'discord')
    return { content: '✅ Resumed. Background work and thread replies are live.', ephemeral: true }
  }

  if (args.name === 'status') {
    return {
      content: isPaused() ? '🛑 Paused.' : '✅ Active.',
      ephemeral: true,
    }
  }

  return { content: `Unknown command: ${args.name}`, ephemeral: true }
}
