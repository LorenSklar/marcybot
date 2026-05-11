# KestinBot

KestinBot is an AI-powered study assistant grounded in the Marcy Lab School curriculum. Students ask questions and get answers based on Marcy's own docs rather than Reddit or other generic internet knowledge. Most AI tools stop at the answer. KestinBot doesn't. The design pushes toward **transfer**: after an explanation, the student is nudged to rephrase in their own words, and the tutor adapts based on what they actually wrote.

The name is deliberate. Kestin, Miller et al. (2025) ran a randomized controlled trial at Harvard showing that a purpose-built AI tutor outperformed active learning classrooms, not because it was an LLM, but because it was curriculum-specific, adaptive, and tested for transfer. That is the design this app attempts to replicate.

**Live Demo:** [kestinbot.onrender.com](https://kestinbot.onrender.com)

---

## Why This Exists

Generic AI tools like ChatGPT give generic answers. They don't know that Marcy uses a specific folder structure, specific naming conventions, or specific patterns for Express routes and React components. A student who asks ChatGPT how to structure a controller gets a reasonable answer, just not Marcy's answer.

KestinBot retrieves the most relevant sections of the Marcy Docs before generating any response. The LLM never improvises. It works only from what was retrieved.

After each explanation, the bot asks the student to rephrase the concept in their own words, not copy it back, but explain it like they'd text a friend who missed class. The Kestin study found that AI tutors outperform active learning classrooms specifically when they test for transfer rather than completion. That check is the transfer test. A student who can rephrase it understood it. A student who can't needs to clarify their understanding or go back to more foundational skills.

---

## How It Works

1. Student sends a message; the client posts the recent thread to `POST /api/chat`.
2. The API runs a **comprehension** structured JSON pass on the thread.
3. The API **embeds** retrieval text, runs **pgvector** similarity search, and injects excerpts into the system context.
4. The API calls the chat model once and returns a **JSON** object: assistant prose (`answer`), **`move`**, optional `rationale`, and **source** metadata for retrieved chunks.
5. **Resource chips** in the UI are shortcuts to the Marcy docs (Read) or an in browser IDE (Practice) to encourage fellows to absorb the information using different modalities.

---

## Stack


| Layer         | Choice                       |
| ------------- | ---------------------------- |
| **Frontend**  | React (Vite)                 |
| **Backend**   | Express on Node              |
| **Vectors**   | Supabase Postgres + pgvector |
| **Transport** | HTTP JSON (`POST /api/chat`) |


### Embeddings & LLM


| Role               | Provider | Model                    |
| ------------------ | -------- | ------------------------ |
| **Embeddings**     | OpenAI   | `text-embedding-3-small` |
| **Generation**     | OpenAI   | `gpt-4o`                 |
| **Comprehension**  | OpenAI   | `gpt-4o-mini`            |


**Environment variables:** `OPENAI_API_KEY`, `DATABASE_URL` (Supabase)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                    │
│     Chat UI — POST thread, JSON assistant reply     │
└─────────────────────────┬───────────────────────────┘
                          │ HTTP JSON
                          ▼
┌─────────────────────────────────────────────────────┐
│              Node / Express API                     │
│   RAG orchestration, comprehension + generate JSON   │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│ OpenAI — comprehension JSON, embeddings (RAG),        │
│ chat completion JSON (`answer` + `move`)             │
└──────────────────────────┬──────────────────────────┘
                           │ similarity search
                           ▼
┌─────────────────────────────────────────────────────┐
│ Postgres + pgvector — `curriculum` chunks            │
│ (conversation persistence — wip)                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│           Python Ingestion (one-time, local)        │
│   Clone marcy-curriculum-docs →                     │
│   header-aware chunk → embed → upsert to Supabase   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                     Render                          │
│   Express web service, auto-deploy on push,         │
│   env vars in dashboard                             │
└─────────────────────────────────────────────────────┘
```

---

## Layers and Contracts

### Layer 1 — UI (React)

Renders the chat interface. The client keeps a **linear list** of messages (`user` | `assistant`), sends the recent thread as JSON on each send, and renders assistant text as **Markdown**. The last assistant **`move`** from the API is echoed on the next request as `previousAssistantMove` so the model knows what beat it just played.

**Resource chips** (dock shortcuts — not yet wired to retrieval or `move`):

- **Read** — opens a configured Marcy Docs URL (default: published curriculum, e.g. Welcome → Course Modules); env: `VITE_MARCY_DOCS_HOME_URL`
- **Practice** — opens a configured practice URL (default: JS Bin JavaScript pane); env: `VITE_PRACTICE_URL`
- **Watch** / **Peer** — visible placeholders, disabled until curated video and peer flows exist

Chips are pacing shortcuts, not gates. A student can ignore them and keep chatting.

**Contract: UI → API** (implemented)

```json
POST /api/chat
{
  "messages": [
    { "role": "user", "content": "string" },
    { "role": "assistant", "content": "string" }
  ],
  "previousAssistantMove": "explain"
}
```

`previousAssistantMove` is optional; omit on the first turn. Values: `explain` | `check` | `probe` | `prompt`.

**Contract: API → UI** (implemented)

```json
{
  "answer": "string",
  "move": "check",
  "rationale": "string",
  "sources": [],
  "retrieved_context": "string"
}
```

The client appends `answer` as the next assistant bubble. `sources` lists retrieved chunks (citations) when RAG ran.

**Thread model (frontend, today):** in-memory React state only; no `student_id` / `conversation_id` on the wire yet. Persisted UUIDs and `turn_id` grouping are roadmap (see v2 / v7).

---

### Layer 2 — API (Node / Express)

Orchestrates each turn: normalize `messages`, run **comprehension**, **retrieve** + format chunks, assemble **system** prompt, call chat completion with **`response_format: json_object`**, return one JSON payload. Does not persist the transcript to Postgres yet (see roadmap).

**Contract: API → Embed**

```
Input:  message string (retrieval text from summary + last user message)
Output: float[1536]  (text-embedding-3-small)
```

**Contract: API → pgvector**

```
Input:  query vector, k = 5 (configurable)
Output: top k rows from `curriculum` (content + source_path + headers)
```

**Contract: API → OpenAI (comprehension)**

```
Input:  recent thread (bounded window)
Output: JSON { historySummary, studentComprehension }
         studentComprehension ∈ { lost, partial, solid, off_topic }
```

**Contract: API → OpenAI (generate)**

```
Input:  system prompt + retrieved excerpts + recent messages
Output: JSON { answer, move, rationale }
         move ∈ { explain, check, probe, prompt }
```

**Contract: API → DB (write)** — roadmap

```
Future: per interaction persistence (student, conversation, message, signals)
```

---

### Layer 3 — LLM Calls (OpenAI)

Per student message (typical path):

1. **Comprehension** — thread → JSON summary + `studentComprehension` (`gpt-4o-mini`, structured output)
2. **Embed** — retrieval text → vector (`text-embedding-3-small`, same model as ingestion)
3. **Generate** — system prompt + excerpts + JSON summary → JSON `answer` + `move` + `rationale` (`gpt-4o`, structured output)

The LLM is stateless. Conversation history is passed explicitly on every call; the client also passes `previousAssistantMove` for continuity.

---

### Layer 4 — Data (Postgres + pgvector via Supabase)

One database. All data in one place.


| Table           | Contents                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| `curriculum`    | id, content, embedding (vector), source_path, header fields (see `db/schema.sql`) |
| `students`      | id, created_at (roadmap / not required for current demo)                      |
| `conversations` | id, student_id, started_at (roadmap)                                         |
| `messages`      | id (uuid), conversation_id, role, content, signals, timestamp (roadmap)     |


**pgvector similarity search:**

```sql
SELECT content FROM curriculum
ORDER BY embedding <=> $1
LIMIT 5;
```

`<=>` is the cosine similarity operator provided by the pgvector extension. `$1` is the embedded query vector.

---

### Layer 5 — Ingestion (Python, one-time)

Runs locally. The source material is not in this repo — the script expects a separate clone of [The-Marcy-Lab-School/marcy-curriculum-docs](https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs). See `[ingestion/README.md](ingestion/README.md)` for setup.

**Chunking:**

- Primary boundaries: Markdown `##` headers (LangChain `MarkdownHeaderTextSplitter`)
- Soft ceiling: ~1000 tokens per chunk, overflow respects paragraph boundaries
- Never splits inside fenced code blocks or numbered sequences
- Overlap: ~one paragraph between adjacent chunks
- Embeddings: OpenAI `text-embedding-3-small` — identical model at ingest and query time

```bash
cd ingestion && python ingest.py
```

**Why LangChain only for ingestion?**
The Express RAG path uses direct OpenAI calls with explicit SQL — easier to debug and teach. LangChain's `MarkdownHeaderTextSplitter` is used only in the Python ingestion script because header-first, paragraph-aware chunking with code fence protection is painful to reimplement by hand.

---

## The System Prompt

The most important piece of the application. It tells the model to:

- Answer only from retrieved Marcy Docs content — if the context doesn't cover it, say so
- Explain concepts in plain language, not textbook prose
- Ask the student to rephrase after each explanation — in their own words, not copied back
- Use comprehension + `move` to shape the next response
- Be direct, warm, and non-judgmental

---

## Assistant `move` and comprehension (what ships)

The API does not yet expose **lost / partial / solid** as explicit enums. Those labels remain the **research-facing** vocabulary for how we want to *describe* adaptation and logging (see **v2.1**). Operationally, the model returns **`move`** and the comprehension pass returns **`studentComprehension`**:

| `studentComprehension` | Meaning (rough) |
| ---------------------- | ---------------- |
| **lost**               | Confused or missing prerequisites |
| **partial**            | Some understanding; needs tightening |
| **solid**              | On track |
| **off_topic**          | Tangential to the lesson goal |

| `move`    | Role (high level) |
| --------- | ----------------- |
| **explain** | Teach / clarify from retrieved context |
| **check**   | Ask the student to rephrase or demonstrate understanding |
| **probe**   | Follow up when the reply is thin or unclear |
| **prompt**  | Nudge toward application (e.g. small task, next step) |

**Design target (Kestin et al., 2025):** curriculum-specific tutoring that tests **transfer**, not only completion.

---

## Tech Decisions

**pgvector over Pinecone:** Marcy's stack is already Postgres. pgvector adds vector similarity search as a native extension. One database, one connection string, nothing extra to manage or pay for, and it's a concept students already have a foundation for.

**Python for ingestion, JavaScript for everything else:** Ingestion is a one-time offline script. Python fits text splitting and batch embedding jobs cleanly. The app stays Node/React, Marcy's teaching stack.

**JSON response today; SSE later:** The chat completion is consumed as a single JSON object per turn. **Server-Sent Events** (or chunked streaming) would let tokens appear incrementally in the UI; that is independent of **auth** or TLS. When we add streaming, it will still be the same `POST /api/chat` contract from the client’s perspective unless we deliberately split endpoints.

**OpenAI for everything:** Embeddings, generation, and classification all use the OpenAI API. One SDK, one API key, one bill. `gpt-4o-mini` is fast and cheap for a proof-of-concept. Claude (Anthropic) offers meaningfully better pedagogical reasoning and is the upgrade path in the roadmap, but consolidating on OpenAI removes a dependency and keeps the architecture simple to explain and debug.

**No video chip at launch:** A "Watch a Video" chip that links to arbitrary YouTube content would undermine the docs-grounded ethos of the app. The right version, ingest transcripts from a curated video list, embed them, surface videos whose content semantically matches the question and aligns with the docs, is in the roadmap.

---

## Local Setup

### Prerequisites

- Node.js v18+
- Python 3.10+
- Supabase account (free tier) with pgvector enabled
- OpenAI API key

### 1. Clone the repo

```bash
git clone https://github.com/your-username/kestinbot
cd kestinbot
```

### 2. Install dependencies

```bash
npm install
pip install -r ingestion/requirements.txt
```

### 3. Environment variables

```bash
cp .env.example .env
```

```
DATABASE_URL=your_supabase_pooler_connection_string
OPENAI_API_KEY=your_key
```

Use Supabase's connection pooler URI — not the direct DB URL — especially on Render and other hosted runtimes.

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Run ingestion

```bash
cd ingestion
python ingest.py
```

### 6. Start the app

```bash
npm run dev
```

Visit `http://localhost:5173`

---

## Deployment

- **Render** — Express web service linked to this GitHub repo; auto-deploys on push to the tracked branch
- **Environment variables** — set in the Render dashboard; never commit secrets
- **Supabase** — free tier Postgres + pgvector; use the pooler connection string for the Node service
- **Frontend** — Vite build served by Express static middleware, or a separate Render static site pointing at the API origin; set `VITE_API_BASE_URL` if split
- **Ingestion** — run locally when curriculum or chunk policy changes; vectors live in Supabase

---

## Roadmap

**v2 — Logging and aggregation**

- Persist `studentComprehension`, `move`, which chunks fired, and (once **v2.1** lands) the **lost / partial / solid / off-topid** label on every interaction
- Over time, patterns emerge from usage: which questions consistently need prerequisite-style routing (**lost** in the research vocabulary), which chunks fire together, where the curriculum has gaps
- This is the foundation everything else in the roadmap depends on. The instructor dashboard is an empty table without it

**Refactor — Default explain → transfer (product shape)**

- **Choreography:** Every tutoring turn aims for **two beats**: a **small explain** (depth scales with `studentComprehension`), then **transfer**—either a **transfer-adjacent check** in chat or a **`prompt`** to code. Not encyclopedia prose; **one bite**, then **apply**.
- **Stretch:** How wide the transfer step is (micro what-if vs open editor) also scales with state; **prompt to code sooner than textbook habits** when the student can carry the load.
- **Today:** Encoded in `server/metaprompt.md` and the `move` enum returned from `/api/chat`. **Next:** Treat the two beats as **first-class** in logging (v2) and optionally in response shape so tuning doesn’t rely on prompt prose alone.

**v2.1 — Metacognition: labels, branches, and resource hints**

- **Bubble labels** in the UI (e.g. Big idea, Your turn, Let’s dig deeper, What’s next?) so students see *what kind of turn* they’re in
- **Classifier output** aligned with the research framing: explicit **`lost` | `partial` | `solid`** check replies, and `move`, logged alongside the raw signals for instructors
- **Resource hints** optional in the API: which chips to emphasize or defer based on that branch (today chips are static shortcuts)

**v3 — Generated coding challenges**

- When a turn ends with **`prompt`** (or the student is ready for a hands-on beat), include a **small coding task** scoped to the concept just covered and the student’s apparent level
- No new infrastructure: the challenge is generated by the same model, in the same call, shaped by the same retrieved chunks
- The challenge difficulty comes from what the student demonstrated in their check reply, not from a tag someone assigned at ingestion time

**v4 — Prerequisite mapping**

- Encode the dependency graph of the Marcy curriculum (one-time authoring work)
- When a student routes to **lost**, surface the prerequisite concept with a direct link to that section of the Marcy Docs
- Example: struggling with `useEffect`, surface `useState` first

**v5 — Video**

- Ingest transcripts from a curated list of Marcy-aligned videos
- Embed transcripts using the same model as the docs
- Compare transcript embeddings against docs embeddings to filter out content that contradicts Marcy's patterns
- Unlock a Watch chip only when a video's content semantically matches the question and aligns with the docs
- More automatable than it sounds but requires someone to maintain the curated video list as the curriculum evolves

**v6 — Claude for generation and comprehension**

- Swap `gpt-4o-mini` for Anthropic's Claude on the generate and comprehension passes
- Claude reasons more carefully about partial understanding, deflection, and the difference between confident-sounding and actually-correct student replies
- Requires a second paid API (Anthropic); OpenAI remains for embeddings since `text-embedding-3-small` stays the same model at ingest and query time. Switching embedding providers means re-embedding the entire corpus
- The pedagogical quality difference is real; this is the right upgrade once the app has users and the cost is justified

**v7 — Memory**

- Supabase Auth + OAuth for student identity
- Conversation history persisted per student across sessions
- Running summary passed to the model instead of raw message history to manage context length

**v8 — Instructor dashboard**

- Aggregate classification signals across the cohort
- Surface which concepts are producing the most **lost** branches as a real-time formative signal
- Only useful once v2 logging is in place and there are enough students to see patterns

**v9 — Ping an instructor**

- When the conversation reveals sustained struggle across multiple **lost** branches, present a path that lets the student flag a human instructor directly
- Passive signal first visible to instructor dashboard in v8; active ping as opt-in

---

## References

Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). *AI tutoring outperforms in-class active learning: an RCT introducing a novel research-based design in an authentic educational setting.* Scientific Reports, 15, 17458. [https://doi.org/10.1038/s41598-025-97652-6](https://doi.org/10.1038/s41598-025-97652-6)

---

## License

MIT