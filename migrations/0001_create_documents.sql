CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  category TEXT NOT NULL CHECK (category IN ('学校信息', '教学进度', '试卷资料', '家长与情报', '活动与产品')),
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT '待确认' CHECK (status IN ('待确认', '已确认')),
  uploaded_by TEXT NOT NULL CHECK (uploaded_by IN ('人员1（我）', '人员2（上级）')),
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

CREATE INDEX IF NOT EXISTS documents_visible_uploaded_at
ON documents (uploaded_at DESC)
WHERE deleted_at IS NULL;
