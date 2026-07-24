import { useStore } from '../state/store'
import { engine } from '../audio/engine'

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

export default function TrackList() {
  const tracks = useStore((s) => s.tracks)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectTrack = useStore((s) => s.selectTrack)

  if (tracks.length === 0) {
    return (
      <div className="tracklist empty">
        <p>No tracks yet.</p>
        <p className="hint">Ask Claude to make something →</p>
      </div>
    )
  }

  return (
    <div className="tracklist">
      {tracks.map((t) => (
        <div
          key={t.id}
          className={`track ${selectedTrackId === t.id ? 'sel' : ''}`}
          onClick={() => selectTrack(t.id)}
        >
          <span className="swatch" style={{ background: COLORS[t.instrument] || '#888' }} />
          <div className="track-info">
            <div className="track-name">{t.name}</div>
            <div className="track-sub">
              {t.instrument} · {t.notes.length} notes
            </div>
          </div>
          <button
            className={`mute ${t.muted ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              const next = !t.muted
              engine.setMute(t.id, next)
              // reflect in state
              useStore.setState((s) => ({
                tracks: s.tracks.map((x) => (x.id === t.id ? { ...x, muted: next } : x)),
              }))
            }}
          >
            {t.muted ? 'M' : 'M'}
          </button>
        </div>
      ))}
    </div>
  )
}
