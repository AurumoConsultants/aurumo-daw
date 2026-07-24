import { useEffect, useState } from 'react'
import { useStore } from './state/store'
import Transport from './components/Transport'
import TrackList from './components/TrackList'
import PianoRoll from './components/PianoRoll'
import ChatPanel from './components/ChatPanel'
import ApiKeyModal from './components/ApiKeyModal'
import UpdateBanner from './components/UpdateBanner'

export default function App() {
  const hasKey = useStore((s) => s.hasKey)
  const setHasKey = useStore((s) => s.setHasKey)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (!window.daw) return
    window.daw.getKeyStatus().then((r) => {
      setHasKey(r.hasKey)
      if (!r.hasKey) setShowKey(true)
    })
  }, [setHasKey])

  return (
    <div className="app">
      <header className="topbar">
        <Transport />
        <button className="gear" onClick={() => setShowKey(true)} title="API key settings">
          {hasKey ? '⚙' : '⚙ Connect'}
        </button>
      </header>

      <div className="workspace">
        <aside className="left">
          <div className="panel-title">Tracks</div>
          <TrackList />
        </aside>
        <main className="center">
          <PianoRoll />
        </main>
        <aside className="right">
          <div className="panel-title">Claude</div>
          <ChatPanel onNeedsKey={() => setShowKey(true)} />
        </aside>
      </div>

      {showKey && <ApiKeyModal onClose={() => setShowKey(false)} />}
      <UpdateBanner />
    </div>
  )
}
