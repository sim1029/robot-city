interface DiscordMessage {
  id: string
  content: string
  author: { id: string; bot?: boolean }
}

export class DiscordWorld {
  private messages: DiscordMessage[] = []
  private nextId = 1

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    if (/\/typing$/.test(path)) return new Response(null, { status: 204 })

    const history = /^\/api\/v10\/channels\/([^/]+)\/messages$/.exec(path)
    if (history?.[1] && request.method === 'GET') {
      return json([...this.messages].reverse())
    }
    if (history?.[1] && request.method === 'POST') {
      const body = await request.json() as { content?: string }
      const id = `assistant-${this.nextId++}`
      this.messages.push({ id, content: body.content ?? '', author: { id: 'eval-bot', bot: true } })
      return json({ id })
    }
    return json({ error: 'unsupported fake Discord request' }, 404)
  }

  addUserMessage(content: string): string {
    const id = `user-${this.nextId++}`
    this.messages.push({ id, content, author: { id: 'eval-user' } })
    return id
  }

  lastReply(): string {
    return [...this.messages].reverse().find(message => message.author.bot)?.content ?? ''
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
