#!/usr/bin/env python3
"""
Marcy curriculum ingestion: markdown under DOCS_PATH → chunks → OpenAI embeddings → Postgres `curriculum`.

Env (repo-root .env): DATABASE_URL, OPENAI_API_KEY, DOCS_PATH optional (see .env.example).
"""

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from langchain_text_splitters import MarkdownHeaderTextSplitter
from openai import OpenAI

_repo_root = Path(__file__).resolve().parent.parent
load_dotenv(_repo_root / ".env")

# Max texts per OpenAI embeddings request (under API cap; lower if you hit rate limits).
_EMBED_BATCH = 64

CURRICULUM_DDL_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    """
    CREATE TABLE curriculum (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      content text NOT NULL,
      embedding vector(1536) NOT NULL,
      source_path text NOT NULL,
      header_1 text,
      header_2 text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX curriculum_embedding_hnsw_idx
      ON curriculum USING hnsw (embedding vector_cosine_ops)
    """,
    "COMMENT ON TABLE curriculum IS 'Marcy curriculum chunks; text-embedding-3-small, 1536 dims'",
    "COMMENT ON COLUMN curriculum.source_path IS 'Path relative to marcy-curriculum-docs root'",
    "COMMENT ON COLUMN curriculum.header_1 IS 'Nearest H1 title for this chunk (citation)'",
    "COMMENT ON COLUMN curriculum.header_2 IS 'Nearest H2 title for this chunk (citation)'",
]

def curriculum_table_exists(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'curriculum'
            )
            """
        )
        row = cur.fetchone()
    return bool(row and row[0])


def ensure_curriculum_table(db_url: str) -> None:
    # HINT: password errors → reset DB password in Supabase Database → Settings; rebuild URI in .env
    with psycopg.connect(
        db_url, connect_timeout=15, autocommit=True, prepare_threshold=None
    ) as conn:
        if curriculum_table_exists(conn):
            return
        with conn.cursor() as cur:
            for stmt in CURRICULUM_DDL_STATEMENTS:
                cur.execute(stmt)
        print("Table public.curriculum created (+ vector extension, HNSW index, comments).")


def _docs_root() -> Path:
    # Relative paths are from repo root (marcybot/), not from ingestion/.
    raw = os.getenv("DOCS_PATH", "").strip()
    if raw:
        p = Path(raw)
        return p.resolve() if p.is_absolute() else (_repo_root / p).resolve()

    in_repo = (_repo_root / "marcy-curriculum-docs").resolve()
    sibling = (_repo_root.parent / "marcy-curriculum-docs").resolve()
    if in_repo.is_dir():
        return in_repo
    if sibling.is_dir():
        return sibling
    return in_repo


def _split_markdown(text: str):
    splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=[
            ("#", "Header 1"),
            ("##", "Header 2"),
        ],
        strip_headers=False,
    )
    return splitter.split_text(text)


def _embedding_vectors(client: OpenAI, texts: list[str]) -> list[list[float]]:
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts,
    )
    ordered = sorted(resp.data, key=lambda d: d.index)
    return [item.embedding for item in ordered]


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in values) + "]"


def ingest_files(db_url: str, client: OpenAI, docs_root: Path, md_paths: list[Path]) -> None:
    # HINT: transaction pooler + prepared statements → FATAL / weird errors → prepare_threshold=None on connect (set below)
    insert_sql = """
        INSERT INTO curriculum (content, embedding, source_path, header_1, header_2)
        VALUES (%s, %s::vector, %s, %s, %s)
    """

    with psycopg.connect(db_url, connect_timeout=60, prepare_threshold=None) as conn:
        conn.autocommit = False
        for md_path in md_paths:
            rel = md_path.relative_to(docs_root).as_posix()
            text = md_path.read_text(encoding="utf-8", errors="replace")
            docs = _split_markdown(text)
            rows = []
            for d in docs:
                body = (d.page_content or "").strip()
                if not body:
                    continue
                meta = d.metadata or {}
                h1 = meta.get("Header 1")
                h2 = meta.get("Header 2")
                rows.append((body, h1, h2))

            if not rows:
                print(f"  skip (no chunks): {rel}")
                continue

            bodies = [r[0] for r in rows]
            all_embeddings: list[list[float]] = []
            for i in range(0, len(bodies), _EMBED_BATCH):
                batch = bodies[i : i + _EMBED_BATCH]
                all_embeddings.extend(_embedding_vectors(client, batch))

            with conn.cursor() as cur:
                cur.execute("DELETE FROM curriculum WHERE source_path = %s", (rel,))
                for (body, h1, h2), emb in zip(rows, all_embeddings, strict=True):
                    cur.execute(
                        insert_sql,
                        (body, _vector_literal(emb), rel, h1, h2),
                    )
            conn.commit()
            print(f"  ingested {len(rows)} chunks: {rel}")


def main() -> int:
    # --- DATABASE_URL ---
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        print("Missing DATABASE_URL in repo-root .env — Supabase → Connect → transaction pooler URI + DB password.")
        return 1

    # --- OPENAI_API_KEY ---
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("Missing OPENAI_API_KEY in repo-root .env.")
        return 1

    # --- DOCS_PATH ---
    # If unset: ./marcy-curriculum-docs if present, else ../marcy-curriculum-docs. If set: only that path.
    docs_root = _docs_root()
    if not docs_root.is_dir():
        print(f"DOCS_PATH is not a directory:\n  {docs_root}")
        print(
            "HINT: clone into the marcybot repo folder → DOCS_PATH=marcy-curriculum-docs\n"
            "      git clone https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs.git "
            f"{_repo_root / 'marcy-curriculum-docs'}\n"
            "HINT: or clone next to marcybot → DOCS_PATH=../marcy-curriculum-docs"
        )
        return 1
    md_paths = sorted(docs_root.rglob("*.md"))
    if not md_paths:
        print(f"No .md files under {docs_root}")
        return 1

    try:
        ensure_curriculum_table(db_url)
    except Exception as e:
        print("DDL / connection failed:", e)
        print("HINT: FATAL password authentication failed → wrong DB password in DATABASE_URL (reset in Database → Settings).")
        return 1

    openai_client = OpenAI(api_key=api_key)
    try:
        print(f"Ingesting {len(md_paths)} files from {docs_root} …")
        ingest_files(db_url, openai_client, docs_root, md_paths)
    except Exception as e:
        print("Ingest failed:", e)
        print(
            "HINT: dimension mismatch → table must stay vector(1536) for text-embedding-3-small. "
            "HINT: empty OpenAI list → check network / model name."
        )
        return 1

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
