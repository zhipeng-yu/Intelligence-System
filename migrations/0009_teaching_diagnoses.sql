CREATE TABLE teaching_diagnoses (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN ('homework', 'attendance', 'refund_complaint')),
  anomaly_fact TEXT NOT NULL CHECK (length(anomaly_fact) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  messages_json TEXT NOT NULL DEFAULT '[]'
    CHECK (length(messages_json) <= 60000 AND json_valid(messages_json) AND json_type(messages_json) = 'array'),
  turn_count INTEGER NOT NULL DEFAULT 0 CHECK (turn_count BETWEEN 0 AND 12),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  problem TEXT NOT NULL DEFAULT '' CHECK (length(problem) <= 1200),
  evidence_json TEXT NOT NULL DEFAULT '[]'
    CHECK (length(evidence_json) <= 5000 AND json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  judgment TEXT NOT NULL DEFAULT '' CHECK (length(judgment) <= 2000),
  uncertainty TEXT NOT NULL DEFAULT '' CHECK (length(uncertainty) <= 1200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (status = 'active' AND completed_at IS NULL AND problem = '' AND judgment = '')
    OR (status = 'completed' AND completed_at IS NOT NULL AND length(problem) > 0
      AND length(judgment) > 0 AND json_array_length(evidence_json) > 0)
  )
) STRICT;

CREATE INDEX teaching_diagnoses_user_status_updated
ON teaching_diagnoses (user_id, status, updated_at DESC, id DESC);
