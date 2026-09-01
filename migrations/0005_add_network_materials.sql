CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone_hmac TEXT NOT NULL UNIQUE CHECK (length(phone_hmac) = 64),
  phone_last4 TEXT NOT NULL CHECK (phone_last4 GLOB '[0-9][0-9][0-9][0-9]'),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 100),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_user_expires
ON sessions (user_id, expires_at);

CREATE TABLE watched_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL CHECK (
    length(account_id) = 24 AND account_id NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, account_id)
) STRICT;

CREATE INDEX watched_accounts_user_created
ON watched_accounts (user_id, created_at, id);

CREATE TABLE network_search_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keywords_json TEXT NOT NULL CHECK (json_valid(keywords_json)),
  accounts_json TEXT NOT NULL CHECK (json_valid(accounts_json)),
  days INTEGER NOT NULL CHECK (days IN (1, 3, 7)),
  window_start_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'completed', 'partial', 'blocked', 'failed'
  )),
  claimed_at TEXT,
  lease_expires_at TEXT,
  claim_token_hash TEXT CHECK (claim_token_hash IS NULL OR length(claim_token_hash) = 64),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at TEXT,
  error_detail TEXT CHECK (error_detail IS NULL OR length(error_detail) <= 500),
  failures_json TEXT CHECK (failures_json IS NULL OR json_valid(failures_json)),
  result_payload_hash TEXT CHECK (result_payload_hash IS NULL OR length(result_payload_hash) = 64),
  result_payload_json TEXT CHECK (result_payload_json IS NULL OR json_valid(result_payload_json))
) STRICT;

CREATE UNIQUE INDEX network_search_one_active_per_user
ON network_search_jobs (user_id)
WHERE status IN ('queued', 'running');

CREATE INDEX network_search_claim_queue
ON network_search_jobs (status, lease_expires_at, created_at, id);

CREATE INDEX network_search_user_created
ON network_search_jobs (user_id, created_at DESC, id DESC);

CREATE TABLE network_search_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES network_search_jobs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL CHECK (
    length(account_id) = 24 AND account_id NOT GLOB '*[^0-9a-f]*'
  ),
  account_name TEXT NOT NULL CHECK (length(account_name) BETWEEN 1 AND 100),
  published_at TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 300),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 100 AND 200),
  UNIQUE (job_id, url)
) STRICT;

CREATE INDEX network_search_results_job_published
ON network_search_results (job_id, published_at DESC, id);
