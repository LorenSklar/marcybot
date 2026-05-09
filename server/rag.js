/**
 * RAG helpers: compose retrieval text, embed, pgvector search, format context + sources.
 */
import pg from 'pg'

const EMBED_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'

/** Build text to embed: last user message, or last user + prior assistant when short reply after a teaching move. */
export function buildRetrievalText(messages, previousAssistantMove) {
  if (!messages?.length) return ''
  const last = messages[messages.length - 1]
  if (last.role !== 'user') return ''
  const text = last.content.trim()
  if (!text) return ''

  let assistantBefore = ''
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      assistantBefore = messages[i].content
      break
    }
  }

  const short = text.length < 48
  const afterTeach =
    previousAssistantMove === 'check' ||
    previousAssistantMove === 'explain' ||
    previousAssistantMove === 'probe'

  if (short && assistantBefore && afterTeach) {
    const ctx = assistantBefore.trim().slice(0, 800)
    return `Assistant context (for retrieval):\n${ctx}\n\nStudent message:\n${text}`
  }
  return text
}

export async function embedQuery(openai, text) {
  const input = text.length > 8000 ? text.slice(0, 8000) : text
  if (!input.trim()) return null
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input,
  })
  return res.data[0]?.embedding ?? null
}

function vectorLiteral(vec) {
  return '[' + vec.map((n) => String(n)).join(',') + ']'
}

let pool = null

function sslForDbUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return undefined
    }
    return { rejectUnauthorized: false }
  } catch {
    return { rejectUnauthorized: false }
  }
}

export function getPool() {
  if (!process.env.DATABASE_URL) return null
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      ssl: sslForDbUrl(process.env.DATABASE_URL),
    })
  }
  return pool
}

export async function searchSimilarChunks(embedding, k) {
  const p = getPool()
  if (!p || !embedding?.length) return []
  const { rows } = await p.query(
    `SELECT id, content, source_path, header_1, header_2
     FROM curriculum
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral(embedding), k],
  )
  return rows
}

export function formatChunksForPrompt(rows) {
  return rows
    .map((c, i) => {
      const label =
        [c.header_1, c.header_2].filter(Boolean).join(' — ') || c.source_path
      return `### [${i + 1}] ${c.source_path}\n_${label}_\n${c.content}`
    })
    .join('\n\n')
}

function curriculumSourceUrl(sourcePath) {
  if (!sourcePath) return ''
  if (/^https?:\/\//i.test(sourcePath)) return sourcePath
  const base =
    process.env.CURRICULUM_SOURCE_BASE_URL ||
    'https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs/blob/main/'
  const normalized = base.replace(/\/?$/, '/')
  const path = String(sourcePath).replace(/^\//, '')
  return normalized + path
}

export function rowsToSources(rows) {
  return rows.map((c) => ({
    title: c.header_2 || c.header_1 || c.source_path,
    url: curriculumSourceUrl(c.source_path),
    source_path: c.source_path,
  }))
}
