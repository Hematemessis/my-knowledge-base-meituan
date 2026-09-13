CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE memory_scope AS ENUM ('global', 'project');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE memory_type AS ENUM ('fact', 'preference', 'decision', 'goal', 'workflow', 'episode');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE memory_status AS ENUM ('pending', 'active', 'superseded', 'rejected', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE candidate_status AS ENUM ('pending', 'accepted', 'rejected', 'merged');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'local-user',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO projects (id, title, description)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Knowledge Context V2',
  '个人上下文引擎的默认项目'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'local-user',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  actor text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_project_created_idx
  ON events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_kind_created_idx
  ON events(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'local-user',
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scope memory_scope NOT NULL,
  type memory_type NOT NULL,
  subject text NOT NULL DEFAULT '',
  statement text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  importance integer NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  status candidate_status NOT NULL DEFAULT 'pending',
  decision_reason text NOT NULL DEFAULT '',
  review_action text,
  target_memory_id uuid,
  result_memory_id uuid,
  review_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  result_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS memory_candidates_status_idx
  ON memory_candidates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_candidates_result_memory_idx
  ON memory_candidates(result_memory_id);

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'local-user',
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  scope memory_scope NOT NULL,
  type memory_type NOT NULL,
  subject text NOT NULL DEFAULT '',
  statement text NOT NULL,
  status memory_status NOT NULL DEFAULT 'active',
  importance integer NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  dedupe_key text,
  source_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  supersedes_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  embedding vector(1024),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(subject, '') || ' ' || statement)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE memory_candidates
    ADD CONSTRAINT memory_candidates_target_memory_fk
    FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE memory_candidates
    ADD CONSTRAINT memory_candidates_result_memory_fk
    FOREIGN KEY (result_memory_id) REFERENCES memories(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS memories_scope_status_idx
  ON memories(scope, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS memories_project_status_idx
  ON memories(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS memories_search_idx
  ON memories USING gin(search_vector);
CREATE INDEX IF NOT EXISTS memories_statement_trgm_idx
  ON memories USING gin(statement gin_trgm_ops);
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS memory_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  version integer NOT NULL,
  statement text NOT NULL,
  subject text NOT NULL DEFAULT '',
  importance integer NOT NULL DEFAULT 50,
  confidence real NOT NULL DEFAULT 1,
  change_reason text NOT NULL DEFAULT '',
  source_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(memory_id, version)
);

CREATE TABLE IF NOT EXISTS memory_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_memory_id, to_memory_id, relation)
);

CREATE TABLE IF NOT EXISTS project_states (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  goal text NOT NULL DEFAULT '',
  phase text NOT NULL DEFAULT '',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'local-user',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  query text NOT NULL,
  selected_memory_ids uuid[] NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_budget integer NOT NULL,
  estimated_tokens integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  context_snapshot_id uuid REFERENCES context_snapshots(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  score real NOT NULL,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'local-user',
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status job_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_poll_idx
  ON jobs(status, available_at, created_at);
