const BLOCKED_LOCAL_PATTERNS = [
  /noreply/i,
  /no.reply/i,
  /donotreply/i,
  /do.not.reply/i,
  /no.response/i,
  /notification/i,
  /mailer.daemon/i,
  /postmaster/i,
  /^bounce/i,
  /^support$/i,
  /^info$/i,
  /^team$/i,
  /^hello$/i,
  /^admin$/i,
  /^newsletter/i,
  /^updates$/i,
  /^alert/i,
  /^automated/i,
  /^unsubscribe/i,
  /^reply$/i,
  /^deals$/i,
  /^promotions$/i,
  /^billing$/i,
  /^security$/i,
  /^privacy$/i,
  /^legal$/i,
  /^receipts?$/i,
  /^orders?$/i,
  /^shipping$/i,
  /^feedback$/i,
]

const BLOCKED_HEADER_KEYS = ['list-id', 'list-unsubscribe', 'list-post', 'x-mailchimp-campaign-id']
const BLOCKED_PRECEDENCE = ['bulk', 'list', 'junk']

export function isPersonEmail(
  fromHeader: string,
  extraHeaders: Record<string, string> = {}
): boolean {
  for (const key of BLOCKED_HEADER_KEYS) {
    if (extraHeaders[key]) return false
  }
  const precedence = extraHeaders['precedence']?.toLowerCase()
  if (precedence && BLOCKED_PRECEDENCE.includes(precedence)) return false

  const email = extractAddress(fromHeader)
  if (!email) return false

  const local = email.split('@')[0]
  if (!local) return false

  // Local parts with digits dominating (e.g. bounce+abc123@) are usually automated
  if (/\+/.test(local) && /\d{4,}/.test(local)) return false

  return !BLOCKED_LOCAL_PATTERNS.some(re => re.test(local))
}

export function extractAddress(fromHeader: string): string | null {
  const angleMatch = fromHeader.match(/<([^>]+)>/)
  if (angleMatch) return angleMatch[1].trim().toLowerCase()

  const bare = fromHeader.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare)) return bare.toLowerCase()

  return null
}

export function extractDisplayName(fromHeader: string): string {
  const angleMatch = fromHeader.match(/^(.*?)\s*<[^>]+>$/)
  if (angleMatch) {
    const raw = angleMatch[1].trim().replace(/^["']|["']$/g, '')
    if (raw) return raw
  }
  const email = extractAddress(fromHeader)
  if (email) {
    const local = email.split('@')[0]
    // Convert jsmith or j.smith or j_smith into readable form
    return local.replace(/[._+]/g, ' ').replace(/\s+/g, ' ').trim()
  }
  return fromHeader.trim()
}
