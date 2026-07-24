import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Free Jam capture: the renderer streams 16-bit mono PCM chunks here and we
// append them to a growing .wav on disk, so a long take is never held in RAM.

const CHANNELS = 1
const BITS = 16

export function recordingsDir(): string {
  const dir = path.join(app.getPath('userData'), 'recordings')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 44-byte canonical WAV/PCM header
function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const blockAlign = (CHANNELS * BITS) / 8
  const byteRate = sampleRate * blockAlign
  const b = Buffer.alloc(44)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + dataBytes, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(CHANNELS, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(byteRate, 28)
  b.writeUInt16LE(blockAlign, 32)
  b.writeUInt16LE(BITS, 34)
  b.write('data', 36)
  b.writeUInt32LE(dataBytes, 40)
  return b
}

export interface JamMeta {
  id: string
  filePath: string
  durationSec: number
  sampleRate: number
  flags: number[] // ms offsets flagged during the jam
  createdAt: number
}

interface Session {
  id: string
  filePath: string
  fd: number
  dataBytes: number
  sampleRate: number
  createdAt: number
  flags: number[]
}

const sessions = new Map<string, Session>()

export function jamStart(sampleRate: number): { id: string; filePath: string } {
  const id = `jam-${Date.now()}`
  const filePath = path.join(recordingsDir(), `${id}.wav`)
  const fd = fs.openSync(filePath, 'w')
  fs.writeSync(fd, wavHeader(0, sampleRate)) // placeholder header, patched on stop
  sessions.set(id, { id, filePath, fd, dataBytes: 0, sampleRate, createdAt: Date.now(), flags: [] })
  return { id, filePath }
}

export function jamChunk(id: string, chunk: Buffer): void {
  const s = sessions.get(id)
  if (!s) return
  fs.writeSync(s.fd, chunk)
  s.dataBytes += chunk.length
}

export function jamFlag(id: string, ms: number): void {
  const s = sessions.get(id)
  if (s) s.flags.push(Math.max(0, Math.round(ms)))
}

export function jamStop(id: string): JamMeta | null {
  const s = sessions.get(id)
  if (!s) return null
  // patch the header now that we know the real data size
  fs.writeSync(s.fd, wavHeader(s.dataBytes, s.sampleRate), 0, 44, 0)
  fs.closeSync(s.fd)
  const durationSec = s.dataBytes / (s.sampleRate * CHANNELS * (BITS / 8))
  const meta: JamMeta = {
    id: s.id,
    filePath: s.filePath,
    durationSec,
    sampleRate: s.sampleRate,
    flags: s.flags,
    createdAt: s.createdAt,
  }
  fs.writeFileSync(s.filePath.replace(/\.wav$/, '.json'), JSON.stringify(meta, null, 2))
  sessions.delete(s.id)
  return meta
}

export function jamList(): JamMeta[] {
  const dir = recordingsDir()
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as JamMeta
      } catch {
        return null
      }
    })
    .filter((m): m is JamMeta => !!m)
    .sort((a, b) => b.createdAt - a.createdAt)
}
