-- Login files remain on the local worker. No shared-profile migration.
CREATE TABLE network_bindings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  profile_id TEXT NOT NULL UNIQUE CHECK (length(profile_id) = 36),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','waiting','ready','expired','invalid','blocked','unbinding','unbound')),
  created_at TEXT NOT NULL,
  owner_session_hash TEXT,
  public_key TEXT,
  challenge_json TEXT,
  expires_at TEXT,
  lease_request_id TEXT,
  lease_token_hash TEXT,
  lease_expires_at TEXT
) STRICT;
CREATE UNIQUE INDEX network_binding_one_lease ON network_bindings ((1)) WHERE lease_token_hash IS NOT NULL;

CREATE TRIGGER network_binding_disabled AFTER UPDATE OF enabled ON users WHEN NEW.enabled = 0 BEGIN
  UPDATE network_bindings SET status = 'invalid', public_key = NULL, challenge_json = NULL,
    owner_session_hash = NULL, expires_at = NULL WHERE user_id = NEW.id;
END;

CREATE TRIGGER watched_accounts_binding BEFORE INSERT ON watched_accounts WHEN NEW.status = 'queued' BEGIN
  SELECT RAISE(ABORT, 'binding_required') WHERE NOT EXISTS (
    SELECT 1 FROM network_bindings WHERE user_id = NEW.user_id AND status = 'ready' AND lease_token_hash IS NULL
  );
END;

CREATE TRIGGER network_search_binding_block AFTER UPDATE OF status ON network_search_jobs WHEN NEW.status = 'blocked' BEGIN
  UPDATE network_bindings SET status = 'blocked', challenge_json = NULL WHERE user_id = NEW.user_id;
END;
CREATE TRIGGER network_account_binding_block AFTER UPDATE OF status ON watched_accounts WHEN NEW.status = 'blocked' BEGIN
  UPDATE network_bindings SET status = 'blocked', challenge_json = NULL WHERE user_id = NEW.user_id;
END;
