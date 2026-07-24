import { useStore } from '../state/store'
import { KIT_NAMES } from '../audio/kits'

export default function Transport() {
  const isPlaying = useStore((s) => s.isPlaying)
  const tempo = useStore((s) => s.tempo)
  const loopBars = useStore((s) => s.loopBars)
  const kit = useStore((s) => s.kit)
  const togglePlay = useStore((s) => s.togglePlay)
  const setKit = useStore((s) => s.setKit)

  return (
    <div className="transport">
      <button className={`play ${isPlaying ? 'on' : ''}`} onClick={() => togglePlay()}>
        {isPlaying ? '■ Stop' : '▶ Play'}
      </button>
      <div className="meta">
        <span className="pill">{Math.round(tempo)} BPM</span>
        <span className="pill">{loopBars} bars · 4/4</span>
        <label className="kit-select">
          <span>Kit</span>
          <select value={kit} onChange={(e) => setKit(e.target.value)}>
            {KIT_NAMES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="brand">🎛 Aurumo DAW</div>
    </div>
  )
}
