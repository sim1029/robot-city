import { Client, Events, GatewayIntentBits, ChannelType } from 'discord.js'
import { handleApprovalInteraction, handleEditModalSubmit, handleThreadArchive, handleThreadMessage } from './handlers'
import { getResolvedForumId, resolveForumChannel } from './forum'

export interface BotHandle {
  client: Client
  stop: () => Promise<void>
}

export function createBot(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  })
}

export async function startBot(): Promise<BotHandle> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN must be set')

  const resolved = await resolveForumChannel()
  console.log(`[discord] forum "${resolved.forumName}" resolved to ${resolved.forumId} in guild ${resolved.guildId}`)

  const client = createBot()

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return
    if (msg.channel.type !== ChannelType.PublicThread && msg.channel.type !== ChannelType.PrivateThread) return
    const parent = 'parent' in msg.channel ? msg.channel.parent : null
    if (!parent || parent.id !== getResolvedForumId()) return

    try {
      await handleThreadMessage({
        threadId: msg.channelId,
        userId: msg.author.id,
        messageId: msg.id,
        content: msg.content,
      })
    } catch (err) {
      console.error('handleThreadMessage error', err)
      await msg.reply(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
    if (oldThread.archived || !newThread.archived) return
    const parent = newThread.parent
    if (!parent || parent.id !== getResolvedForumId()) return
    try {
      await handleThreadArchive({ threadId: newThread.id })
    } catch (err) {
      console.error('handleThreadArchive error', err)
    }
  })

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      try {
        const outcome = await handleApprovalInteraction({
          customId: interaction.customId,
          interactionChannelId: interaction.channelId ?? '',
        })
        if (outcome.kind === 'ignored') return
        if (outcome.kind === 'stale') {
          await interaction.reply({ content: `Already ${outcome.status}.`, ephemeral: true })
          return
        }
        if (outcome.kind === 'show_modal') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await interaction.showModal(outcome.modal as any)
          return
        }
        await interaction.deferUpdate()
      } catch (err) {
        console.error('approval interaction error', err)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true })
        }
      }
    } else if (interaction.isModalSubmit()) {
      try {
        const subject = interaction.fields.getTextInputValue('subject')
        const body = interaction.fields.getTextInputValue('body')
        const outcome = await handleEditModalSubmit({
          customId: interaction.customId,
          fields: { subject, body },
          interactionChannelId: interaction.channelId ?? '',
        })
        if (outcome.kind === 'ignored') return
        if (outcome.kind === 'stale') {
          await interaction.reply({ content: `Already ${outcome.status}.`, ephemeral: true })
          return
        }
        if (interaction.isFromMessage()) {
          await interaction.deferUpdate()
        } else {
          await interaction.deferReply({ ephemeral: true })
        }
      } catch (err) {
        console.error('edit modal submit error', err)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true })
        }
      }
    }
  })

  await client.login(token)
  return {
    client,
    stop: async () => { await client.destroy() },
  }
}
