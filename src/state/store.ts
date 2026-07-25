import { create } from 'zustand'
import { engine } from '../audio/engine'
import type { ChatMessage, Command, InstrumentType, Note, Track } from '../types'

const INSTRUMENTS: InstrumentType[] = [
  'synth', 'fm', 'am', 'pluck', 'bass', 'pad',
  'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim',
]

function normInstrument(v: any): InstrumentType {
  return INSTRUMENTS.includes(v) ? v : 'synth'
}

function normNote(n: any): Note {
  return {
    pitch: String(n.pitch ?? 'C4'),
    start: Number(n.start ?? 0),
    duration: Number(n.duration ?? 0.5),
    velocity: Math.max(0, Math.min(1, Number(n.velocity ?? 0.8))),
  }
}

let idCounter = 0
function newId() {
  idCounter += 1
  return `t${Date.now().toString(36)}${idCounter}`
}

interface State {
  tempo: number
  loopBars: number
  kit: string
  tracks: Track[]
  selectedTrackId: string | null
  isPlaying: boolean
  messages: ChatMessage[]
  busy: boolean
  hasKey: boolean

  setHasKey: (v: boolean) => void
  setKit: (name: string) => void
  selectTrack: (id: string) => void
  pushMessage: (m: ChatMessage) => void
  setBusy: (v: boolean) => void
  togglePlay: () => Promise<void>
  applyCommands: (commands: Command[]) => Promise<void>
  projectSnapshot: () => any

  addNote: (trackId: string, note: Note) => number
  updateNote: (trackId: string, index: number, patch: Partial<Note>) => void
  deleteNote: (trackId: string, index: number) => void
}

export const useStore = create<State>((set, get) => ({
  tempo: 120,
  loopBars: 4,
  kit: '808',
  tracks: [],
  selectedTrackId: null,
  isPlaying: false,
  messages: [],
  busy: false,
  hasKey: false,

  setHasKey: (v) => set({ hasKey: v }),
  setKit: (name) => {
    void engine.setKit(name)
    set({ kit: name })
  },
  selectTrack: (id) => set({ selectedTrackId: id }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  setBusy: (v) => set({ busy: v }),

  togglePlay: async () => {
    if (get().isPlaying) {
      engine.stop()
      set({ isPlaying: false })
    } else {
      await engine.play()
      set({ isPlaying: true })
    }
  },

  applyCommands: async (commands) => {
    // Make sure the audio engine is started AND the current kit is fully
    // rendered before we build any tracks. Otherwise a Tone.Offline kit render
    // can hold the global audio context while a voice is created, which throws
    // "cannot connect to an AudioNode belonging to a different audio context".
    try {
      await engine.ensureStarted()
    } catch {
      // ignore — playback commands below will retry
    }

    let tracks = get().tracks.slice()
    let tempo = get().tempo
    let loopBars = get().loopBars
    let kit = get().kit
    let selected = get().selectedTrackId
    let shouldPlay: boolean | null = null

    const findByName = (name: string) =>
      tracks.find((t) => t.name.toLowerCase() === String(name).toLowerCase())

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'set_tempo': {
          tempo = Number(cmd.bpm) || tempo
          engine.setTempo(tempo)
          break
        }
        case 'set_loop': {
          loopBars = Math.max(1, Math.round(Number(cmd.bars) || loopBars))
          engine.setLoopBars(loopBars)
          break
        }
        case 'set_kit': {
          kit = String(cmd.kit || kit)
          await engine.setKit(kit) // await the render so no voice is built mid-render
          break
        }
        case 'add_track': {
          const instrument = normInstrument(cmd.instrument)
          const existing = findByName(cmd.name)
          if (existing) {
            existing.instrument = instrument
            if (cmd.volume != null) existing.volume = Number(cmd.volume)
            engine.setInstrument(existing)
          } else {
            const track: Track = {
              id: newId(),
              name: String(cmd.name),
              instrument,
              volume: cmd.volume != null ? Number(cmd.volume) : -6,
              muted: false,
              notes: [],
            }
            tracks = [...tracks, track]
            engine.addOrUpdateTrack(track)
            if (!selected) selected = track.id
          }
          break
        }
        case 'remove_track': {
          const t = findByName(cmd.track)
          if (t) {
            engine.removeTrack(t.id)
            tracks = tracks.filter((x) => x.id !== t.id)
            if (selected === t.id) selected = tracks[0]?.id ?? null
          }
          break
        }
        case 'set_instrument': {
          const t = findByName(cmd.track)
          if (t) {
            t.instrument = normInstrument(cmd.instrument)
            engine.setInstrument(t)
          }
          break
        }
        case 'set_track_volume': {
          const t = findByName(cmd.track)
          if (t) {
            t.volume = Number(cmd.volume)
            engine.setVolume(t.id, t.volume)
          }
          break
        }
        case 'set_track_mute': {
          const t = findByName(cmd.track)
          if (t) {
            t.muted = !!cmd.muted
            engine.setMute(t.id, t.muted)
          }
          break
        }
        case 'add_notes': {
          const t = findByName(cmd.track)
          if (t && Array.isArray(cmd.notes)) {
            t.notes = [...t.notes, ...cmd.notes.map(normNote)]
            engine.setNotes(t.id, t.notes)
            selected = t.id
          }
          break
        }
        case 'clear_track': {
          const t = findByName(cmd.track)
          if (t) {
            t.notes = []
            engine.setNotes(t.id, t.notes)
          }
          break
        }
        case 'transport': {
          shouldPlay = cmd.action === 'play'
          break
        }
        default:
          break
      }
    }

    // new array identity so React re-renders note edits
    tracks = tracks.map((t) => ({ ...t }))
    set({ tracks, tempo, loopBars, kit, selectedTrackId: selected })

    if (shouldPlay === true) {
      await engine.play()
      set({ isPlaying: true })
    } else if (shouldPlay === false) {
      engine.stop()
      set({ isPlaying: false })
    }
  },

  projectSnapshot: () => {
    const s = get()
    return {
      tempo: s.tempo,
      loopBars: s.loopBars,
      kit: s.kit,
      tracks: s.tracks.map((t) => ({
        name: t.name,
        instrument: t.instrument,
        volume: t.volume,
        muted: t.muted,
        noteCount: t.notes.length,
      })),
    }
  },

  addNote: (trackId, note) => {
    let index = -1
    set((s) => {
      const tracks = s.tracks.map((t) => {
        if (t.id !== trackId) return t
        const notes = [...t.notes, note]
        index = notes.length - 1
        engine.setNotes(t.id, notes)
        return { ...t, notes }
      })
      return { tracks, selectedTrackId: trackId }
    })
    return index
  },

  updateNote: (trackId, index, patch) => {
    set((s) => {
      const tracks = s.tracks.map((t) => {
        if (t.id !== trackId) return t
        const notes = t.notes.map((n, i) => (i === index ? { ...n, ...patch } : n))
        engine.setNotes(t.id, notes)
        return { ...t, notes }
      })
      return { tracks }
    })
  },

  deleteNote: (trackId, index) => {
    set((s) => {
      const tracks = s.tracks.map((t) => {
        if (t.id !== trackId) return t
        const notes = t.notes.filter((_, i) => i !== index)
        engine.setNotes(t.id, notes)
        return { ...t, notes }
      })
      return { tracks }
    })
  },
}))
