#!/usr/bin/env python3
"""
Marcy Docs ingestion — skeleton entrypoint.

Next: glob *.md under DOCS_PATH, chunk, embed via OpenAI, upsert into chunks table.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def main() -> int:
    db_url = os.getenv("DATABASE_URL")
    openai_key = os.getenv("OPENAI_API_KEY")
    docs_path = os.getenv("DOCS_PATH", "../marcy-curriculum-docs")

    missing = []
    if not db_url:
        missing.append("DATABASE_URL")
    if not openai_key:
        missing.append("OPENAI_API_KEY")
    if missing:
        print("Set these in ingestion/.env (see example.env):", ", ".join(missing))
        return 1

    root = Path(docs_path).resolve()
    if not root.is_dir():
        print(f"DOCS_PATH is not a directory: {root}")
        print("Clone: git clone https://github.com/The-Marcy-Lab-School/marcy-curriculum-docs.git")
        return 1

    md_files = list(root.rglob("*.md"))
    print(f"Found {len(md_files)} markdown files under {root}")
    if not md_files:
        print("No .md files — check DOCS_PATH points at the curriculum repo root.")
        return 1

    print("Env OK. Implement: chunk → embed → INSERT/upsert into Supabase chunks table.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
