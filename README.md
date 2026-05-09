# KestinBot

KestinBot is an AI-powered study assistant grounded in the Marcy Lab School curriculum. Students ask questions and get answers based on Marcy's own docs rather than Reddit or other generic internet knowledge. Most AI tools stop at the answer. KestinBot doesn't. Every answer is followed by a check for understanding where the student rephrases the concept in their own words. What they write back determines the bot's next move: to extend, build on, or back up to more fundamental skills.

The name is deliberate. Kestin, Miller et al. (2025) ran a randomized controlled trial at Harvard showing that a purpose-built AI tutor outperformed active learning classrooms, not because it was an LLM, but because it was curriculum-specific, adaptive, and tested for transfer. That is the design this app attempts to replicate.

**Live Demo:** [kestinbot.onrender.com](https://marcy-study-assistant.onrender.com)

---

## Why This Exists

Generic AI tools like ChatGPT give generic answers. They don't know that Marcy uses a specific folder structure, specific naming conventions, or specific patterns for Express routes and React components. A student who asks ChatGPT how to structure a controller gets a reasonable answer, just not Marcy's answer.

KestinBot retrieves the most relevant sections of the Marcy Docs before generating any response. The LLM never improvises. It works only from what was retrieved.

After each explanation, the bot asks the student to rephrase the concept in their own words, not copy it back, but explain it like they'd text a friend who missed class. A Harvard randomized controlled trial (Kestin et al., 2025) found that AI tutors outperform active learning classrooms specifically when they test for transfer rather than completion. That check is the transfer test. A student who can rephrase it understood it. A student who can't needs to clarify their understanding or go back to more basic skills.

---

## How It Works

1. Student asks a question
2. The app embeds the query and runs a semantic search against the Marcy Docs vector index
3. The top 5 most relevant chunks are passed to the OpenAI API with a carefully engineered system prompt
4. The model streams back a plain-language explanation grounded in those chunks
5. The bot follows up with a check, asking the student to explain it back
6. The student's reply is classified: **extend**, **build**, or **back up**
7. The next response branches accordingly, with resource chips that unlock based on the branch

---

## Stack

| Layer | Choice |
|-------|--------|
| **Frontend** | React (Vite) |
| **Backend** | Express on Node |
| **Vectors** | Supabase Postgres + pgvector |
| **Streaming** | Server-Sent Events (SSE) |

### Embeddings & LLM

| Role | Provider | Model |
|------|----------|-------|
| **Embeddings** | OpenAI | `text-embedding-3-small` |
| **Generation** | OpenAI | `gpt-4o-mini` |
| **Classification** | OpenAI | `gpt-4o-mini` |

**Environment variables:** `OPENAI_API_KEY`, `DATABASE_URL` (Supabase)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                    │
│     Chat UI — SSE stream in, structured turns out   │
└─────────────────────────┬───────────────────────────┘
                          │ HTTP + SSE
                          ▼
┌─────────────────────────────────────────────────────┐
│              Node / Express API                     │
│   Routes, session state, RAG orchestration,         │
│   SSE stream management                             │
└──────┬──────────────────┬──────────────────┬────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────┐  ┌────────────────┐  ┌──────────────────┐
│ Embed query │  │ Generate answer│  │ Classify reply   │
│ OpenAI API  │  │ OpenAI API     │  │ OpenAI API       │
└──────┬──────┘  └────────┬───────┘  └──────────────────┘
       │                  │
       ▼                  ▼
┌─────────────────────────────────────────────────────┐
│           Postgres + pgvector — Supabase            │
│  Chunks, embeddings, similarity search,             │
│  conversation history, student state                │
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

Renders the chat interface. Sends student messages to the API. Displays streamed assistant content as message bubbles.

**The assistant turn sequence:**

Each explanation is followed by a check. The student's reply to the check determines the next move.

| Bubble label | What it is |
|---|---|
| **Big idea** | The explanation, grounded in retrieved docs |
| **Your turn** | The check, student rephrases in their own words |
| **Let's dig deeper** | A follow-up when the reply needs more signal |
| **What's next?** | Adaptive next step |


**Resource chips** (always available allowing the student to control pace):

- **Read the Docs** — links to the relevant Marcy Docs section
- **Practice Coding** — opens [PickCode](https://pickcode.io) or [CodePen](https://codepen.io) in a new tab
- **Ask a Peer** — a low stakes path to human help

Chips are pacing tools, not gates. A student can skip any chip and keep asking questions. The student controls the pace, that's by design.

**How many checks before branching?**

Default: one check per beat. If the reply is thin or off-target, one follow-up. After two checks without a clear signal, stop and branch. A long check loop feels like an interrogation and tanks trust.

**Contract: UI → API**

```
POST /api/chat
{
  student_id: string,
  conversation_id: string,
  message: string
}
```

**Contract: API → UI (assistant pieces)**

Each assistant message has a `kind` and `text`. A shared `turn_id` groups messages that belong to the same instructional beat.

```ts
type Branch = "extend" | "build" | "back_up";

type ResourceState = "disable" | "show" | "emphasize";

type AssistantKind = "explain" | "check" | "probe" | "prompt";

type TurnMeta = {
  branch: Branch;
  resource_hints: {
    docs: ResourceState;
    coding: ResourceState;
    peer: ResourceState;
  };
};

type AssistantMessage = {
  id: string;               // UUID from Postgres
  turn_id: string;          // groups messages in one beat
  role: "assistant";
  kind: AssistantKind;
  text: string;
  meta?: TurnMeta; 
  created_at: string;
  in_reply_to_message_id?: string | null;
};
```

**Thread model (frontend)**

```ts
type ThreadItem =
  | {
      id: string;
      turn_id: string;
      role: "student";
      content: string;
      created_at: string;
      in_reply_to_message_id?: string | null;
    }
  | AssistantMessage;
```

**On identifiers:**
Persisted rows use UUID primary keys generated by Postgres (`DEFAULT gen_random_uuid()`). The client treats `id` and `turn_id` as opaque strings. For optimistic UI, assign a provisional `crypto.randomUUID()` client-side and replace with the server-returned id after insert.

---

### Layer 2 — API (Node / Express)

Orchestrates the request pipeline. Manages conversation history. Routes the classified reply to the correct branch.

**Contract: API → Embed**

```
Input:  message string
Output: float[1536]  (text-embedding-3-small)
```

**Contract: API → pgvector**

```
Input:  query vector, k = 5
Output: top 5 semantically similar chunk texts
```

**Contract: API → OpenAI (generate)**

```
Input:  system prompt + retrieved chunks + last 6 messages + student message
Output: streamed tokens → forwarded to client as SSE (text/event-stream)
```

**Contract: API → OpenAI (classify)**

```
Input:  student's check reply + conversation context
Output: one of [ "extend" | "build" | "back_up" ]
```

**Contract: API → DB (write)**

```
Per interaction: student_id, conversation_id, message, role,
                 classification result, branch taken, timestamp
```

---

### Layer 3 — LLM Calls (OpenAI)

Three steps per student interaction:

1. **Embed** — student message → vector (OpenAI `text-embedding-3-small`, same model as ingestion)
2. **Generate** — curriculum-grounded explanation (OpenAI `gpt-4o-mini`), streamed token-by-token as SSE
3. **Classify** — branch label from check reply + context (OpenAI `gpt-4o-mini`)

The LLM is stateless. Conversation history is managed by the API and passed explicitly on every call.

---

### Layer 4 — Data (Postgres + pgvector via Supabase)

One database. All data in one place.

| Table | Contents |
|-------|----------|
| `chunks` | id, content, embedding (vector), topic tag |
| `students` | id, created_at |
| `conversations` | id, student_id, started_at |
| `messages` | id (uuid), conversation_id, role, content, classification, branch, timestamp |

**pgvector similarity search:**

```sql
SELECT content FROM chunks
ORDER BY embedding <=> $1
LIMIT 5;
```

`<=>` is the cosine similarity operator provided by the pgvector extension. `$1` is the embedded query vector.

---

### Layer 5 — Ingestion (Python, one-time)

Runs locally. The source material is not in this repo — the script expects a separate clone of [The-Marcy-Lab-School/marcy-curriculum-docs](https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs). See [`ingestion/README.md`](ingestion/README.md) for setup.

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
- Use the classified branch to shape the next response
- Be direct, warm, and non-judgmental

---

## The Three Branches

After a student responds to the check, the app classifies the reply and branches:

| Branch | When | What happens |
|--------|------|--------------|
| **Extend** | Solid rephrasing | Harder material or a practice prompt |
| **Build** | Partial understanding | Same concept, different angle: analogy, example, diagram |
| **Back up** | Missing the foundation | Simpler chunks, prerequisites from the docs |

The classifier reads what the student actually wrote, not a button they clicked. Students don't always know what they don't know, and self-report is unreliable. If a student's tone is confident but their rephrasing is off, the classifier follows the rephrasing.

This design is grounded in Kestin, Miller et al. (2025), a Harvard randomized controlled trial published in Scientific Reports. The study found that AI tutors outperform active learning classrooms when they are curriculum-specific, adaptive, and test for transfer, not just completion. The check is that transfer test.

---

## Tech Decisions

**pgvector over Pinecone:** Marcy's stack is already Postgres. pgvector adds vector similarity search as a native extension. One database, one connection string, nothing extra to manage or pay for, and it's a concept students already have a foundation for.

**Python for ingestion, JavaScript for everything else:** Ingestion is a one-time offline script. Python fits text splitting and batch embedding jobs cleanly. The app stays Node/React, Marcy's teaching stack.

**SSE over WebSockets:** Streaming LLM output is unidirectional, server to client. SSE is simpler, requires no upgrade handshake, and is native to the browser's `EventSource` API. WebSockets add complexity without adding anything here.

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
- Persist classification results, which chunks fired, and which branch was taken on every interaction
- The data is already partially there in the messages table; this version makes it queryable
- Over time, patterns emerge from usage: which questions consistently route to back up, which chunks fire together, where the curriculum has gaps
- This is the foundation everything else in the roadmap depends on. The instructor dashboard is an empty table without it

**v3 — Generated coding challenges**
- When the branch is extend, end the response with a small coding prompt scoped to the concept just covered and the student's apparent level
- No new infrastructure: the challenge is generated by the same model, in the same call, shaped by the same retrieved chunks
- The challenge difficulty comes from what the student demonstrated in their check reply, not from a tag someone assigned at ingestion time

**v4 — Prerequisite mapping**
- Encode the dependency graph of the Marcy curriculum (one-time authoring work)
- When a student routes to back up, surface the prerequisite concept with a direct link to that section of the Marcy Docs
- Example: struggling with `useEffect`, surface `useState` first

**v5 — Video**
- Ingest transcripts from a curated list of Marcy-aligned videos
- Embed transcripts using the same model as the docs
- Compare transcript embeddings against docs embeddings to filter out content that contradicts Marcy's patterns
- Unlock a Watch chip only when a video's content semantically matches the question and aligns with the docs
- More automatable than it sounds but requires someone to maintain the curated video list as the curriculum evolves

**v6 — Claude for generation and classification**
- Swap `gpt-4o-mini` for Anthropic's Claude on the generate and classify calls
- Claude reasons more carefully about partial understanding, deflection, and the difference between confident-sounding and actually-correct student replies
- Requires a second paid API (Anthropic); OpenAI remains for embeddings since `text-embedding-3-small` stays the same model at ingest and query time. Switching embedding providers means re-embedding the entire corpus
- The pedagogical quality difference is real; this is the right upgrade once the app has users and the cost is justified

**v7 — Memory**
- Supabase Auth + OAuth for student identity
- Conversation history persisted per student across sessions
- Running summary passed to the model instead of raw message history to manage context length

**v8 — Instructor dashboard**
- Aggregate classification signals across the cohort
- Surface which concepts are producing the most back up branches as a real-time formative signal
- Only useful once v2 logging is in place and there are enough students to see patterns

**v9 — Ping an instructor**
- When the conversation reveals sustained struggle across multiple back up branches, present a path that lets the student flag a human instructor directly
- Passive signal first visible to instructor dashboard in v8; active ping as opt-in

---

## References

Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). *AI tutoring outperforms in-class active learning: an RCT introducing a novel research-based design in an authentic educational setting.* Scientific Reports, 15, 17458. https://doi.org/10.1038/s41598-025-97652-6

---

## License

MIT