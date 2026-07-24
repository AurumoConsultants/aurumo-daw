import { useState } from 'react'
import { useStore } from '../state/store'

export default function ApiKeyModal({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const setHasKey = useStore((s) => s.setHasKey)

  async function save() {
    setSaving(true)
    const res = await window.daw.setKey(key)
    setHasKey(res.hasKey)
    setSaving(false)
    if (res.hasKey) onClose()
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Connect Claude</h2>
        <p>
          Jamalam Studio is powered by Claude through the Anthropic API. Paste an API key to begin — it's
          stored locally on this machine only.
        </p>
        <input
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Later
          </button>
          <button className="primary" onClick={save} disabled={saving || !key.trim()}>
            {saving ? 'Saving…' : 'Save & Connect'}
          </button>
        </div>
        <a
          className="modal-link"
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
        >
          Get an API key ↗
        </a>
      </div>
    </div>
  )
}
