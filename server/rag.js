/**
 * RAG helpers: compose retrieval text, embed, pgvector search, format context + sources.
 */
import pg from 'pg'

const EMBED_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'

/** Max chars of Call 1 summary mixed into the embed string (rest truncated). */
const RETRIEVAL_SUMMARY_MAX_CHARS = 2000

/** Last non-empty user message in the transcript (search from end). */
export function getLastUserContent(messages) {
  if (!messages?.length) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') {
      const t = typeof m.content === 'string' ? m.content.trim() : ''
      if (t) return t
    }
  }
  return ''
}

/** Last non-empty assistant message in the transcript (search from end). */
export function getLastAssistantContent(messages) {
  if (!messages?.length) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant') {
      const t = typeof m.content === 'string' ? m.content.trim() : ''
      if (t) return t
    }
  }
  return ''
}

/**
 * Text to embed for pgvector search: emphasizes the latest student message;
 * optional Call 1 historySummary disambiguates long threads.
 */
export function buildRetrievalText(messages, historySummary = '') {
  const lastUser = getLastUserContent(messages)
  if (!lastUser) return ''
  const raw =
    typeof historySummary === 'string' ? historySummary.trim() : ''
  const capped =
    raw.length > RETRIEVAL_SUMMARY_MAX_CHARS
      ? `${raw.slice(0, RETRIEVAL_SUMMARY_MAX_CHARS)}…`
      : raw
  if (!capped) return lastUser
  return `Current question (primary search focus):\n${lastUser}\n\nThread context:\n${capped}\n\nSearch focus (repeat):\n${lastUser}`
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

/**
 * GitBook published site does not use repo-relative README paths: e.g.
 * `mod-1-javascript-fundamentals/README.md` → `mod-1-javascript-fundamentals.md`,
 * root `README.md` → `readme.md`. Repo paths from ingestion stay Git-shaped until here.
 */
function gitBookPublishedRelativePath(relPath) {
  const p = String(relPath).replace(/^\//, '').replace(/\\/g, '/')
  if (/^README\.md$/i.test(p)) return 'readme.md'
  return p.replace(/\/README\.md$/i, '.md')
}

/**
 * Browser URLs on gitbook.io should not end in `.md` — that path is for markdown/API
 * clients and can break normal HTML reading. Strip one trailing `.md` after README rules.
 */
function gitBookBrowserRelativePath(relPath) {
  let p = gitBookPublishedRelativePath(relPath)
  if (p.endsWith('.md')) p = p.slice(0, -3)
  // Root welcome page: extensionless site root, not /readme
  if (p === 'readme') return ''
  return p
}

/**
 * GitBook anchors: lowercase, dashes; headings like "## 2. Data Types" usually anchor
 * without the leading number.
 */
function slugifyHeadingForFragment(heading) {
  if (!heading || typeof heading !== 'string') return ''
  return heading
    .trim()
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function curriculumSourceUrl(sourcePath, sectionHeading = '') {
  if (!sourcePath) return ''
  if (/^https?:\/\//i.test(sourcePath)) return sourcePath
  const base =
    process.env.CURRICULUM_SOURCE_BASE_URL ||
    'https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs/blob/main/'
  const normalized = base.replace(/\/?$/, '/')
  let rel = String(sourcePath).replace(/^\//, '')
  const isGitBook = /gitbook\.io/i.test(base)
  if (isGitBook) {
    rel = gitBookBrowserRelativePath(rel)
  }
  let url = normalized + rel
  if (isGitBook && sectionHeading) {
    const frag = slugifyHeadingForFragment(sectionHeading)
    if (frag) url += `#${frag}`
  }
  return url
}

export function rowsToSources(rows) {
  return rows.map((c) => ({
    title: c.header_2 || c.header_1 || c.source_path,
    url: curriculumSourceUrl(c.source_path, c.header_2 || c.header_1 || ''),
    source_path: c.source_path,
  }))
}
