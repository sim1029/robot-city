import { describe, expect, test } from 'bun:test'
import {
  MAX_TRANSCRIPTION_BYTES,
  type DiscordMessageAttachment,
  isAudioAttachment,
  resolveAudioInput,
  shouldConvertForOpenAI,
} from '../../src/discord/audio'

function attachment(overrides: Partial<DiscordMessageAttachment>): DiscordMessageAttachment {
  return {
    id: 'att-1',
    name: 'note.m4a',
    contentType: 'audio/mp4',
    size: 1024,
    url: 'https://cdn.discordapp.com/note.m4a',
    duration: null,
    waveform: null,
    ...overrides,
  }
}

describe('discord audio helpers', () => {
  test('detects regular audio files and Discord voice messages', () => {
    expect(isAudioAttachment(attachment({ name: 'voice.wav', contentType: 'audio/wav' }))).toBe(true)
    expect(isAudioAttachment(attachment({
      name: 'voice-message.ogg',
      contentType: 'audio/ogg',
      duration: 3.2,
      waveform: 'abc',
      isVoiceMessage: true,
    }))).toBe(true)
    expect(isAudioAttachment(attachment({ name: 'image.png', contentType: 'image/png' }))).toBe(false)
  })

  test('requires conversion for formats OpenAI does not document as upload formats', () => {
    expect(shouldConvertForOpenAI(attachment({ name: 'voice-message.ogg', contentType: 'audio/ogg' }))).toBe(true)
    expect(shouldConvertForOpenAI(attachment({ name: 'recording.webm', contentType: 'audio/webm' }))).toBe(false)
    expect(shouldConvertForOpenAI(attachment({ name: 'recording.m4a', contentType: 'audio/mp4' }))).toBe(false)
  })

  test('resolves valid audio input and rejects ambiguous audio messages', () => {
    expect(resolveAudioInput('', [attachment({})]).kind).toBe('audio')
    expect(resolveAudioInput('', [
      attachment({ id: 'a1', name: 'one.m4a' }),
      attachment({ id: 'a2', name: 'two.wav' }),
    ])).toEqual({ kind: 'error', message: 'Please send only one audio file at a time.' })
    expect(resolveAudioInput('', [attachment({ name: 'huge.m4a', size: MAX_TRANSCRIPTION_BYTES + 1 })])).toEqual({
      kind: 'error',
      message: 'That audio file is too large to transcribe. Please keep it under 25 MB.',
    })
  })

  test('rejects attachment-only messages without supported audio', () => {
    expect(resolveAudioInput('', [attachment({ name: 'notes.pdf', contentType: 'application/pdf' })])).toEqual({
      kind: 'error',
      message: 'I can process text or one audio attachment in a supported format.',
    })
    expect(resolveAudioInput('read this', [attachment({ name: 'notes.pdf', contentType: 'application/pdf' })])).toEqual({ kind: 'none' })
  })
})
