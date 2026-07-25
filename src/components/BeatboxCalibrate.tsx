import { useEffect, useRef, useState } from 'react'
import { profileFromBuffer, type DrumProfile, type DrumType } from '../audio/beatbox'
import { saveProfile } from '../audio/profile'

const STEPS: { type: DrumType; title: string; cue: string; say: string }[] = [
  { type: 'kick', title: 'Kick / Bass drum', cue: 'Deep chest "b" — like "boom" / "buh"', say: 'b · b · b · b' },
  { type: 'snare', title: 'Snare', cue: 'Sharp "k", "psh" or "ka"', say: 'k · psh · k · psh' },
  { type: 'hihat', title: 'Closed hi-hat', cue: 'Short crisp "ts" / "t" — cut it off fast', say: 'ts · ts · ts · ts' },
  { type: 'openhat', title: 'Open hi-hat', cue: 'Long airy "tsss" / "chh" — let it ring out', say: 'tsss — tsss' },
]
const REC_MS = 2600

function micConstraints(deviceId: string): MediaStreamConstraints {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  return { audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base }
}

export default function BeatboxCalibrate({
  open,
  onClose,
  deviceId,
  initial,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  deviceId: string
  initial: DrumProfile
  onSaved: (p: DrumProfile) => void
}) {
  const [step, setStep] = useState(0)
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [captured, setCaptured] = useState<Record<string, boolean>>(() => {
    const c: Record<string, boolean> = {}
    for (const k of Object.keys(initial)) c[k] = true
    return c
  })
  const profileRef = useRef<DrumProfile>({ ...initial })

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) cleanup()
    return () => cleanup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function cleanup() {
    if (timerRef.current) clearTimeout(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    try {
      if (recRef.current && recRef.current.state === 'recording') recRef.current.stop()
    } catch {
      // ignore
    }
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
    streamRef.current = null
    ctxRef.current = null
    setRecording(false)
    setLevel(0)
  }

  async function record() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId))
      streamRef.current = stream
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      src.connect(an)
      const buf = new Float32Array(2048)
      const rec = new MediaRecorder(stream)
      recRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      rec.onstop = onStopped
      rec.start()
      setRecording(true)
      const tick = () => {
        an.getFloatTimeDomainData(buf as any)
        let p = 0
        for (const v of buf) {
          const a = v < 0 ? -v : v
          if (a > p) p = a
        }
        setLevel(p)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      timerRef.current = setTimeout(() => {
        try {
          rec.stop()
        } catch {
          // ignore
        }
      }, REC_MS)
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Mic blocked — allow access and try again.'
          : e?.message || 'Could not open the microphone.',
      )
      setRecording(false)
    }
  }

  async function onStopped() {
    cancelAnimationFrame(rafRef.current)
    setRecording(false)
    setLevel(0)
    try {
      const blob = new Blob(chunksRef.current)
      const ctx = ctxRef.current ?? new AudioContext()
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
      streamRef.current?.getTracks().forEach((t) => t.stop())
      const fp = profileFromBuffer(audio)
      if (!fp) {
        setError('Didn’t catch a clear sound — try again, a bit louder and closer to the mic.')
        return
      }
      const t = STEPS[step].type
      profileRef.current = { ...profileRef.current, [t]: fp }
      setCaptured((c) => ({ ...c, [t]: true }))
    } catch (e: any) {
      setError(e?.message || 'Could not analyze that sound.')
    }
  }

  function finish() {
    saveProfile(profileRef.current)
    onSaved(profileRef.current)
    onClose()
  }

  if (!open) return null
  const s = STEPS[step]
  const done = !!captured[s.type]
  const capturedCount = STEPS.filter((x) => captured[x.type]).length
  const meterPct = Math.min(100, Math.round(level * 160))

  return (
    <div className="modal-backdrop">
      <div className="jam calib">
        <div className="jam-head">
          <h2>🎚 Calibrate your beatbox</h2>
          <button className="ghost" onClick={onClose} disabled={recording}>
            Close
          </button>
        </div>

        <p className="jam-sub">
          Record yourself making each drum sound the way <em>you</em> do it. Jamalam learns your
          personal fingerprints so it can tell your kick, snare, closed and open hats apart.
        </p>

        <div className="calib-steps">
          {STEPS.map((x, i) => (
            <button
              key={x.type}
              className={`calib-dot ${i === step ? 'cur' : ''} ${captured[x.type] ? 'ok' : ''}`}
              onClick={() => !recording && setStep(i)}
              title={x.title}
            >
              {captured[x.type] ? '✓' : i + 1}
            </button>
          ))}
        </div>

        <div className="calib-card">
          <div className="calib-title">{s.title}</div>
          <div className="calib-cue">{s.cue}</div>
          <div className="calib-say">{s.say}</div>
        </div>

        <div className="jam-meter">
          <div className="jam-meter-fill" style={{ width: `${meterPct}%` }} />
        </div>

        <div className="jam-controls">
          {!recording ? (
            <button className="jam-rec" onClick={record}>
              {done ? '↺ Re-record' : '● Record ~3s'}
            </button>
          ) : (
            <button className="jam-stop" disabled>
              Listening… make the sound 4×
            </button>
          )}
          {step < STEPS.length - 1 && (
            <button className="jam-stop" onClick={() => setStep(step + 1)} disabled={recording}>
              Next ›
            </button>
          )}
        </div>

        {error && <div className="jam-error">{error}</div>}

        <div className="calib-foot">
          <span className="calib-count">{capturedCount}/{STEPS.length} sounds captured</span>
          <button
            className="jam-rec"
            onClick={finish}
            disabled={capturedCount < 2 || recording}
            title={capturedCount < 2 ? 'Capture at least 2 sounds first' : 'Save your profile'}
          >
            Save &amp; use
          </button>
        </div>
      </div>
    </div>
  )
}
