import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { engine } from '../audio/engine'
import { KIT_NAMES } from '../audio/kits'

export default function Transport() {
  const isPlaying = useStore((s) => s.isPlaying)
  const tempo = useStore((s) => s.tempo)
  const loopBars = useStore((s) => s.loopBars)
  const kit = useStore((s) => s.kit)
  const togglePlay = useStore((s) => s.togglePlay)
  const setKit = useStore((s) => s.setKit)

  // live master-output meter: proves whether sound is actually being produced
  const [level, setLevel] = useState(0)
  const rafRef = useRef(0)
  useEffect(() => {
    const tick = () => {
      setLevel(engine.getLevel())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div className="transport">
      <button className={`play ${isPlaying ? 'on' : ''}`} onClick={() => togglePlay()}>
        {isPlaying ? '■ Stop' : '▶ Play'}
      </button>
      <button className="test-sound" title="Play a test tone — if the bar lights but you hear nothing, it's your OS output/volume" onClick={() => engine.testBeep()}>
        🔊 Test
      </button>
      <div className="master-meter" title="Master output level">
        <div className="master-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
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
      <div className="brand">
        <img className="brand-wordmark" src="./brand/wordmark.png" alt="Jamalam" />
        <span className="brand-studio">Studio</span>
      </div>
    </div>
  )
}
