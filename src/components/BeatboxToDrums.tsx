import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { engine } from '../audio/engine'
import { analyzeBeatbox, type Hit, type BeatboxResult } from '../audio/beatbox'

type Phase = 'idle' | 'recording' | 'analyzing' | 'done'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function BeatboxToDrums({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ bpm: number; counts: Record<string, number>; total: number } | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startRef = useRef(0)
  const rafRef = useRef(0)
  const bufRef = useRef<Float32Array>(new Float32Array(2048))
  const peakRef = useRef(0) // loudest input seen this take — detects a silent mic
  const createdRef = useRef<string[]>([]) // drum tracks this take added, so Delete can remove them

  useEffect(() => () => cleanup(), [])
  function cleanup() {
    cancelAnimationFrame(rafRef.current)
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      // ignore
    }
    try {
      ctxRef.current?.close()
    } catch {
      // ignore
    }
  }

  async function start() {
    setError(null)
    setSummary(null)
    peakRef.current = 0
    // unlock the audio engine within this click gesture so playback works later
    engine.ensureStarted().catch(() => {})
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      analyserRef.current = an
      src.connect(an)

      const rec = new MediaRecorder(stream)
      recRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      rec.onstop = onStopped
      rec.start()
      startRef.current = performance.now()
      setPhase('recording')

      const tick = () => {
        setElapsed(performance.now() - startRef.current)
        const a = analyserRef.current
        if (a) {
          a.getFloatTimeDomainData(bufRef.current as any)
          let p = 0
          for (const v of bufRef.current) {
            const abs = v < 0 ? -v : v
            if (abs > p) p = abs
          }
          if (p > peakRef.current) peakRef.current = p
          setLevel(p)
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e: any) {
      setError(e?.message || 'Could not access the microphone.')
    }
  }

  function stop() {
    if (recRef.current && phase === 'recording') {
      setPhase('analyzing')
      cancelAnimationFrame(rafRef.current)
      setLevel(0)
      recRef.current.stop()
    }
  }

  async function onStopped() {
    try {
      const blob = new Blob(chunksRef.current)
      const ctx = ctxRef.current ?? new AudioContext()
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
      streamRef.current?.getTracks().forEach((t) => t.stop())

      // If the mic never registered any signal, the recording is silent — this is
      // almost always a Windows mic-permission or wrong-input-device problem, not
      // the user beatboxing too quietly. Give the actionable message.
      if (peakRef.current < 0.012) {
        setError(
          'Mic captured silence (input level ~0). Windows is likely blocking the mic or the wrong input device is selected. ' +
            'Open Windows Settings → Privacy & security → Microphone, allow desktop apps, and pick your mic as the default input.',
        )
        setPhase('idle')
        return
      }

      const analysis = analyzeBeatbox(audio)
      if (!analysis.hits.length) {
        setError('No drum hits detected — try beatboxing a bit louder and closer to the mic.')
        setPhase('idle')
        return
      }
      await buildDrums(analysis)

      const counts: Record<string, number> = {}
      for (const h of analysis.hits) counts[h.type] = (counts[h.type] || 0) + 1
      setSummary({ bpm: analysis.bpm, counts, total: analysis.hits.length })
      setPhase('done')
    } catch (e: any) {
      setError(e?.message || 'Could not analyze the recording.')
      setPhase('idle')
    }
  }

  async function buildDrums(a: BeatboxResult) {
    const order: Array<[Hit['type'], string]> = [
      ['kick', 'Kick'],
      ['snare', 'Snare'],
      ['hihat', 'Hihat'],
    ]
    const cmds: any[] = [{ type: 'set_tempo', bpm: a.bpm }]
    const created: string[] = []
    for (const [type, name] of order) {
      const group = a.hits.filter((h) => h.type === type)
      if (!group.length) continue
      created.push(name)
      cmds.push({ type: 'add_track', name, instrument: type })
      cmds.push({ type: 'clear_track', track: name })
      const notes = group.map((h) => ({
        pitch: 'C2',
        start: h.beat,
        duration: 0.25,
        velocity: Math.round(h.velocity * 100) / 100,
      }))
      cmds.push({ type: 'add_notes', track: name, notes })
    }
    createdRef.current = created
    cmds.push({ type: 'set_loop', bars: a.bars })
    cmds.push({ type: 'transport', action: 'play' })
    await useStore.getState().applyCommands(cmds)
  }

  // discard the current take: stop playback and remove the drum tracks it added
  async function discard() {
    const cmds: any[] = [{ type: 'transport', action: 'stop' }]
    for (const name of createdRef.current) cmds.push({ type: 'remove_track', track: name })
    await useStore.getState().applyCommands(cmds)
    createdRef.current = []
    setSummary(null)
    setError(null)
    setElapsed(0)
    setPhase('idle')
  }

  if (!open) return null
  const meterPct = Math.min(100, Math.round(level * 160))
  const busy = phase === 'recording' || phase === 'analyzing'

  return (
    <div className="modal-backdrop">
      <div className="jam">
        <div className="jam-head">
          <h2>🥁 Beatbox → Drums</h2>
          {!busy && (
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        <p className="jam-sub">
          Beatbox a groove — kicks, snares, and hats with your mouth. Jamalam finds the hits,
          figures out the tempo, and turns them into a real drum kit you can play and edit.
        </p>

        <div className="jam-meter">
          <div className="jam-meter-fill" style={{ width: `${meterPct}%` }} />
        </div>
        <div className="jam-timer">{phase === 'analyzing' ? 'analysing…' : fmt(elapsed)}</div>

        <div className="jam-controls">
          {phase === 'idle' || phase === 'done' ? (
            <button className="jam-rec" onClick={start}>
              ● {phase === 'done' ? 'Beatbox again' : 'Beatbox'}
            </button>
          ) : phase === 'recording' ? (
            <button className="jam-stop" onClick={stop}>
              ■ Stop &amp; convert
            </button>
          ) : (
            <button className="jam-stop" disabled>
              Converting…
            </button>
          )}
          {phase === 'done' && (
            <button className="jam-delete" onClick={discard} title="Discard this take and remove its drum tracks">
              🗑 Delete
            </button>
          )}
        </div>

        {error && <div className="jam-error">{error}</div>}

        {summary && phase === 'done' && (
          <div className="jam-saved">
            ✓ {summary.total} hits →{' '}
            {['kick', 'snare', 'hihat']
              .filter((k) => summary.counts[k])
              .map((k) => `${summary.counts[k]} ${k}`)
              .join(' · ')}{' '}
            · ~{summary.bpm} BPM. Drum tracks added — playing now.
          </div>
        )}
      </div>
    </div>
  )
}
