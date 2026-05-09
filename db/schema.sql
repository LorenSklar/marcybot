-- KestinBot: pgvector + curriculum vectors (run in Supabase SQL editor)
-- Table name matches default SUPABASE_INGEST_TABLE=curriculum in .env
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS curriculum (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  source_path text NOT NULL,
  header_1 text,
  header_2 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS curriculum_embedding_hnsw_idx
  ON curriculum USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE curriculum IS 'Marcy curriculum chunks; text-embedding-3-small, 1536 dims';
COMMENT ON COLUMN curriculum.source_path IS 'Path relative to marcy-curriculum-docs root';
COMMENT ON COLUMN curriculum.header_1 IS 'Nearest H1 title for this chunk (citation)';
COMMENT ON COLUMN curriculum.header_2 IS 'Nearest H2 title for this chunk (citation)';
