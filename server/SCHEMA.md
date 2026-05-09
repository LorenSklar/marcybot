# API Schema

## `POST /chat`

### Request

```typescript
{
  message: string;              // Current student input
  history: Message[];           // Last n turns of conversation (see below)
  retrieved_context?: string;   // RAG chunks returned from previous /chat turn — pass back for continuity
}
```

### Message

```typescript
{
  role: "user" | "assistant";
  content: string;
}
```

### Response

```typescript
{
  answer: string;               // Socratic response grounded in curriculum
  sources: Source[];            // Curriculum chunks that informed the answer
  retrieved_context: string;    // RAG chunks used this turn — client stores and passes back next request
}
```

### Source

```typescript
{
  title: string;                // Section heading from curriculum
  
  url: string;                  // Link to source doc in Marcy GitHub repo
}
```

### Example Request

```json
{
  "message": "What is a closure?",
  "history": [
    { "role": "user", "content": "I think scope means where a variable lives?" },
    { "role": "assistant", "content": "That's a good start. What do you think happens to that variable when the function that created it finishes running?" }
  ],
  "retrieved_context": "...chunks from previous turn..."
}
```

### Example Response

```json
{
  "answer": "Good question. Before we define it, what do you think happens when a function returns — does it take its variables with it?",
  "sources": [
    {
      "title": "Scope and Closures",
      "url": "https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs/blob/main/mod-2/closures.md"
    }
  ],
  "retrieved_context": "...chunks used this turn, client passes back on next request..."
}
```

---

## `POST /classify`

### Request

```typescript
{
  history: Message[];           // Full conversation to classify (same Message type as above)
}
```

### Response

```typescript
{
  move: "extend" | "build" | "backup";
  rationale: string;            // One sentence explanation of the classification
}
```

### Example Request

```json
{
  "history": [
    { "role": "user", "content": "Oh so the inner function remembers the outer function's variables even after it returns?" },
    { "role": "assistant", "content": "Exactly. That's a closure. Can you think of a situation where that would be useful?" },
    { "role": "user", "content": "Maybe like a counter that keeps its own count?" }
  ]
}
```

### Example Response

```json
{
  "move": "extend",
  "rationale": "Student correctly identified the mechanism and generated an original use case unprompted."
}
```

---

## History Management

The client is responsible for maintaining conversation history and passing the last `n` turns with each request. The server is stateless.

**Recommended:** pass the last 6 turns (3 exchanges). More context improves classification accuracy but increases token cost.

---

## Roadmap

### Context Compression
Currently the client passes raw conversation history. For longer sessions this will exceed the token budget. Planned: server-side context compression that summarizes older turns into a single context block, preserving meaning while reducing token cost. The client API contract stays the same — compression happens transparently server-side.