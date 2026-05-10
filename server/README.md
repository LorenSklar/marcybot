# KestinBot — Server

Express (Node) API for the tutoring chatbot. The only chat route is `**POST /api/chat**`. Each request runs an **internal two-call pipeline** (comprehension → retrieval → answer), then returns structured JSON. Normative types, enums, and edge cases live in `**SCHEMA.md`**; this README is the narrative overview.

## What happens on `POST /api/chat`

```
Client
  │
  └── POST /api/chat  (messages + optional previousAssistantMove)
            │
            ├──► Call 1 — comprehension (small system prompt; NOT metaprompt.md)
            │      → historySummary, studentComprehension
            │
            ├──► Retrieve (when DATABASE_URL is set)
            │      Build embed text from historySummary + latest student message,
            │      with the last question emphasized so long threads don’t drown short asks.
            │      → text-embedding-3-small → pgvector top-k → chunks + sources
            │
            └──► Call 3 — answer (full metaprompt.md + injected context)
                   System message includes:
                     • metaprompt (pedagogy, moves, output rules)
                     • Turn context: previousAssistantMove (from client)
                     • Student comprehension: lost | partial | solid | off_topic
                     • Concise history summary + verbatim last assistant + last student
                     • Retrieved curriculum excerpts (if any)
                   → model returns JSON: answer, move, rationale
                   → HTTP response adds sources, retrieved_context
```

The client always gets **one** assistant turn per request. It should echo back `**move`** as `**previousAssistantMove**` on the next call so Call 3 stays coherent.

## Call 1 — comprehension

- **Input:** Trimmed transcript (last *n* turns, `CHAT_MAX_MESSAGES`) plus optional `previousAssistantMove`.
- **Output (internal):** strict JSON with `historySummary` and `studentComprehension`.
- **Prompting:** A **short** system instruction and JSON schema expectation—not `**metaprompt.md`**, which is reserved for Call 3.
- **Model:** Often a **lighter** chat model for speed and cost; you can use the same model as Call 3 if comprehension quality needs it. Controlled via env (e.g. `OPENAI_CALL1_MODEL` alongside `OPENAI_CHAT_MODEL`).

`studentComprehension` is one of: `**lost`**, `**partial**`, `**solid**`, `**off_topic**`. Call 3 uses it to calibrate depth and to choose a fitting `**move**` together with the latest message and prior move. For `**off_topic**`, the metaprompt directs a brief human response, then a gentle bridge back toward the learning goal.

## Retrieval

- **Single-stage** recall: one query embedding, top‑k from `**curriculum`** via pgvector.
- **Query text** combines Call 1’s `**historySummary`** with the **most recent student message**, structured so the **latest question carries the most weight** (so retrieval stays specific, not repetitive mush).
- **Embedding model** matches ingestion (default `**text-embedding-3-small`**; overridable via env). Chunks are injected under `**## Retrieved curriculum excerpts**` in the Call 3 system message. `**sources**` and `**retrieved_context**` on the HTTP response mirror what was injected.

If `DATABASE_URL` is unset or retrieval fails, Call 3 still runs; excerpts are empty and the metaprompt tells the model how to behave without verified doc text.

## Call 3 — answer

- **Uses `metaprompt.md`** (loaded as the base system content).
- **Chooses `move`** (`explain` | `check` | `probe` | `prompt`), **writes `answer`** to match that move, and **returns `move`** for continuity—not a post-hoc label on unrelated prose.
- **Pedagogy:** clarity first—short, plain-language explanation or direct answer; then check, probe, or prompt as appropriate. Not Socratic-only, not “guess what I’m thinking.”

## HTTP request

```json
{
  "messages": [
    { "role": "user", "content": "What is a closure?" }
  ],
  "previousAssistantMove": "explain"
}
```

- `**messages**` — OpenAI-style roles and string `content`.
- `**previousAssistantMove**` — Optional; last response’s `move`.

## HTTP response

```json
{
  "answer": "…",
  "move": "check",
  "rationale": "…",
  "sources": [],
  "retrieved_context": ""
}
```

- `**answer**` — Only user-visible assistant text (no duplicate `message` field).
- `**move**` — This turn’s `AssistantKind`.
- `**rationale**` — One line; logging and debugging.
- `**sources**` — Citation list when RAG returns rows; otherwise empty.
- `**retrieved_context**` — Formatted chunk text injected this turn; may be empty.

Call 1 fields are **not** on the default response; they stay server-internal unless you add a debug or analytics flag later.

## Configuration (repo-root `.env`)


| Variable                 | Role                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | Required.                                                           |
| `OPENAI_CHAT_MODEL`      | Call 3 completion model (default e.g. `gpt-4o-mini`).               |
| `OPENAI_CALL1_MODEL`     | Optional. Call 1 model; falls back to Call 3 model if unset.        |
| `OPENAI_EMBEDDING_MODEL` | Optional. Defaults to `text-embedding-3-small` (must match ingest). |
| `DATABASE_URL`           | Optional. Enables RAG (Postgres + pgvector).                        |
| `RAG_TOP_K`              | Optional. Chunk count (bounded).                                    |
| `CHAT_MAX_MESSAGES`      | Optional. Max transcript turns sent to the models.                  |


## Prerequisites and run

- Node.js 20+ (see root `package.json`).
- Curriculum data and embeddings: `**/ingestion/`** and a populated `**curriculum**` table for RAG.

From repo root:

```bash
npm install
cp .env.example .env
# set OPENAI_API_KEY; add DATABASE_URL for RAG
npm run dev:api
```

From `server/`: `npm install && npm run dev` if the root workspace already installed deps.

## Source files


| File            | Responsibility                                                             |
| --------------- | -------------------------------------------------------------------------- |
| `index.js`      | Handler: Call 1 → embed/retrieve → Call 3; builds system message sections. |
| `rag.js`        | Retrieval query text, embed, search, format chunks and `sources`.          |
| `metaprompt.md` | Call 3 system instructions only.                                           |
| `SCHEMA.md`     | Contract reference (enums, pipeline, HTTP types).                          |


## Roadmap (optional hardening)

- Expose Call 1 output on the response for debugging.
- Two-query retrieval + merge/rerank if single-stage recall plateaus.
- Streaming responses while keeping the same final JSON shape (or SSE follow-up).

