const DISCORD_API = 'https://discord.com/api/v10'

// Bot permissions: Manage Channels + Send Messages + Read Message History + Create Public Threads
const BOT_PERMISSIONS = '292057795648'

export function getOAuthUrl(state: string): string {
  const clientId = process.env.DISCORD_CLIENT_ID
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  if (!clientId || !redirectUri) {
    throw new Error('DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI must be set')
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds bot',
    permissions: BOT_PERMISSIONS,
    state,
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const clientId = process.env.DISCORD_CLIENT_ID!
  const clientSecret = process.env.DISCORD_CLIENT_SECRET!
  const redirectUri = process.env.DISCORD_REDIRECT_URI!

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) throw new Error(`Discord token exchange failed ${res.status}: ${await res.text()}`)
  return res.json() as Promise<DiscordTokenResponse>
}

export async function getCurrentUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Discord user fetch failed ${res.status}: ${await res.text()}`)
  return res.json() as Promise<DiscordUser>
}

export interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
  guild?: { id: string; name: string }
}

export interface DiscordUser {
  id: string
  username: string
  discriminator: string
  avatar?: string
}
