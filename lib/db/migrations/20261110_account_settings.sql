-- Additive, rerunnable Account Settings migration. No existing rows are
-- updated or removed. Apply to development only unless publishing is approved.
-- Kept separate from drizzle-kit push's existing composite-index conflict.
BEGIN;
ALTER TABLE stillroom_media_assets ADD COLUMN IF NOT EXISTS upload_object_path text;
ALTER TABLE stillroom_media_assets ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz;
CREATE TABLE IF NOT EXISTS stillroom_account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL CONSTRAINT stillroom_account_deletions_subject_hash_unique UNIQUE,
  user_id text,
  receipt_hash text NOT NULL CONSTRAINT stillroom_account_deletions_receipt_hash_unique UNIQUE,
  application_data_removed boolean NOT NULL DEFAULT false,
  authentication_removed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS stillroom_deletion_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_id uuid NOT NULL REFERENCES stillroom_account_deletions(id) ON DELETE CASCADE,
  object_path text NOT NULL,
  not_before timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stillroom_account_request_limits (
  subject_hash text NOT NULL,
  action text NOT NULL,
  "window" timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (subject_hash,action,"window")
);
CREATE INDEX IF NOT EXISTS stillroom_deletion_due_idx ON stillroom_account_deletions(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS stillroom_deletion_media_job_idx ON stillroom_deletion_media(deletion_id);
COMMIT;
