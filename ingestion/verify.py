#!/usr/bin/env python3
"""
Verify that public.curriculum exists and optionally show column list + row count (+ one sample row).

Uses repo-root .env: DATABASE_URL only (Postgres / Supabase pool URI).
"""

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

_repo_root = Path(__file__).resolve().parent.parent
load_dotenv(_repo_root / ".env")


def main() -> int:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        print("Missing DATABASE_URL in repo-root .env")
        return 1

    try:
        with psycopg.connect(db_url, connect_timeout=15, prepare_threshold=None) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT EXISTS (
                      SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = 'curriculum'
                    )
                    """
                )
                if not cur.fetchone()[0]:
                    print('Table public.curriculum does not exist.')
                    print('HINT: run python ingest.py once, or run db/schema.sql in the SQL Editor.')
                    return 1

                cur.execute(
                    """
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'curriculum'
                    ORDER BY ordinal_position
                    """
                )
                cols = cur.fetchall()
                print("OK: public.curriculum exists.")
                print("Columns:")
                for name, dtype in cols:
                    print(f"  {name}: {dtype}")

                cur.execute("SELECT count(*) FROM curriculum")
                n = cur.fetchone()[0]
                print(f"Row count: {n}")

                if n > 0:
                    cur.execute(
                        """
                        SELECT id, left(content, 80), source_path, header_1, header_2
                        FROM curriculum
                        LIMIT 1
                        """
                    )
                    row = cur.fetchone()
                    print("Sample row (first):")
                    print(f"  id={row[0]}")
                    print(f"  content[:80]={row[1]!r}…")
                    print(f"  source_path={row[2]!r}")
                    print(f"  header_1={row[3]!r}")
                    print(f"  header_2={row[4]!r}")
                else:
                    print("No rows yet — run python ingest.py to load curriculum.")

    except Exception as e:
        print("Verify failed:", e)
        print(
            "HINT: password authentication failed → wrong database password in DATABASE_URL "
            "(Supabase → Database → Settings → reset password, update URI)."
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
