import { useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { useStore } from '../state/store'
import { engine } from '../audio/engine'
import type { Note, Track } from '../types'

const COLORS: Record<string, string> = {
  kick: '#ef6461',
  snare: '#f4a259',
  hihat: '#e6c229',
  openhat: '#f7b267',
  clap: '#f25c54',
  tom: '#8d99ae',
  rim: '#c8b6ff',
  bass: '#6a8eae',
  pad: '#a06cd5',
  pluck: '#4cc9a0',
  synth: '#5aa9e6',
  fm: '#f06595',
  am: '#63c7b2',
}

const SNAP = 0.25 // beats (16th note)
const EDGE = 6 // px hit zone for resize handle
const VELO_H = 74 // px height of the velocity lane
const MIN_VEL = 0.05
const BLACK = new Set([1, 3, 6, 8, 10])

function midi(pitch: string): number {
  try {
    return Tone.Frequency(pitch).toMidi()
  } catch {
    return 60
  }
}
function midiToPitch(m: number): string {
  return Tone.Frequency(Math.max(0, Math.min(127, Math.round(m))), 'midi').toNote()
}
function snap(beat: number): number {
  return Math.max(0, Math.round(beat / SNAP) * SNAP)
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

type Layout = {
  lo: number
  hi: number
  beatW: number
  rowH: number
  gridH: number
  rect: DOMRect
  totalBeats: number
}

type EditState =
  | { mode: 'none' }
  | { mode: 'create'; draft: Note }
  | { mode: 'move'; index: number; draft: Note; grabBeat: number; lastPreview: string }
  | { mode: 'resize'; index: number; draft: Note }
  | { mode: 'velocity'; index: number; draft: Note }

export default function PianoRoll() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const track = useStore((s) => s.tracks.find((t) => t.id === s.selectedTrackId)) as
    | Track
    | undefined
  const loopBars = useStore((s) => s.loopBars)

  const dataRef = useRef({ track, loopBars })
  dataRef.current = { track, loopBars }

  const rangeRef = useRef<{ trackId: string | null; lo: number; hi: number }>({
    trackId: null,
    lo: 48,
    hi: 72,
  })
  const editRef = useRef<EditState>({ mode: 'none' })
  const selectedRef = useRef<number | null>(null)
  const lastDurRef = useRef(1)

  useEffect(() => {
    selectedRef.current = null
    editRef.current = { mode: 'none' }
    rangeRef.current = { trackId: track?.id ?? null, lo: 48, hi: 72 }
  }, [track?.id])

  function computeLayout(): Layout {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { track, loopBars } = dataRef.current
    const totalBeats = Math.max(1, loopBars * 4)

    const midis: number[] = (track?.notes ?? []).map((n) => midi(n.pitch))
    const edit = editRef.current
    if (edit.mode !== 'none') midis.push(midi(edit.draft.pitch))

    let lo = 48
    let hi = 72
    if (midis.length) {
      lo = Math.min(48, Math.min(...midis) - 2)
      hi = Math.max(72, Math.max(...midis) + 2)
    }
    const r = rangeRef.current
    if (r.trackId !== (track?.id ?? null)) {
      r.trackId = track?.id ?? null
      r.lo = lo
      r.hi = hi
    } else {
      r.lo = Math.min(r.lo, lo)
      r.hi = Math.max(r.hi, hi)
    }

    const gridH = Math.max(40, rect.height - VELO_H)
    const rows = r.hi - r.lo + 1
    return {
      lo: r.lo,
      hi: r.hi,
      beatW: rect.width / totalBeats,
      rowH: gridH / rows,
      gridH,
      rect,
      totalBeats,
    }
  }

  function pointToBeatMidi(clientX: number, clientY: number, L: Layout) {
    const rx = clientX - L.rect.left
    const ry = clientY - L.rect.top
    return { beat: rx / L.beatW, midiVal: L.hi - Math.floor(ry / L.rowH) }
  }

  // topmost note under a grid point (main area)
  function hitTest(clientX: number, clientY: number, L: Layout) {
    const notes = dataRef.current.track?.notes ?? []
    const rx = clientX - L.rect.left
    const ry = clientY - L.rect.top
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      const x = n.start * L.beatW
      const w = Math.max(3, n.duration * L.beatW)
      const y = (L.hi - midi(n.pitch)) * L.rowH
      if (rx >= x && rx <= x + w && ry >= y && ry <= y + L.rowH) {
        return { index: i, edge: rx >= x + w - EDGE }
      }
    }
    return null
  }

  // note whose time column contains rx (used by the velocity lane)
  function noteAtColumn(clientX: number, L: Layout) {
    const notes = dataRef.current.track?.notes ?? []
    const rx = clientX - L.rect.left
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      const x = n.start * L.beatW
      const w = Math.max(3, n.duration * L.beatW)
      if (rx >= x - 2 && rx <= x + w + 2) return i
    }
    return -1
  }

  function velFromY(clientY: number, L: Layout) {
    const ryRel = clientY - L.rect.top
    return clamp((L.rect.height - ryRel) / VELO_H, MIN_VEL, 1)
  }

  // ---- pointer interaction ----
  function onPointerDown(e: React.PointerEvent) {
    const track = dataRef.current.track
    if (!track || e.button !== 0) return
    const L = computeLayout()
    const canvas = canvasRef.current!
    canvas.setPointerCapture(e.pointerId)
    const ry = e.clientY - L.rect.top

    // velocity lane
    if (ry >= L.gridH) {
      const idx = noteAtColumn(e.clientX, L)
      if (idx >= 0) {
        const n = track.notes[idx]
        const vel = velFromY(e.clientY, L)
        selectedRef.current = idx
        editRef.current = { mode: 'velocity', index: idx, draft: { ...n, velocity: vel } }
        engine.previewNote(track.id, n.pitch, vel)
      }
      e.preventDefault()
      return
    }

    // main grid
    const hit = hitTest(e.clientX, e.clientY, L)
    const { beat, midiVal } = pointToBeatMidi(e.clientX, e.clientY, L)
    if (hit) {
      selectedRef.current = hit.index
      const n = track.notes[hit.index]
      if (hit.edge) {
        editRef.current = { mode: 'resize', index: hit.index, draft: { ...n } }
      } else {
        editRef.current = {
          mode: 'move',
          index: hit.index,
          draft: { ...n },
          grabBeat: beat - n.start,
          lastPreview: n.pitch,
        }
      }
    } else {
      const pitch = midiToPitch(midiVal)
      const draft: Note = { pitch, start: snap(beat), duration: lastDurRef.current, velocity: 0.8 }
      editRef.current = { mode: 'create', draft }
      selectedRef.current = null
      engine.previewNote(track.id, pitch)
    }
    e.preventDefault()
  }

  function onPointerMove(e: React.PointerEvent) {
    const L = computeLayout()
    const edit = editRef.current
    const { beat, midiVal } = pointToBeatMidi(e.clientX, e.clientY, L)

    if (edit.mode === 'none') {
      const ry = e.clientY - L.rect.top
      const canvas = canvasRef.current!
      if (ry >= L.gridH) {
        canvas.style.cursor = 'ns-resize'
      } else {
        const hit = hitTest(e.clientX, e.clientY, L)
        canvas.style.cursor = !hit ? 'crosshair' : hit.edge ? 'ew-resize' : 'grab'
      }
      return
    }

    if (edit.mode === 'create' || edit.mode === 'resize') {
      edit.draft.duration = Math.max(SNAP, Math.round((beat - edit.draft.start) / SNAP) * SNAP)
    } else if (edit.mode === 'move') {
      edit.draft.start = Math.max(0, snap(beat - edit.grabBeat))
      const pitch = midiToPitch(midiVal)
      if (pitch !== edit.lastPreview) {
        edit.draft.pitch = pitch
        edit.lastPreview = pitch
        const t = dataRef.current.track
        if (t) engine.previewNote(t.id, pitch, edit.draft.velocity)
      }
    } else if (edit.mode === 'velocity') {
      edit.draft.velocity = velFromY(e.clientY, L)
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const edit = editRef.current
    const t = dataRef.current.track
    canvasRef.current?.releasePointerCapture?.(e.pointerId)
    if (edit.mode === 'none' || !t) {
      editRef.current = { mode: 'none' }
      return
    }
    if (edit.mode === 'create') {
      const idx = useStore.getState().addNote(t.id, edit.draft)
      selectedRef.current = idx
      lastDurRef.current = edit.draft.duration
    } else {
      useStore.getState().updateNote(t.id, edit.index, edit.draft)
      selectedRef.current = edit.index
      if (edit.mode === 'resize') lastDurRef.current = edit.draft.duration
    }
    editRef.current = { mode: 'none' }
  }

  // scroll wheel over a note nudges its velocity
  function onWheel(e: React.WheelEvent) {
    const t = dataRef.current.track
    if (!t) return
    const L = computeLayout()
    const hit = hitTest(e.clientX, e.clientY, L)
    if (!hit) return
    e.preventDefault()
    const n = t.notes[hit.index]
    const vel = clamp(n.velocity - e.deltaY * 0.001, MIN_VEL, 1)
    selectedRef.current = hit.index
    useStore.getState().updateNote(t.id, hit.index, { velocity: vel })
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const t = dataRef.current.track
    if (!t) return
    const L = computeLayout()
    const hit = hitTest(e.clientX, e.clientY, L)
    if (hit) {
      useStore.getState().deleteNote(t.id, hit.index)
      selectedRef.current = null
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const idx = selectedRef.current
      const t = dataRef.current.track
      if (idx != null && t) {
        useStore.getState().deleteNote(t.id, idx)
        selectedRef.current = null
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const draw = () => {
      const L = computeLayout()
      const { track } = dataRef.current
      const dpr = window.devicePixelRatio || 1
      const needW = Math.max(1, Math.floor(L.rect.width * dpr))
      const needH = Math.max(1, Math.floor(L.rect.height * dpr))
      if (canvas.width !== needW) canvas.width = needW
      if (canvas.height !== needH) canvas.height = needH
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const W = L.rect.width
      const H = L.rect.height
      const gridH = L.gridH
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#14161c'
      ctx.fillRect(0, 0, W, H)

      const rows = L.hi - L.lo + 1
      for (let r = 0; r < rows; r++) {
        const m = L.hi - r
        const y = r * L.rowH
        ctx.fillStyle = BLACK.has(((m % 12) + 12) % 12) ? '#171a22' : '#1b1f29'
        ctx.fillRect(0, y, W, L.rowH)
        if (m % 12 === 0) {
          ctx.fillStyle = '#3a4152'
          ctx.font = '10px system-ui'
          ctx.fillText(midiToPitch(m), 4, y + L.rowH - 3)
        }
        ctx.strokeStyle = '#20242f'
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }
      // beat / bar grid over the note area
      for (let b = 0; b <= L.totalBeats; b++) {
        const x = b * L.beatW
        ctx.strokeStyle = b % 4 === 0 ? '#333a49' : '#242938'
        ctx.lineWidth = b % 4 === 0 ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, gridH)
        ctx.stroke()
      }

      const color = track ? COLORS[track.instrument] || '#5aa9e6' : '#5aa9e6'
      const edit = editRef.current
      const hiddenIndex = edit.mode === 'none' || edit.mode === 'create' ? -1 : edit.index

      const drawNote = (n: Note, selected: boolean, ghost: boolean) => {
        const x = n.start * L.beatW
        const w = Math.max(3, n.duration * L.beatW - 2)
        const y = (L.hi - midi(n.pitch)) * L.rowH + 1
        ctx.fillStyle = color
        ctx.globalAlpha = ghost ? 0.9 : 0.35 + 0.6 * n.velocity
        roundRect(ctx, x + 1, y, w, L.rowH - 2, 3)
        ctx.fill()
        ctx.globalAlpha = 1
        if (selected || ghost) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }

      const notes = track?.notes ?? []
      notes.forEach((n, i) => {
        if (i === hiddenIndex) return
        drawNote(n, selectedRef.current === i, false)
      })
      if (edit.mode !== 'none') {
        // velocity edits should show the alpha change live, not a flat ghost
        drawNote(edit.draft, edit.mode === 'velocity', edit.mode !== 'velocity')
      }

      // ---- velocity lane ----
      ctx.fillStyle = '#101218'
      ctx.fillRect(0, gridH, W, H - gridH)
      ctx.strokeStyle = '#2a2f3c'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, gridH)
      ctx.lineTo(W, gridH)
      ctx.stroke()
      ctx.fillStyle = '#59627a'
      ctx.font = '10px system-ui'
      ctx.fillText('VELOCITY', 6, gridH + 13)

      const drawVel = (n: Note, selected: boolean) => {
        const x = n.start * L.beatW
        const w = Math.max(3, n.duration * L.beatW - 2)
        const h = n.velocity * VELO_H
        const top = H - h
        ctx.fillStyle = color
        ctx.globalAlpha = 0.5
        ctx.fillRect(x + 1, top, w, h)
        ctx.globalAlpha = 1
        ctx.fillStyle = selected ? '#ffffff' : color
        ctx.fillRect(x + 1, top, w, 2) // cap
      }
      notes.forEach((n, i) => {
        if (i === hiddenIndex) return
        drawVel(n, selectedRef.current === i)
      })
      if (edit.mode !== 'none') drawVel(edit.draft, true)

      // playhead across both lanes
      if (engine.isPlaying()) {
        const px = engine.progress() * W
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, H)
        ctx.stroke()
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="pianoroll">
      <div className="pianoroll-head">
        <span>{track ? `${track.name} — ${track.instrument}` : 'Piano Roll'}</span>
        <span className="pr-hint">
          {track
            ? 'draw / move / resize notes · drag the velocity lane or scroll a note for loudness · right-click / Del to remove'
            : 'select a track to edit'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="pianoroll-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
