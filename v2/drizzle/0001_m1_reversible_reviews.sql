ALTER TABLE memory_candidates
  ADD COLUMN IF NOT EXISTS review_action text,
  ADD COLUMN IF NOT EXISTS target_memory_id uuid,
  ADD COLUMN IF NOT EXISTS result_memory_id uuid,
  ADD COLUMN IF NOT EXISTS review_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS result_version integer;

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

CREATE INDEX IF NOT EXISTS memory_candidates_result_memory_idx
  ON memory_candidates(result_memory_id);

ALTER TABLE memory_versions
  ADD COLUMN IF NOT EXISTS importance integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 1;

UPDATE memory_versions AS version
SET importance = memory.importance,
    confidence = memory.confidence
FROM memories AS memory
WHERE version.memory_id = memory.id;
