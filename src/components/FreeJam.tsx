import { useEffect, useRef, useState } from 'react'
import { JamRecorder } from '../audio/recorder'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function FreeJam({ open, onClose }: { open: boolean; onClose: () => void }) {
  const recorderRef = useRef<JamRecorder | null>(null)
  const levelRef = useRef(0)
  const rafRef = useRef(0)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [flags, setFlags] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<JamMeta[]>([])
  const [lastSaved, setLastSaved] = useState<JamMeta | null>(null)

  async function refreshSessions() {
    try {
      setSessions(await window.daw.jam.list())
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (open) refreshSessions()
  }, [open])

  // drive timer + meter while recording
  useEffect(() => {
    if (!recording) return
    const tick = () => {
      const rec = recorderRef.current
      if (rec) {
        setElapsed(rec.elapsedMs())
        setLevel((prev) => Math.max(levelRef.current, prev * 0.82)) // smooth decay
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [recording])

  async function startJam() {
    setError(null)
    setLastSaved(null)
    setFlags([])
    const rec = new JamRecorder()
    rec.onLevel = (v) => {
      levelRef.current = v
    }
    try {
      await rec.start()
      recorderRef.current = rec
      setRecording(true)
    } catch (err: any) {
      setError(err?.message || 'Could not start recording. Check microphone access.')
    }
  }

  async function stopJam() {
    const rec = recorderRef.current
    if (!rec) return
    const meta = await rec.stop()
    recorderRef.current = null
    levelRef.current = 0
    setRecording(false)
    setElapsed(0)
    setLevel(0)
    setLastSaved(meta)
    refreshSessions()
  }

  async function flagMoment() {
    const rec = recorderRef.current
    if (!rec) return
    const ms = await rec.flag()
    setFlags((f) => [...f, ms])
  }

  if (!open) return null

  const meterPct = Math.min(100, Math.round(level * 140))

  return (
    <div className="modal-backdrop">
      <div className="jam">
        <div className="jam-head">
          <h2>🎙 Free Jam</h2>
          {!recording && (
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        {!recording ? (
          <p className="jam-sub">
            Hit record and just vibe — sing, beatbox, clap, play. Jamalam listens and captures the
            whole session to build a song from. Flag the good moments as they happen.
          </p>
        ) : (
          <p className="jam-sub recording">Recording… the DAW is listening.</p>
        )}

        <div className="jam-meter">
          <div className="jam-meter-fill" style={{ width: `${meterPct}%` }} />
        </div>

        <div className="jam-timer">{fmt(elapsed)}</div>

        <div className="jam-controls">
          {!recording ? (
            <button className="jam-rec" onClick={startJam}>
              ● Record
            </button>
          ) : (
            <>
              <button className="jam-flag" onClick={flagMoment}>
                ⚑ Flag moment{flags.length ? ` (${flags.length})` : ''}
              </button>
              <button className="jam-stop" onClick={stopJam}>
                ■ Stop
              </button>
            </>
          )}
        </div>

        {error && <div className="jam-error">{error}</div>}

        {lastSaved && !recording && (
          <div className="jam-saved">
            ✓ Saved {fmt(lastSaved.durationSec * 1000)} · {lastSaved.flags.length} flag
            {lastSaved.flags.length === 1 ? '' : 's'}
          </div>
        )}

        <div className="jam-sessions">
          <div className="jam-sessions-head">
            <span>Recordings</span>
            {sessions.length > 0 && (
              <button className="link" onClick={() => window.daw.jam.openFolder()}>
                Open folder ↗
              </button>
            )}
          </div>
          {sessions.length === 0 ? (
            <div className="jam-empty">No jams yet.</div>
          ) : (
            <ul>
              {sessions.map((s) => (
                <li key={s.id}>
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                  <span className="jam-dur">
                    {fmt(s.durationSec * 1000)} · {s.flags.length} ⚑
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
