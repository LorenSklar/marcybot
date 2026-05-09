# Ingestion

One-time (or perhaps occasional) Python job that reads the Marcy curriculum markdown, chunks it, embeds it, and writes vectors into Supabase Postgres. Runs locally. Not part of the Express server.

---

## Quick start

```bash
cd ingestion
cp ../.env.example ../.env   # repo-root .env + add your keys
python ingest.py
```

Optional: `python verify.py` — confirms `public.curriculum` exists, prints columns, row count, and one sample row if any.

---

## Prerequisites

- Python 3.10+
- Repo-root `.env` with `DATABASE_URL` (Postgres pool URI from Supabase → Connect), `OPENAI_API_KEY`, and `DOCS_PATH` if the curriculum clone is not in the default location (see `.env.example`).

---

## Step by step

### 1. Install dependencies

```bash
cd ingestion
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Curriculum docs

If `marcy-curriculum-docs` is not already under the marcybot repo, clone it (sibling example):

```bash
cd ..
git clone https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs.git
```

Set `DOCS_PATH` in `.env` if the clone lives somewhere else (paths are relative to the marcybot repo root unless absolute).

### 3. Configure environment

From the **marcybot repo root**:

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `OPENAI_API_KEY`, and `DOCS_PATH` as needed.

### 4. Run ingestion

```bash
cd ingestion
python ingest.py
```

Walks `DOCS_PATH`, chunks by `##` headers (via LangChain), embeds with `text-embedding-3-small`, and loads rows into the **`curriculum`** table.

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

Embedding the full Marcy curriculum with `text-embedding-3-small` runs well under one dollar at typical OpenAI pricing. Confirm current rates before using script.

---

## Troubleshooting
- **`FATAL: password authentication failed for user "postgres"`**  
  The **database password** inside `DATABASE_URL` is wrong or stale. Supabase → **Database** → **Settings** → reset database password, then put the **new** password into the URI (and URL-encode special characters if needed). Copy the URI mode (transaction pooler vs direct) from **Connect** so user/host/port match.

- **`connection refused` / timeouts**  
  Wrong host or port in `DATABASE_URL`, VPN/firewall, or project paused. Re-copy the connection string from **Connect**.

- **`relation "curriculum" does not exist`**  
  Run `python ingest.py` once (it creates the table if missing) or run `db/schema.sql` in the SQL Editor.

- **`vector` / dimension errors**  
  Enable the **pgvector** extension (included in `db/schema.sql`). Table column must stay **`vector(1536)`** for `text-embedding-3-small`.

- **No markdown files**  
  Clone the curriculum repo or fix **`DOCS_PATH`**; the script resolves `./marcy-curriculum-docs` and `../marcy-curriculum-docs` when `DOCS_PATH` is unset.
