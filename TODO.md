# KestinBot — working slice checklist

Goal: vertical slice today → user testing → revise.

## Structure

- [x] `client/` — React (Vite), `/api` proxy → `localhost:3000`
- [ ] `server/` — Express on port 3000
- [x] `ingestion/` — Python (existing)

## Slice 1 — End-to-end RAG + stream

### Database & vectors

- [ ] Migrations: enable `pgvector`; `curriculum` table (or `SUPABASE_INGEST_TABLE`) per `db/schema.sql`
- [ ] Tables for demo persistence (trim if needed): `students`, `conversations`, `messages` per README
- [ ] Verify similarity query: `ORDER BY embedding <=> $1 LIMIT 5`
- [ ] Run ingestion against Marcy docs OR seed minimal chunks for a smoke test

### Server

- [ ] Scaffold `server/` workspace; add to root `package.json` workspaces + scripts
- [ ] `GET /api/health`
- [ ] `POST /api/chat` — embed query → top-k retrieval → OpenAI chat completion **streamed** as SSE
- [ ] Env: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY` (ingest); add `DATABASE_URL` when Express talks to Postgres directly

### Client

- [ ] Chat UI: send message → consume SSE → render streaming assistant reply
- [ ] Use relative `/api/...` in dev (Vite proxy) or `VITE_API_BASE_URL` when split

## Slice 2 — Pedagogy (after stream works)

- [ ] Assistant turn sequence: explain → check (“your turn”) → classify student reply
- [ ] Classifier: `extend` | `build` | `back_up` (OpenAI or structured output)
- [ ] Payload shape: `turn_id`, `kind`, optional `meta` / resource hints per README
- [ ] UI: bubble labels (Big idea, Your turn, etc.) + resource chips

## Polish / credibility

- [ ] Error states (API down, empty retrieval, rate limits)
- [ ] Basic logging: chunks used, branch taken (README v2 direction)
- [ ] README: local run steps match monorepo (`client` + `server`)

## Deferred / roadmap

- Instructor dashboard, auth, Claude swap, video chip — README roadmap; not required for first slice.
