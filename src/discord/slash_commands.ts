import { isPaused, setPaused } from '../system/pause'
import {
  clearDefaultCalendarId,
  formatCalendarList,
  getDefaultCalendarId,
  listWritableCalendarsForUser,
  resolveCalendarSelection,
  setDefaultCalendarId,
} from '../calendar/defaults'
import { db } from '../db/client'

const DISCORD_API = 'https://discord.com/api/v10'

interface SlashCommandDef {
  name: string
  description: string
  options?: Array<Record<string, unknown>>
}

const COMMANDS: SlashCommandDef[] = [
  { name: 'pause', description: 'Pause the assistant: stop briefs, triage, and thread replies.' },
  { name: 'resume', description: 'Resume the assistant.' },
  { name: 'status', description: 'Show whether the assistant is currently paused or active.' },
  {
    name: 'calendar-default',
    description: 'Manage the default Google Calendar for new events.',
    options: [
      { type: 1, name: 'list', description: 'List writable Google Calendars.' },
      { type: 1, name: 'show', description: 'Show the current default calendar.' },
      {
        type: 1,
        name: 'set',
        description: 'Set the default calendar by exact name or ID.',
        options: [
          {
            type: 3,
            name: 'calendar',
            description: 'Exact calendar name or ID.',
            required: true,
          },
        ],
      },
      { type: 1, name: 'clear', description: 'Reset the default calendar to primary.' },
    ],
  },
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

export async function handleSlashCommand(args: {
  name: string
  userId: string
  subcommand?: string | null
  calendar?: string | null
}): Promise<SlashCommandResult> {
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

  if (args.name === 'calendar-default') {
    return handleCalendarDefaultCommand(args.subcommand ?? '', args.calendar ?? '')
  }

  return { content: `Unknown command: ${args.name}`, ephemeral: true }
}

async function handleCalendarDefaultCommand(subcommand: string, calendarQuery: string): Promise<SlashCommandResult> {
  if (subcommand === 'show') {
    return { content: `Default calendar for new events: \`${getDefaultCalendarId()}\``, ephemeral: true }
  }

  if (subcommand === 'clear') {
    clearDefaultCalendarId()
    return { content: 'Default calendar reset to `primary`.', ephemeral: true }
  }

  if (subcommand === 'set' && calendarQuery.trim().toLowerCase() === 'primary') {
    clearDefaultCalendarId()
    return { content: 'Default calendar reset to `primary`.', ephemeral: true }
  }

  const gmailUserId = getConnectedGmailUserId()
  if (!gmailUserId) {
    return { content: 'Connect Google first at /auth/google.', ephemeral: true }
  }

  let calendars
  try {
    calendars = await listWritableCalendarsForUser(gmailUserId)
  } catch (err) {
    return {
      content: `Unable to list calendars. Reconnect Google at /auth/google. ${err instanceof Error ? err.message : String(err)}`,
      ephemeral: true,
    }
  }

  if (subcommand === 'list') {
    return { content: `Writable calendars:\n${formatCalendarList(calendars)}`, ephemeral: true }
  }

  if (subcommand === 'set') {
    const resolved = resolveCalendarSelection(calendars, calendarQuery)
    if (resolved.kind === 'resolved') {
      setDefaultCalendarId(resolved.calendar.id)
      return {
        content: `Default calendar set to ${resolved.calendar.summary} (\`${resolved.calendar.id}\`).`,
        ephemeral: true,
      }
    }
    if (resolved.kind === 'ambiguous') {
      return {
        content: `Multiple calendars matched "${calendarQuery}". Use the exact ID:\n${formatCalendarList(resolved.calendars)}`,
        ephemeral: true,
      }
    }
    return {
      content: `No writable calendar matched "${calendarQuery}". Available calendars:\n${formatCalendarList(calendars)}`,
      ephemeral: true,
    }
  }

  return { content: `Unknown calendar-default command: ${subcommand}`, ephemeral: true }
}

function getConnectedGmailUserId(): string | null {
  const row = db.query('SELECT user_id FROM gmail_tokens LIMIT 1').get() as { user_id: string } | null
  return row?.user_id ?? null
}
