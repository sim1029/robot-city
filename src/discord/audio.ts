import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getKey } from '../vault'

export const OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'
export const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024

const OPENAI_AUDIO_EXTENSIONS = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'])
const AUDIO_EXTENSIONS = new Set([...OPENAI_AUDIO_EXTENSIONS, '.ogg', '.oga', '.opus'])

export interface DiscordMessageAttachment {
  id: string
  name: string
  contentType: string | null
  size: number
  url: string
  duration: number | null
  waveform: string | null
  isVoiceMessage?: boolean
}

export interface TranscriptionResult {
  text: string
  model: string
  latencyMs: number
}

export type AudioInputResolution =
  | { kind: 'none' }
  | { kind: 'audio'; attachment: DiscordMessageAttachment }
  | { kind: 'error'; message: string }

export function resolveAudioInput(
  content: string,
  attachments: DiscordMessageAttachment[] = []
): AudioInputResolution {
  const audioAttachments = attachments.filter(isAudioAttachment)
  if (audioAttachments.length > 1) {
    return { kind: 'error', message: 'Please send only one audio file at a time.' }
  }

  if (audioAttachments.length === 0) {
    if (!content.trim() && attachments.length > 0) {
      return { kind: 'error', message: 'I can process text or one audio attachment in a supported format.' }
    }
    return { kind: 'none' }
  }

  const attachment = audioAttachments[0]
  if (attachment.size > MAX_TRANSCRIPTION_BYTES) {
    return { kind: 'error', message: 'That audio file is too large to transcribe. Please keep it under 25 MB.' }
  }

  return { kind: 'audio', attachment }
}

export function isAudioAttachment(attachment: DiscordMessageAttachment): boolean {
  if (attachment.contentType?.toLowerCase().startsWith('audio/')) return true
  if (attachment.isVoiceMessage || attachment.duration !== null || attachment.waveform) return true
  return AUDIO_EXTENSIONS.has(extname(attachment.name).toLowerCase())
}

export function shouldConvertForOpenAI(attachment: DiscordMessageAttachment): boolean {
  return !OPENAI_AUDIO_EXTENSIONS.has(extname(attachment.name).toLowerCase())
}

export async function transcribeDiscordAudioAttachment(
  attachment: DiscordMessageAttachment
): Promise<TranscriptionResult> {
  const start = Date.now()
  const apiKey = await getKey('openai')
  const source = await downloadAttachment(attachment)
  const upload = shouldConvertForOpenAI(attachment)
    ? await convertAudioToWebm(source.data, attachment.name)
    : {
        data: source.data,
        filename: attachment.name,
        contentType: attachment.contentType ?? source.contentType ?? 'application/octet-stream',
      }

  const form = new FormData()
  form.append('file', new Blob([upload.data], { type: upload.contentType }), upload.filename)
  form.append('model', OPENAI_TRANSCRIBE_MODEL)
  form.append('response_format', 'json')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${await res.text()}`)

  const data = await res.json() as { text?: string; model?: string }
  const text = data.text?.trim() ?? ''
  if (!text) throw new Error('OpenAI returned an empty transcription.')

  return {
    text,
    model: data.model ?? OPENAI_TRANSCRIBE_MODEL,
    latencyMs: Date.now() - start,
  }
}

async function downloadAttachment(
  attachment: DiscordMessageAttachment
): Promise<{ data: ArrayBuffer; contentType: string | null }> {
  const res = await fetch(attachment.url)
  if (!res.ok) throw new Error(`Discord attachment download ${res.status}: ${await res.text()}`)
  return {
    data: await res.arrayBuffer(),
    contentType: res.headers.get('content-type'),
  }
}

async function convertAudioToWebm(
  data: ArrayBuffer,
  originalName: string
): Promise<{ data: ArrayBuffer; filename: string; contentType: string }> {
  const dir = join(tmpdir(), `robot-city-audio-${randomUUID()}`)
  const input = join(dir, sanitizeFilename(originalName) || 'input.ogg')
  const output = join(dir, 'audio.webm')

  await mkdir(dir, { recursive: true })
  try {
    await writeFile(input, new Uint8Array(data))
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-c:a', 'libopus', output],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text().catch(() => '')
      throw new Error(`ffmpeg audio conversion failed${err ? `: ${err.trim()}` : ''}`)
    }

    const bytes = await readFile(output)
    const converted = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return { data: converted, filename: 'audio.webm', contentType: 'audio/webm' }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}
