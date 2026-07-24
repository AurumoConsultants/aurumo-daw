import { useEffect, useState } from 'react'

export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.daw?.onUpdateStatus) return
    const off = window.daw.onUpdateStatus((s) => {
      setStatus(s)
      if (s.state === 'available' || s.state === 'downloading' || s.state === 'ready') {
        setDismissed(false)
      }
    })
    return off
  }, [])

  if (!status || dismissed) return null

  // only surface meaningful states to the user
  if (status.state === 'downloading') {
    return (
      <div className="update-toast">
        <span className="spinner" />
        <span>Downloading update… {status.percent ?? 0}%</span>
      </div>
    )
  }

  if (status.state === 'ready') {
    return (
      <div className="update-toast ready">
        <span>
          Update {status.version ? `v${status.version} ` : ''}ready
        </span>
        <button className="primary" onClick={() => window.daw.restartToUpdate()}>
          Restart &amp; update
        </button>
        <button className="ghost" onClick={() => setDismissed(true)}>
          Later
        </button>
      </div>
    )
  }

  return null
}
