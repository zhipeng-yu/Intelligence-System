DROP INDEX IF EXISTS documents_visible_uploaded_at;
ALTER TABLE documents RENAME TO documents_v1;

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  category TEXT CHECK (category IS NULL OR category IN ('学校信息', '教学进度', '试卷资料', '家长与情报', '活动与产品')),
  scope TEXT CHECK (scope IS NULL OR length(scope) BETWEEN 1 AND 100),
  ai_status TEXT NOT NULL DEFAULT 'not_started' CHECK (ai_status IN ('not_started', 'processing', 'completed', 'failed')),
  ai_error TEXT CHECK (ai_error IS NULL OR length(ai_error) <= 200),
  analyzed_at TEXT,
  auto_analyzed INTEGER NOT NULL DEFAULT 0 CHECK (auto_analyzed IN (0, 1)),
  network_hash TEXT CHECK (network_hash IS NULL OR length(network_hash) = 64),
  uploaded_at TEXT NOT NULL,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  deleted_at TEXT
) STRICT;

INSERT INTO documents (
  id, title, note, category, scope, ai_status, ai_error, analyzed_at,
  auto_analyzed, network_hash, uploaded_at, original_name, object_key,
  mime_type, size_bytes, deleted_at
)
SELECT
  id, title, NULL, category, scope, 'not_started', NULL, NULL,
  0, NULL, uploaded_at, original_name, object_key,
  mime_type, size_bytes, deleted_at
FROM documents_v1;

DROP TABLE documents_v1;

CREATE INDEX documents_visible_uploaded_at
ON documents (uploaded_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX documents_upload_rate
ON documents (network_hash, uploaded_at DESC)
WHERE network_hash IS NOT NULL;

CREATE TABLE profile_sections (
  section_key TEXT PRIMARY KEY CHECK (section_key IN (
    'school_overview', 'calendar_schedule', 'grades_classes', 'teaching_progress',
    'exams', 'teaching_focus', 'activities', 'resources'
  )),
  content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 4000),
  source_document_id TEXT REFERENCES documents(id),
  updated_at TEXT,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
) STRICT;

INSERT INTO profile_sections (section_key) VALUES
  ('school_overview'),
  ('calendar_schedule'),
  ('grades_classes'),
  ('teaching_progress'),
  ('exams'),
  ('teaching_focus'),
  ('activities'),
  ('resources');

CREATE TABLE profile_history (
  id TEXT PRIMARY KEY,
  section_key TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) <= 4000),
  source_document_id TEXT REFERENCES documents(id),
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL CHECK (changed_by IN ('ai', 'manual'))
) STRICT;

CREATE INDEX profile_history_section_changed
ON profile_history (section_key, changed_at DESC);
