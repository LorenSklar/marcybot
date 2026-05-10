# API schema — `POST /api/chat`

Stateless chat: the client sends the transcript; the server returns structured JSON. **RAG** adds retrieved text and `sources`. The server may run **multiple model calls** internally; the **HTTP** contract below is what the client sends and receives.

## Logical pipeline (server-side, inside `POST /api/chat`)


| Phase                      | Owns                                            | Notes                                                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Call 1 — comprehension** | `historySummary`, `studentComprehension`        | Input includes full `messages` and optional `previousAssistantMove`. Output is **not** returned to the client unless you add a debug flag later.                                                                                                             |
| **Retrieve**               | Top‑k chunks                                    | Single-stage recall for now. Query text is built from **concise history summary + most recent student message** (aligned with ingest / embedding model).                                                                                                     |
| **Call 3 — answer**        | `answer`, `move` (`AssistantKind`), `rationale` | The model **selects** `move` (via system / metaprompt rules using comprehension, prior move, and retrieved context), **uses** that choice to shape the reply, then **emits** `move` in JSON so the client can send `previousAssistantMove` on the next turn. |


**Continuity:** Call 3 does not “only label” the message after the fact. It **decides** the teaching move, **writes** the user-facing text to match it, and **returns** the same `move` for the next request’s `previousAssistantMove`.

### Call 1 output (internal JSON)

```typescript
{
  historySummary: string;       // Concise; used for retrieval query composition
  studentComprehension: StudentComprehension;
}
```

### `StudentComprehension`

```typescript
type StudentComprehension = "lost" | "partial" | "solid" | "off_topic";
```

- `**lost**` — student is confused or missing prerequisites; answer should ground and simplify.
- `**partial**` — some understanding; tighten or correct, then extend.
- `**solid**` — on track; can go deeper or broaden.
- `off_topic` — respond in kind for one round then redirect gently toward the learning goal when appropriate.

### Model choice for Call 1

Using a **lighter** model for Call 1 is an allowed **implementation choice**: favor **speed / cost** over maximum reasoning depth. If comprehension feels noisy in production, swap or escalate the Call 1 model without changing the HTTP shape.

---

## RAG (embed → retrieve → generate)


| Step                  | Input                                                                                                                                   | Output                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Embed**             | Retrieval query text (from Call 1 summary + latest student message)                                                                     | `float[1536]` via OpenAI `**text-embedding-3-small`** (must match ingest)                         |
| **Retrieve**          | Query vector + `k`                                                                                                                      | Top‑k chunk rows from Postgres / pgvector                                                         |
| **Generate (Call 3)** | System / metaprompt + retrieved chunks + **summary + last assistant + last student** + `studentComprehension` + `previousAssistantMove` | Model JSON: `answer`, `move`, `rationale`; response also includes `sources` / `retrieved_context` |


---

## Pedagogy (what Call 3 sounds like)

- Give a **short, plain-language** explanation or direct answer first—no riddles, no “guess what I’m thinking,” no lecture disguised as questions.
- Then, as appropriate to the chosen `**move`**, **check** understanding, **probe** a gap, or **prompt** a next step—so the student can extend without being stranded.

This is **not** a Socratic-only tutor: the default posture is **clarity first**, then a light interactive follow-up when it helps.

---

## HTTP request

```typescript
{
  messages: Message[];
  previousAssistantMove?: AssistantKind;
}
```

### `Message`

```typescript
{
  role: "user" | "assistant";
  content: string;
}
```

### `AssistantKind` (values for `previousAssistantMove` and response `move`)

```typescript
type AssistantKind = "explain" | "check" | "probe" | "prompt";
```

### Example request

```json
{
  "messages": [
    { "role": "user", "content": "What is a closure?" }
  ]
}
```

---

## HTTP response

```typescript
{
  message: string;              // Same as answer (convenience)
  answer: string;               // Plain language; shaped by emitted move
  move: AssistantKind;          // Chosen in Call 3; echoed for continuity
  rationale: string;            // One sentence; logging / debug
  sources: Source[];            // RAG citations (may be empty)
  retrieved_context: string;   // Chunks injected this turn (may be empty)
}
```

### `Source` (when RAG is on)

```typescript
{
  title: string;
  url: string;                  // Stable link or path to curriculum doc
}
```

### Example response

```json
{
  "message": "A closure is when an inner function still sees variables from the outer function after the outer function finished running.\n\nQuick check: in one sentence, what stays “alive” for `inner` if it uses a variable declared in `outer`?",
  "answer": "A closure is when an inner function still sees variables from the outer function after the outer function finished running.\n\nQuick check: in one sentence, what stays “alive” for `inner` if it uses a variable declared in `outer`?",
  "move": "check",
  "rationale": "Clear definition given; brief check to confirm they can restate the idea.",
  "sources": [],
  "retrieved_context": ""
}
```

---

## History

The client sends enough `**messages**` for context. The server may keep only the last *n* turns (`CHAT_MAX_MESSAGES` in env). Call 1 produces the **summary** used for retrieval; Call 3 should still receive **verbatim last assistant** and **last student** strings for grounding.

---

## Roadmap

- Optional: expose Call 1 fields on the response for debugging or analytics.
- Optional: pass chunk IDs or `retrieved_context` back on the next request for debugging.
- Long-session **context compression** server-side without changing the external shape—TBD.

