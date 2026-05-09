# KestinBot — Server

Express/TypeScript backend for a RAG-powered tutoring chatbot built on the Marcy Lab School curriculum.

## Architecture

```
Client
  │
  ├── POST /chat      → embed query → vector search → generate answer → return answer + sources
  │
  └── POST /classify  → assess comprehension → return teacher move (extend | build | backup)

Supabase (pgvector)   ← stores curriculum chunks + embeddings
OpenAI API            ← embeddings (text-embedding-3-small) + chat completions (gpt-4o-mini)
```

## Endpoints

### `POST /chat`

Takes a student question and conversation history. Embeds the query, retrieves relevant curriculum chunks via vector similarity search, generates a Socratic response grounded in the curriculum.

**Request**
```json
{
  "message": "What is a closure?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response**
```json
{
  "answer": "Let's think about this together. What happens to a variable when a function finishes running?",
  "sources": [
    {
      "title": "Scope and Closures",
      "url": "https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs/..."
    }
  ]
}
```

### `POST /classify`

Takes conversation history and returns the implied next teacher move based on the student's demonstrated comprehension.

**Request**
```json
{
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response**
```json
{
  "move": "build",
  "rationale": "Student correctly identified the concept but has not applied it yet."
}
```

**Teacher moves**
| Move | Meaning |
|------|---------|
| `extend` | Student has demonstrated understanding — push to harder material |
| `build` | Student is on track — reinforce and deepen current concept |
| `backup` | Student is lost — step back to prerequisite concept |

## Pedagogy

The system prompt is grounded in Kestin & Miller's (2024) finding that AI tutoring works best when it:
- Never gives the answer directly but scaffolds toward it with questions that point out gaps in understanding
- Identifies and corrects misconceptions explicitly
- Maintains a low-judgment tone so students feel safe being wrong
- Adapts to the student's demonstrated comprehension each turn

`/classify` implements this by giving the client the next teacher move so the UI can respond accordingly — tightening or loosening the scaffolding dynamically.

## Prerequisites

- Node.js v18+
- Supabase account with pgvector enabled and curriculum ingested (see `/ingestion/README.md`)
- OpenAI API key 

## Setup

```bash
cd server
npm install
cp .env.example .env
# fill in your keys
npm run dev
```

**.env.example**
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your-anon-key
OPENAI_API_KEY=sk-...
PORT=8080
```

## Design Decisions

**`text-embedding-3-small`** — cheap, fast, sufficient for curriculum-scale RAG. Cost per query is negligible.

**`gpt-4o-mini`** — strong enough for Socratic tutoring at low cost. Swap to `gpt-4o` if response quality needs improvement.

**Embedding happens server-side** — the client never sees raw vectors. `/chat` handles embed → retrieve → generate internally.

**Sources returned with every answer** — students and instructors can verify answers against the actual curriculum. Builds trust and supports learning.

## Planned Features

- Topic classification to open the right coding environment or vetted resource in the browser
- Streaming responses for better perceived performance