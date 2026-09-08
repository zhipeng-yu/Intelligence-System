-- Preserve all legacy row IDs and stable IDs; unresolved input never occupies account_id.
CREATE TABLE watched_accounts_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT CHECK (account_id IS NULL OR (
    length(account_id) = 24 AND account_id NOT GLOB '*[^0-9a-f]*'
  )),
  created_at TEXT NOT NULL,
  red_id TEXT CHECK (red_id IS NULL OR (
    length(red_id) BETWEEN 1 AND 64 AND red_id NOT GLOB '*[^A-Za-z0-9_-]*'
  )),
  nickname TEXT NOT NULL DEFAULT '' CHECK (length(nickname) <= 100),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('queued', 'running', 'ready', 'failed', 'blocked')),
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'not_found', 'ambiguous', 'number_mismatch', 'identity_mismatch',
    'page_unavailable', 'duplicate', 'security_blocked', 'lease_expired'
  )),
  lease_expires_at TEXT,
  claim_token_hash TEXT CHECK (claim_token_hash IS NULL OR length(claim_token_hash) = 64),
  result_payload_hash TEXT CHECK (result_payload_hash IS NULL OR length(result_payload_hash) = 64),
  CHECK ((status = 'ready' AND account_id IS NOT NULL) OR
         (status <> 'ready' AND account_id IS NULL AND red_id IS NOT NULL)),
  UNIQUE (user_id, account_id),
  UNIQUE (user_id, red_id)
) STRICT;

INSERT INTO watched_accounts_v2 (id, user_id, account_id, created_at)
SELECT id, user_id, account_id, created_at FROM watched_accounts;
DROP TABLE watched_accounts;
ALTER TABLE watched_accounts_v2 RENAME TO watched_accounts;
CREATE INDEX watched_accounts_user_created ON watched_accounts (user_id, created_at, id);
CREATE INDEX watched_accounts_queue ON watched_accounts (status, created_at, id);
CREATE UNIQUE INDEX watched_accounts_one_running ON watched_accounts (status) WHERE status = 'running';

-- Aggregate admission counts survive deletion; retain only the current day.
CREATE TABLE network_account_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  PRIMARY KEY (user_id, day)
) STRICT;

CREATE TRIGGER watched_accounts_admission BEFORE INSERT ON watched_accounts BEGIN
  SELECT RAISE(ABORT, 'account_slots_full') WHERE
    (SELECT COUNT(*) FROM watched_accounts WHERE user_id = NEW.user_id) >= 3;
  SELECT RAISE(ABORT, 'account_work_active') WHERE NEW.status = 'queued' AND (
    EXISTS (SELECT 1 FROM watched_accounts WHERE user_id = NEW.user_id AND status IN ('queued', 'running')) OR
    EXISTS (SELECT 1 FROM network_search_jobs WHERE user_id = NEW.user_id AND status IN ('queued', 'running'))
  );
  SELECT RAISE(ABORT, 'account_daily_limit') WHERE NEW.status = 'queued' AND (
    COALESCE((SELECT attempts FROM network_account_daily_usage
      WHERE user_id = NEW.user_id AND day = date(NEW.created_at, '+8 hours')), 0) >= 3 OR
    COALESCE((SELECT SUM(attempts) FROM network_account_daily_usage
      WHERE day = date(NEW.created_at, '+8 hours')), 0) >= 20
  );
END;

CREATE TRIGGER watched_accounts_count AFTER INSERT ON watched_accounts
WHEN NEW.status = 'queued' BEGIN
  DELETE FROM network_account_daily_usage WHERE day < date(NEW.created_at, '+8 hours');
  INSERT INTO network_account_daily_usage (user_id, day, attempts)
  VALUES (NEW.user_id, date(NEW.created_at, '+8 hours'), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET attempts = attempts + 1;
END;
