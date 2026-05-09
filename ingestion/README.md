# Ingestion

One-time (or perhaps occassional) Python job that reads the Marcy curriculum markdown, chunks it, embeds it, and writes vectors into Supabase. Runs locally. Not part of the Express server.

---

## Quick start

```bash
cd ingestion
cp example.env .env        # add your keys
python ping.py             # confirm Supabase connection
python verify.py           # confirm pgvector is working
python ingest.py           # embed and load the curriculum
```

---

## Prerequisites

- Python 3.10+
- Supabase project with pgvector enabled and `chunks` table created (see `db/schema.sql`)
- OpenAI API key
- Supabase connection pooler URI

---

## Step by step

### 1. Install dependencies

```bash
cd ingestion
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Clone the curriculum docs

The source material is not in this repo. Clone it as a sibling directory:

```bash
cd ..
git clone https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs.git
```

### 3. Configure environment

```bash
cp example.env .env
```

```env
DATABASE_URL=postgresql://...pooler.supabase.com:6543/postgres?sslmode=require
OPENAI_API_KEY=sk-...
DOCS_PATH=../marcy-curriculum-docs
```

Use the Supabase **connection pooler** URI, not the direct DB URL.

### 4. Confirm your setup

```bash
python ping.py
```

Checks that your `.env` is loaded and Supabase is reachable.

```bash
python verify.py
```

Embeds "hello world" and queries pgvector. If you get a vector back, everything is wired correctly and you're ready to ingest.

### 5. Run ingestion

```bash
python ingest.py
```

Walks `DOCS_PATH`, chunks by `##` headers, embeds with `text-embedding-3-small`, and upserts into the `chunks` table in Supabase.

---

## Chunking spec

| Rule | Detail |
|------|--------|
| **Primary boundary** | Markdown `##` headers |
| **Tool** | LangChain `MarkdownHeaderTextSplitter` |
| **Soft size ceiling** | ~1000 tokens, overflow respects paragraph boundaries |
| **Never split inside** | Fenced code blocks, numbered sequences |
| **Overlap** | ~one paragraph between consecutive chunks |

**Non-negotiable:** `text-embedding-3-small` at ingest and query time must match. If you change the embedding model you must re-embed the entire corpus.

---

## Cost note

Embedding the full Marcy curriculum with `text-embedding-3-small` runs approximately $2-5 one-time at current OpenAI pricing. Verify before quoting in interviews.

---

## Troubleshooting

- **Connection errors:** confirm you are using the pooler URI and that `sslmode=require` is set
- **pgvector errors:** enable the extension in Supabase before running ingestion
- **Empty DOCS_PATH:** the curriculum repo must be cloned separately; this repo does not bundle those files