/**
 * Chat API for Marcybot. Loads repo-root .env + metaprompt from ./metaprompt.md.
 * POST /api/chat — Socratic JSON reply (answer + move + rationale).
 * Optional body.previousAssistantMove: prior turn's move from last response.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import express from 'express'
import OpenAI from 'openai'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const rawCap = parseInt(process.env.CHAT_MAX_MESSAGES ?? '16', 10)
const CHAT_MAX_MESSAGES =
  Number.isFinite(rawCap) && rawCap > 0 ? Math.min(rawCap, 100) : 16

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'

/** Same union as client `AssistantKind`; JSON field remains `move`. */
const ASSISTANT_KINDS = new Set(['explain', 'check', 'probe', 'prompt'])

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

function systemContentForRequest(previousAssistantMove) {
  let content = metapromptForApi()
  if (
    typeof previousAssistantMove === 'string' &&
    ASSISTANT_KINDS.has(previousAssistantMove)
  ) {
    content += `\n\n## Turn context (from client)\nThe assistant’s previous reply used **move**: \`${previousAssistantMove}\`.`
  }
  return content
}

const app = express()
app.use(express.json({ limit: '256kb' }))

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
      res.status(500).json({ error: 'OPENAI_API_KEY missing in .env' })
      return
    }

    const bodyMessages = req.body?.messages
    if (!Array.isArray(bodyMessages)) {
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

    const system = {
      role: 'system',
      content: systemContentForRequest(previousAssistantMove),
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [system, ...recent],
      response_format: { type: 'json_object' },
    })

    const rawContent = completion.choices[0]?.message?.content ?? ''
    const parsed = parseChatJson(rawContent)

    res.json({
      message: parsed.answer,
      answer: parsed.answer,
      move: parsed.move,
      rationale: parsed.rationale,
      sources: [],
      retrieved_context: '',
    })
  } catch (err) {
    console.error(err)
    const message = err instanceof Error ? err.message : 'chat failed'
    res.status(500).json({ error: message })
  }
})

const PORT = parseInt(process.env.PORT || '3000', 10)
app.listen(PORT, () => {
  console.log(`Marcybot API http://localhost:${PORT} (POST /api/chat)`)
  console.log(`CHAT_MAX_MESSAGES=${CHAT_MAX_MESSAGES} model=${MODEL}`)
})
