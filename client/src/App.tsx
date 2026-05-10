import { useState } from 'react'
import { AssistantMessageBody } from './AssistantMessageBody'
import './App.css'

/** One line in the transcript (user or assistant). IDs keep React lists stable when we reorder later. */
type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

/** Works on http://LAN IPs (phone on Wi‑Fi); crypto.randomUUID needs https or localhost. */
function newMessageId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
  } catch {
    /* non-secure context */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

type AssistantKind = 'explain' | 'check' | 'probe' | 'prompt'

function toApiMessages(history: Message[]) {
  return history.map((m) => ({ role: m.role, content: m.text }))
}

const ASSISTANT_KINDS: AssistantKind[] = ['explain', 'check', 'probe', 'prompt']

function isAssistantKind(v: unknown): v is AssistantKind {
  return typeof v === 'string' && (ASSISTANT_KINDS as string[]).includes(v)
}

/**
 * App shell + local message list + POST /api/chat (Vite proxies to Express on :3000).
 */
function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** Prior assistant `move` from last successful /api/chat response; sent as previousAssistantMove on the next request. */
  const [lastAssistantMove, setLastAssistantMove] = useState<AssistantKind | null>(
    null,
  )

  async function sendMessage() {
    const text = draft.trim()
    if (!text || sending) return

    const userMsg: Message = {
      id: newMessageId(),
      role: 'user',
      text,
    }
    const historyForApi = [...messages, userMsg]
    setMessages(historyForApi)
    setDraft('')
    setSending(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(historyForApi),
          ...(lastAssistantMove != null
            ? { previousAssistantMove: lastAssistantMove }
            : {}),
        }),
      })
      const data: { answer?: string; move?: string; error?: string } =
        await res.json()
      if (!res.ok) {
        throw new Error(data.error || res.statusText)
      }
      const reply = data.answer?.trim() || '(empty reply)'
      if (isAssistantKind(data.move)) {
        setLastAssistantMove(data.move)
      }
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: 'assistant', text: reply },
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed'
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'assistant',
          text: `Something went wrong: ${msg}. Is the API running? (npm run dev:api from repo root)`,
        },
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">KestinBot x Marcy Lab School</h1>
      </header>

      <main className="app-main" id="conversation" aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="app-onboarding">
            <p className="app-placeholder">
              <strong>KestinBot</strong> is a study assistant for 
              <strong>Marcy Lab School</strong> software engineering. 
              Ask in plain English and get a quick answer grounded in
              Marcy’s curriculum. <br/><br/>
              When the explanation in class just didn’t click, 
              or you didn’t want to draw attention by raising your hand.
              Ask here with no judgement. Learn at your own pace. Available anytime.
            </p>
            <p className="app-onboarding-cta">
              What are you curious about?
              Ask me a question and level up.
            </p>
          </div>
        ) : (
          <ul className="app-messages" aria-live="polite">
            {messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === 'user' ? 'app-msg app-msg--user' : 'app-msg app-msg--assistant'
                }
              >
                <span className="visually-hidden">{m.role}: </span>
                {m.role === 'assistant' ? (
                  <AssistantMessageBody text={m.text} />
                ) : (
                  m.text
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="app-composer" aria-label="Message composer">
        <label htmlFor="message-input" className="visually-hidden">
          Message
        </label>
        <textarea
          id="message-input"
          className="app-input"
          name="message"
          placeholder="Ask about the Marcy curriculum…"
          rows={2}
          autoComplete="off"
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="app-send"
          disabled={sending}
          onClick={sendMessage}
        >
          {sending ? '…' : 'Send'}
        </button>
      </footer>
    </div>
  )
}

export default App
