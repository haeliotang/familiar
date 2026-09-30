CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS persons (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES sessions(id),
  label text,
  revision integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES persons(id),
  text text NOT NULL,
  cue text NOT NULL CHECK (cue IN ('wait', 'repair', 'general')),
  usable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES sessions(id),
  person_id uuid NOT NULL REFERENCES persons(id),
  kind text NOT NULL CHECK (kind IN ('photo', 'deceased_audio', 'user_memory_audio')),
  speaker_role text NOT NULL CHECK (speaker_role IN ('deceased', 'user', 'none')),
  media_type text NOT NULL,
  expected_bytes integer NOT NULL,
  size_bytes integer,
  sha256 text,
  object_key text,
  state text NOT NULL DEFAULT 'awaiting_upload',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS episodes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES sessions(id),
  person_id uuid NOT NULL REFERENCES persons(id),
  person_revision integer NOT NULL,
  evidence_id uuid REFERENCES evidence(id),
  idempotency_key text NOT NULL,
  manifest jsonb NOT NULL,
  status text NOT NULL DEFAULT 'prototype',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);

ALTER TABLE source_assets ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','confirmed','skipped'));

CREATE TABLE IF NOT EXISTS asset_transcripts (
  asset_id uuid PRIMARY KEY REFERENCES source_assets(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  text text NOT NULL,
  segments jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_asset_id uuid REFERENCES source_assets(id);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'user_memory';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS locator jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_source_text_idx ON evidence(source_asset_id,text);

CREATE INDEX IF NOT EXISTS persons_owner_idx ON persons(owner_id);
CREATE INDEX IF NOT EXISTS episodes_person_idx ON episodes(person_id);
CREATE INDEX IF NOT EXISTS source_assets_person_idx ON source_assets(person_id);

CREATE TABLE IF NOT EXISTS episode_feedback (
  episode_id uuid PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  experience text CHECK (experience IN ('familiar', 'unfamiliar', 'uncertain')),
  issue text CHECK (issue IN ('incorrect_detail', 'unnatural_voice', 'slow_preparation', 'other')),
  comment text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deletion_jobs (
  id uuid PRIMARY KEY,
  person_id uuid NOT NULL UNIQUE REFERENCES persons(id),
  owner_id uuid NOT NULL REFERENCES sessions(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

INSERT INTO deletion_jobs(id,person_id,owner_id)
SELECT id,id,owner_id FROM persons WHERE deleted_at IS NOT NULL
ON CONFLICT(person_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS preparation_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES sessions(id),
  person_id uuid NOT NULL REFERENCES persons(id),
  requested_revision integer NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','completed','failed','cancelled')),
  episode_id uuid REFERENCES episodes(id),
  error_code text,
  attempts integer NOT NULL DEFAULT 0,
  duration_ms integer,
  planner_version text NOT NULL DEFAULT 'memory-cue-template-v4',
  provider_cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS preparation_jobs_queue_idx ON preparation_jobs(created_at) WHERE status='queued';

ALTER TABLE preparation_jobs ADD COLUMN IF NOT EXISTS attempt_metrics jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE preparation_jobs ALTER COLUMN planner_version SET DEFAULT 'memory-cue-template-v4';

CREATE TABLE IF NOT EXISTS asset_audio_observations (
  asset_id uuid PRIMARY KEY REFERENCES source_assets(id) ON DELETE CASCADE,
  observations jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE asset_audio_observations ADD COLUMN IF NOT EXISTS review jsonb;

-- Short rendered lines are committed atomically with their immutable episode.
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS retained_voice_base64 text CHECK (length(retained_voice_base64) <= 2097152);
