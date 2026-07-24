import { useState, useRef, useEffect } from 'react'
import { useStore } from '../state/store'
import { engine } from '../audio/engine'

const SUGGESTIONS = [
  'Make a lo-fi hip hop beat at 82 BPM',
  'Add a walking bassline in C minor',
  'Give me a 4-chord synth progression',
  'Make the drums busier',
]

export default function ChatPanel({ onNeedsKey }: { onNeedsKey: () => void }) {
  const [input, setInput] = useState('')
  const messages = useStore((s) => s.messages)
  const busy = useStore((s) => s.busy)
  const pushMessage = useStore((s) => s.pushMessage)
  const setBusy = useStore((s) => s.setBusy)
  const applyCommands = useStore((s) => s.applyCommands)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    // any user gesture is a good time to unlock audio
    engine.ensureStarted().catch(() => {})

    pushMessage({ role: 'user', content: trimmed })
    setInput('')
    setBusy(true)

    const st = useStore.getState()
    const convo = st.messages
      .concat({ role: 'user', content: trimmed })
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    try {
      const res = await window.daw.chat({ messages: convo, project: st.projectSnapshot() })
      if (res.error === 'no_api_key') {
        setBusy(false)
        onNeedsKey()
        return
      }
      if (res.error) {
        pushMessage({ role: 'assistant', content: `⚠️ ${res.message || 'Something went wrong.'}` })
        setBusy(false)
        return
      }
      await applyCommands(res.commands || [])
      pushMessage({
        role: 'assistant',
        content: res.text || `Done — applied ${res.commands?.length ?? 0} changes.`,
      })
    } catch (err: any) {
      pushMessage({ role: 'assistant', content: `⚠️ ${String(err?.message || err)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Tell Claude what to produce.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="msg assistant thinking">Composing…</div>}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Claude to make music…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
