import { useRef, useState } from 'react'
import { BookOpen, Code2, PlayCircle, Users } from 'lucide-react'
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

type ChatSource = {
  url?: string
  source_path?: string
  title?: string
}

function firstReadUrl(sources: unknown): string | null {
  if (!Array.isArray(sources) || sources.length === 0) return null
  const s = sources[0] as ChatSource
  const u = typeof s.url === 'string' ? s.url.trim() : ''
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  return null
}

const MARCY_DOCS_HOME =
  import.meta.env.VITE_MARCY_DOCS_HOME_URL ||
  'https://marcylabschool.gitbook.io/marcy-lab-school-docs#course-modules'

const PRACTICE_URL =
  import.meta.env.VITE_PRACTICE_URL || 'https://jsbin.com/?js'

function openExternalTab(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer')
}

/**
 * App shell + local message list + POST /api/chat (Vite proxies to Express on :3000).
 */
function App() {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** Prior assistant `move` from last successful /api/chat response; sent as previousAssistantMove on the next request. */
  const [lastAssistantMove, setLastAssistantMove] = useState<AssistantKind | null>(
    null,
  )
  /** Rank-1 retrieval target for Read, or null → fall back to static docs home. */
  const [readUrlFromRag, setReadUrlFromRag] = useState<string | null>(null)

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
      const data: {
        answer?: string
        move?: string
        error?: string
        sources?: unknown
      } = await res.json()
      if (!res.ok) {
        throw new Error(data.error || res.statusText)
      }
      const reply = data.answer?.trim() || '(empty reply)'
      if (isAssistantKind(data.move)) {
        setLastAssistantMove(data.move)
      }
      setReadUrlFromRag(firstReadUrl(data.sources))
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: 'assistant', text: reply },
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed'
      setReadUrlFromRag(null)
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

      <footer className="app-dock" aria-label="Composer and shortcuts">
        <div className="app-composer" aria-label="Message composer">
          <label htmlFor="message-input" className="visually-hidden">
            Message
          </label>
          <textarea
            ref={inputRef}
            id="message-input"
            className="app-input"
            name="message"
            placeholder="Ask me a question and level up"
            rows={2}
            autoComplete="off"
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return
              if (e.nativeEvent.isComposing) return
              e.preventDefault()
              void sendMessage()
            }}
          />
          <button
            type="button"
            className="app-send"
            disabled={sending}
            onClick={sendMessage}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
        <div className="app-chip-toolbar" role="toolbar" aria-label="Learning shortcuts">
          <button
            type="button"
            className="app-chip app-chip--disabled"
            disabled
            title="Peer help not wired yet"
          >
            <Users className="app-chip-icon" aria-hidden />
            <span className="app-chip-label">Peer</span>
          </button>
          <button
            type="button"
            className="app-chip"
            disabled={sending}
            title={
              readUrlFromRag
                ? 'Open top matching Marcy doc (from last reply)'
                : 'Open Marcy curriculum docs (ask a question for a section link when RAG is on)'
            }
            onClick={() => openExternalTab(readUrlFromRag || MARCY_DOCS_HOME)}
          >
            <BookOpen className="app-chip-icon" aria-hidden />
            <span className="app-chip-label">Read</span>
          </button>
          <button
            type="button"
            className="app-chip app-chip--disabled"
            disabled
            title="Curated Marcy videos not wired yet"
          >
            <PlayCircle className="app-chip-icon" aria-hidden />
            <span className="app-chip-label">Watch</span>
          </button>
          <button
            type="button"
            className="app-chip app-chip--primary"
            disabled={sending}
            title="Open JS Bin (JavaScript pane) to practice"
            onClick={() => openExternalTab(PRACTICE_URL)}
          >
            <Code2 className="app-chip-icon" aria-hidden />
            <span className="app-chip-label">Practice</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

export default App
