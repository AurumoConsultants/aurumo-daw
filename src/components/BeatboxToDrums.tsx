import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { engine } from '../audio/engine'
import { analyzeBeatbox, requantize, type Hit, type BeatboxResult, type DrumProfile } from '../audio/beatbox'
import { loadProfile } from '../audio/profile'
import BeatboxCalibrate from './BeatboxCalibrate'

const DRUM_LABELS: Record<string, string> = { kick: 'kick', snare: 'snare', hihat: 'hi-hat', openhat: 'open-hat' }

interface Layer {
  id: string
  name: string
  trackNames: string[]
  muted: boolean
}

type Phase = 'idle' | 'recording' | 'analyzing' | 'done'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// audio constraints for a given input device ('' = system default).
// `overdub` turns on echo cancellation so a looping part doesn't leak into a new take.
function micConstraints(deviceId: string, overdub = false): MediaStreamConstraints {
  const base = { echoCancellation: overdub, noiseSuppression: false, autoGainControl: false }
  return { audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base }
}

export default function BeatboxToDrums({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ bpm: number; counts: Record<string, number>; total: number } | null>(null)
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([])
  const [deviceId, setDeviceId] = useState<string>('') // '' = system default
  const [profile, setProfile] = useState<DrumProfile>({})
  const [showCalib, setShowCalib] = useState(false)
  const [layers, setLayers] = useState<Layer[]>([])

  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startRef = useRef(0)
  const rafRef = useRef(0)
  const bufRef = useRef<Float32Array>(new Float32Array(2048))
  const peakRef = useRef(0) // loudest input seen this take — detects a silent mic
  const createdRef = useRef<string[]>([]) // the un-kept preview take's track names
  const analysisRef = useRef<BeatboxResult | null>(null)
  const layerRef = useRef(0) // number of parts kept (used to give new parts fresh names)
  const sessionBpmRef = useRef<number | null>(null) // locked once the first part is kept
  const sessionBarsRef = useRef<number | null>(null)

  // ---- live input monitor (so you can pick a mic and SEE it register) ----
  const monStreamRef = useRef<MediaStream | null>(null)
  const monCtxRef = useRef<AudioContext | null>(null)
  const monRafRef = useRef(0)

  function stopMonitor() {
    cancelAnimationFrame(monRafRef.current)
    try {
      monStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      // ignore
    }
    try {
      monCtxRef.current?.close()
    } catch {
      // ignore
    }
    monStreamRef.current = null
    monCtxRef.current = null
  }

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const mics = list
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
      setDevices(mics)
    } catch {
      // ignore
    }
  }

  // Open a live stream on the chosen device and drive the meter, so the user
  // can confirm the mic actually registers before recording.
  async function startMonitor(id: string) {
    stopMonitor()
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(id))
      monStreamRef.current = stream
      void refreshDevices() // labels are only populated once permission is granted
      const ctx = new AudioContext()
      monCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      src.connect(an)
      const buf = new Float32Array(2048)
      const tick = () => {
        an.getFloatTimeDomainData(buf as any)
        let p = 0
        for (const v of buf) {
          const abs = v < 0 ? -v : v
          if (abs > p) p = abs
        }
        setLevel(p)
        monRafRef.current = requestAnimationFrame(tick)
      }
      monRafRef.current = requestAnimationFrame(tick)
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone blocked. Allow mic access, then reopen this panel.'
          : e?.message || 'Could not open that microphone. Try another device.',
      )
    }
  }

  // run the monitor while the panel is open and idle; stop it while recording
  // or while the calibration modal owns the mic
  useEffect(() => {
    if (open && !showCalib && (phase === 'idle' || phase === 'done')) {
      void startMonitor(deviceId)
    } else {
      stopMonitor()
    }
    return () => stopMonitor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId, phase, showCalib])

  useEffect(() => setProfile(loadProfile()), [])

  useEffect(() => () => cleanup(), [])
  function cleanup() {
    cancelAnimationFrame(rafRef.current)
    stopMonitor()
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
    stopMonitor() // free the device so the recording stream can open it
    // unlock the audio engine within this click gesture so playback works later
    engine.ensureStarted().catch(() => {})
    try {
      const overdub = layers.length > 0
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId, overdub))
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

      const analysis = analyzeBeatbox(audio, loadProfile())
      if (!analysis.hits.length) {
        setError('No drum hits detected — try beatboxing a bit louder and closer to the mic.')
        setPhase('idle')
        return
      }
      analysisRef.current = analysis
      const built = await buildDrums(analysis)

      const counts: Record<string, number> = {}
      for (const h of built.hits) counts[h.type] = (counts[h.type] || 0) + 1
      setSummary({ bpm: built.bpm, counts, total: built.hits.length })
      setPhase('done')
    } catch (e: any) {
      setError(e?.message || 'Could not analyze the recording.')
      setPhase('idle')
    }
  }

  // Build the current (un-kept) take's drums. If a session tempo is already
  // locked (a part was kept), snap this take to it and give it fresh names so
  // the kept parts keep looping alongside.
  async function buildDrums(a: BeatboxResult): Promise<{ bpm: number; hits: Hit[] }> {
    const order: Array<[Hit['type'], string]> = [
      ['kick', 'Kick'],
      ['snare', 'Snare'],
      ['hihat', 'Hihat'],
      ['openhat', 'Open Hat'],
    ]
    const locked = sessionBpmRef.current != null
    const bpm = locked ? (sessionBpmRef.current as number) : a.bpm
    const bars = locked ? (sessionBarsRef.current as number) : a.bars
    const hits = locked ? requantize(a.raw, bpm).hits : a.hits
    const suffix = layerRef.current === 0 ? '' : ` ${layerRef.current + 1}`

    const cmds: any[] = [{ type: 'set_tempo', bpm }]
    // drop the previous (un-kept) preview tracks first
    for (const name of createdRef.current) cmds.push({ type: 'remove_track', track: name })
    const created: string[] = []
    for (const [type, base] of order) {
      const group = hits.filter((h) => h.type === type)
      if (!group.length) continue
      const name = base + suffix
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
    cmds.push({ type: 'set_loop', bars })
    cmds.push({ type: 'transport', action: 'play' })
    await useStore.getState().applyCommands(cmds)
    return { bpm, hits }
  }

  // Commit the current take as its own looping part.
  function keepAsTrack() {
    if (!createdRef.current.length || !analysisRef.current) return
    if (sessionBpmRef.current == null) {
      sessionBpmRef.current = summary?.bpm ?? analysisRef.current.bpm
      sessionBarsRef.current = analysisRef.current.bars
    }
    const types = summary ? Object.keys(summary.counts) : []
    const name = types.map((t) => DRUM_LABELS[t] || t).join(' + ') || 'Part'
    setLayers((ls) => [...ls, { id: `L${Date.now().toString(36)}`, name, trackNames: createdRef.current.slice(), muted: false }])
    layerRef.current += 1
    createdRef.current = []
    analysisRef.current = null
    setSummary(null)
    setPhase('idle')
  }

  // discard the current take (keeps any kept parts looping)
  async function discard() {
    const noLayers = layers.length === 0
    const cmds: any[] = []
    for (const name of createdRef.current) cmds.push({ type: 'remove_track', track: name })
    if (noLayers) cmds.push({ type: 'transport', action: 'stop' })
    await useStore.getState().applyCommands(cmds)
    createdRef.current = []
    analysisRef.current = null
    setSummary(null)
    setError(null)
    setElapsed(0)
    setPhase('idle')
    if (noLayers) {
      sessionBpmRef.current = null
      sessionBarsRef.current = null
      layerRef.current = 0
    }
  }

  async function removeLayer(id: string) {
    const layer = layers.find((l) => l.id === id)
    if (!layer) return
    const rest = layers.filter((l) => l.id !== id)
    const empty = rest.length === 0 && createdRef.current.length === 0
    const cmds: any[] = layer.trackNames.map((n) => ({ type: 'remove_track', track: n }))
    if (empty) cmds.push({ type: 'transport', action: 'stop' })
    await useStore.getState().applyCommands(cmds)
    setLayers(rest)
    if (empty) {
      sessionBpmRef.current = null
      sessionBarsRef.current = null
      layerRef.current = 0
    }
  }

  async function toggleMute(id: string) {
    const layer = layers.find((l) => l.id === id)
    if (!layer) return
    const muted = !layer.muted
    await useStore.getState().applyCommands(layer.trackNames.map((n) => ({ type: 'set_track_mute', track: n, muted })))
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, muted } : l)))
  }

  if (!open) return null
  const meterPct = Math.min(100, Math.round(level * 160))
  const busy = phase === 'recording' || phase === 'analyzing'
  const calibratedTypes = Object.keys(profile)
  const calibrated = calibratedTypes.length >= 2

  return (
    <>
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
          {layers.length > 0
            ? 'Loop is playing — beatbox another part to stack it on top (kick, snare, hats).'
            : 'Beatbox a groove — kicks, snares, and hats with your mouth. Jamalam finds the hits, figures out the tempo, and turns them into a real drum kit you can play and edit.'}
        </p>

        {layers.length > 0 && (
          <div className="jam-layers">
            {layers.map((l) => (
              <div key={l.id} className={`jam-layer ${l.muted ? 'muted' : ''}`}>
                <button className="jam-layer-name" onClick={() => toggleMute(l.id)}>
                  {l.muted ? '🔇' : '🔊'} {l.name}
                </button>
                <button className="jam-layer-x" onClick={() => removeLayer(l.id)} aria-label="remove part">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {(phase === 'idle' || phase === 'done') && (
          <div className="mic-picker">
            <label className="mic-label">
              🎙 Mic
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">System default</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={`mic-live ${level > 0.02 ? 'on' : ''}`}>
              {level > 0.02 ? '● receiving signal' : 'talk/beatbox — the bar should move ↓'}
            </span>
          </div>
        )}

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
            <button className="jam-keep" onClick={keepAsTrack} title="Keep this take as its own looping part">
              ＋ Keep as track
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
            {['kick', 'snare', 'hihat', 'openhat']
              .filter((k) => summary.counts[k])
              .map((k) => `${summary.counts[k]} ${DRUM_LABELS[k] || k}`)
              .join(' · ')}{' '}
            · ~{summary.bpm} BPM. Drum tracks added — playing now.
          </div>
        )}

        {!busy && (
          <div className="calib-status">
            <span className={calibrated ? 'calib-ok' : 'calib-none'}>
              {calibrated
                ? `🎚 Tuned to you: ${calibratedTypes.map((t) => DRUM_LABELS[t] || t).join(', ')}`
                : 'Using generic detection — calibrate for better accuracy'}
            </span>
            <button className="calib-btn" onClick={() => setShowCalib(true)}>
              {calibrated ? 'Re-calibrate' : '🎚 Calibrate to your voice'}
            </button>
          </div>
        )}
      </div>
    </div>

    <BeatboxCalibrate
      open={showCalib}
      onClose={() => setShowCalib(false)}
      deviceId={deviceId}
      initial={profile}
      onSaved={setProfile}
    />
    </>
  )
}
