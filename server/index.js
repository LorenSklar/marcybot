/**
 * Chat API for Marcybot. Loads repo-root .env + metaprompt from ./metaprompt.md.
 * POST /api/chat — Call 1 (comprehension) → RAG (optional) → Call 3 JSON (answer, move, rationale).
 * Optional body.previousAssistantMove: prior turn's move from last response.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import OpenAI from 'openai'

import {
  buildRetrievalText,
  embedQuery,
  formatChunksForPrompt,
  getLastAssistantContent,
  getLastUserContent,
  rowsToSources,
  searchSimilarChunks,
} from './rag.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const rawCap = parseInt(process.env.CHAT_MAX_MESSAGES ?? '16', 10)
const CHAT_MAX_MESSAGES =
  Number.isFinite(rawCap) && rawCap > 0 ? Math.min(rawCap, 100) : 16

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
const COMPREHENSION_MODEL =
  process.env.OPENAI_COMPREHENSION_MODEL || CHAT_MODEL
const RAG_TOP_K = Math.min(
  Math.max(parseInt(process.env.RAG_TOP_K ?? '5', 10) || 5, 1),
  20,
)

/** Same union as client `AssistantKind`; JSON field remains `move`. */
const ASSISTANT_KINDS = new Set(['explain', 'check', 'probe', 'prompt'])

const COMPREHENSION_KINDS = new Set([
  'lost',
  'partial',
  'solid',
  'off_topic',
])

let systemPromptText = ''
try {
  systemPromptText = fs.readFileSync(
    path.join(__dirname, 'metaprompt.md'),
    'utf8',
  )
} catch (e) {
  console.error('Missing server/metaprompt.md', e)
  process.exit(1)
}

/** Strip leading "# Marcybot…" title line from the markdown file for the API system message. */
function metapromptForApi() {
  const lines = systemPromptText.split('\n')
  const start = lines[0]?.startsWith('# ') ? 1 : 0
  return lines.slice(start).join('\n').trim()
}

function systemContentForRequest({
  previousAssistantMove,
  retrievedExcerptBlock,
  studentComprehension,
  historySummary,
  latestStudentMessage,
  latestAssistantMessage,
}) {
  let content = metapromptForApi()
  content += `\n\n## Student comprehension (from analysis)\n\`${studentComprehension}\``
  content += `\n\n## Thread summary (concise)\n${historySummary || '(none)'}`
  content += `\n\n## Latest student message (verbatim)\n${latestStudentMessage || '(none)'}`
  content += `\n\n## Latest assistant message (verbatim)\n${latestAssistantMessage || '(none yet)'}`
  if (
    typeof previousAssistantMove === 'string' &&
    ASSISTANT_KINDS.has(previousAssistantMove)
  ) {
    content += `\n\n## Turn context (from client)\nThe assistant’s previous reply used **move**: \`${previousAssistantMove}\`.`
  }
  if (retrievedExcerptBlock) {
    content += `\n\n## Retrieved curriculum excerpts\n\n${retrievedExcerptBlock}`
  }
  return content
}

function parseCall1Json(raw, recent) {
  const lastUser = getLastUserContent(recent)
  const fallback = {
    historySummary: lastUser || 'Empty thread.',
    studentComprehension: 'partial',
  }
  if (!raw || typeof raw !== 'string') return fallback
  try {
    const obj = JSON.parse(raw.trim())
    let historySummary =
      typeof obj.historySummary === 'string' ? obj.historySummary.trim() : ''
    if (!historySummary && lastUser) historySummary = lastUser
    const sc = obj.studentComprehension
    const studentComprehension = COMPREHENSION_KINDS.has(sc)
      ? sc
      : 'partial'
    return { historySummary, studentComprehension }
  } catch {
    return fallback
  }
}

async function runComprehensionPass({ recent, previousAssistantMove }) {
  const systemParts = [
    'You summarize a tutoring chat (Marcy Lab School software curriculum) and classify the student’s current comprehension.',
    'Reply with ONLY a JSON object (no markdown fences), keys:',
    '  "historySummary": string — concise (about 2–6 sentences for a typical thread; shorter if the thread is tiny). Used for retrieval and disambiguation.',
    '  "studentComprehension": exactly one of: lost, partial, solid, off_topic',
    'Meanings: lost = confused or missing prerequisites; partial = some understanding, needs tightening; solid = on track; off_topic = tangential to the lesson goal.',
  ]
  if (
    typeof previousAssistantMove === 'string' &&
    ASSISTANT_KINDS.has(previousAssistantMove)
  ) {
    systemParts.push(
      `The client reports the assistant’s previous move was: ${previousAssistantMove}.`,
    )
  }
  const completion = await openai.chat.completions.create({
    model: COMPREHENSION_MODEL,
    messages: [
      { role: 'system', content: systemParts.join('\n') },
      ...recent,
    ],
    response_format: { type: 'json_object' },
  })
  const rawContent = completion.choices[0]?.message?.content ?? ''
  return parseCall1Json(rawContent, recent)
}

const app = express()
app.use(express.json({ limit: '256kb' }))

/** Production: serve Vite build from same origin so `fetch('/api/...')` works without a proxy. */
const clientDist = path.join(__dirname, '..', 'client', 'dist')
const serveClient =
  process.env.NODE_ENV === 'production' &&
  fs.existsSync(path.join(clientDist, 'index.html'))

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function parseChatJson(raw) {
  const fallback = (answer) => ({
    answer,
    move: 'prompt',
    rationale: 'Fallback: could not parse model JSON.',
  })

  if (!raw || typeof raw !== 'string') {
    return fallback('(empty model reply)')
  }

  const trimmed = raw.trim()
  try {
    const obj = JSON.parse(trimmed)
    const answer =
      typeof obj.answer === 'string' && obj.answer.trim()
        ? obj.answer.trim()
        : trimmed
    const move = ASSISTANT_KINDS.has(obj.move) ? obj.move : 'prompt'
    const rationale =
      typeof obj.rationale === 'string' && obj.rationale.trim()
        ? obj.rationale.trim()
        : ''
    return { answer, move, rationale }
  } catch {
    return fallback(trimmed)
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('[chat] status=500 reason=OPENAI_API_KEY')
      res.status(500).json({ error: 'OPENAI_API_KEY missing in .env' })
      return
    }

    const bodyMessages = req.body?.messages
    if (!Array.isArray(bodyMessages)) {
      console.log('[chat] status=400 reason=body.messages')
      res.status(400).json({ error: 'body.messages must be an array' })
      return
    }

    const previousAssistantMove = req.body?.previousAssistantMove

    const normalized = []
    for (const m of bodyMessages) {
      if (!m || typeof m !== 'object') continue
      const role = m.role
      const content = typeof m.content === 'string' ? m.content : ''
      if (role !== 'user' && role !== 'assistant') continue
      if (!content.trim()) continue
      normalized.push({ role, content })
    }

    const recent = normalized.slice(-CHAT_MAX_MESSAGES)
    if (recent.length === 0) {
      console.log('[chat] status=400 reason=empty messages')
      res.status(400).json({ error: 'messages must include at least one turn' })
      return
    }

    let comprehension
    try {
      comprehension = await runComprehensionPass({
        recent,
        previousAssistantMove,
      })
    } catch (c1Err) {
      console.error('Call 1 comprehension failed:', c1Err)
      comprehension = {
        historySummary: getLastUserContent(recent) || 'Empty thread.',
        studentComprehension: 'partial',
      }
    }

    let retrievedContext = ''
    let sources = []
    const retrievalText = buildRetrievalText(
      recent,
      comprehension.historySummary,
    )
    if (process.env.DATABASE_URL && retrievalText) {
      try {
        const embedding = await embedQuery(openai, retrievalText)
        if (embedding) {
          const rows = await searchSimilarChunks(embedding, RAG_TOP_K)
          retrievedContext = formatChunksForPrompt(rows)
          sources = rowsToSources(rows)
        }
      } catch (ragErr) {
        console.error('RAG retrieval failed:', ragErr)
      }
    }

    const system = {
      role: 'system',
      content: systemContentForRequest({
        previousAssistantMove,
        retrievedExcerptBlock: retrievedContext || '',
        studentComprehension: comprehension.studentComprehension,
        historySummary: comprehension.historySummary,
        latestStudentMessage: getLastUserContent(recent),
        latestAssistantMessage: getLastAssistantContent(recent),
      }),
    }

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [system, ...recent],
      response_format: { type: 'json_object' },
    })

    const rawContent = completion.choices[0]?.message?.content ?? ''
    const parsed = parseChatJson(rawContent)

    const chunkCount = sources.length
    console.log(
      `[chat] status=200 currentMove=${parsed.move} studentComprehension=${comprehension.studentComprehension} chunks=${chunkCount}`,
    )

    res.json({
      answer: parsed.answer,
      move: parsed.move,
      rationale: parsed.rationale,
      sources,
      retrieved_context: retrievedContext,
    })
  } catch (err) {
    console.error(err)
    const message = err instanceof Error ? err.message : 'chat failed'
    console.log(`[chat] status=500 error=exception`)
    res.status(500).json({ error: message })
  }
})

if (serveClient) {
  app.use(express.static(clientDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

const PORT = parseInt(process.env.PORT || '3000', 10)
app.listen(PORT, () => {
  console.log(`Marcybot API http://localhost:${PORT} (POST /api/chat)`)
  if (serveClient) {
    console.log(`Serving client from ${clientDist}`)
  }
  console.log(
    `CHAT_MAX_MESSAGES=${CHAT_MAX_MESSAGES} chat=${CHAT_MODEL} comprehension=${COMPREHENSION_MODEL} RAG_TOP_K=${RAG_TOP_K} RAG=${process.env.DATABASE_URL ? 'on' : 'off'}`,
  )
})
