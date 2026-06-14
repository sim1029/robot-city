import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { vaultKeys } from '../db/tables'

const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
}

interface VaultRow {
  ciphertext: string
  iv: string
  salt: string
}

export async function getKey(provider: string): Promise<string> {
  const row = db.select({ ciphertext: vaultKeys.ciphertext, iv: vaultKeys.iv, salt: vaultKeys.salt })
    .from(vaultKeys)
    .where(eq(vaultKeys.provider, provider))
    .get()

  if (row) return decrypt(row)

  const envVar = ENV_KEY_MAP[provider]
  const envKey = envVar ? process.env[envVar] : undefined
  if (envKey) return envKey

  throw new Error(`No API key found for provider "${provider}". Set it via POST /vault/keys/${provider} or ${envVar ?? 'the appropriate env var'}.`)
}

export async function setKey(provider: string, plaintext: string): Promise<void> {
  const { ciphertext, iv, salt } = await encrypt(plaintext)
  db.insert(vaultKeys)
    .values({ provider, ciphertext, iv, salt, updatedAt: sql`unixepoch()` })
    .onConflictDoUpdate({
      target: vaultKeys.provider,
      set: {
        ciphertext: sql`excluded.ciphertext`,
        iv: sql`excluded.iv`,
        salt: sql`excluded.salt`,
        updatedAt: sql`unixepoch()`,
      },
    })
    .run()
}

function getPassphrase(): string {
  const p = process.env.VAULT_PASSPHRASE
  if (!p) throw new Error('VAULT_PASSPHRASE env var is required for vault operations')
  return p
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as Uint8Array<ArrayBuffer>, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encrypt(plaintext: string): Promise<{ ciphertext: string; iv: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(getPassphrase(), salt)
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  )
  return {
    ciphertext: Buffer.from(cipherBuf).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    salt: Buffer.from(salt).toString('base64'),
  }
}

async function decrypt(row: VaultRow): Promise<string> {
  const salt = Buffer.from(row.salt, 'base64')
  const iv = Buffer.from(row.iv, 'base64')
  const ciphertext = Buffer.from(row.ciphertext, 'base64')
  const key = await deriveKey(getPassphrase(), salt)
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plainBuf)
}
