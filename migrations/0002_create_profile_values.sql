CREATE TABLE IF NOT EXISTS profile_values (
  id TEXT PRIMARY KEY,
  field_key TEXT NOT NULL CHECK (field_key IN (
    'school.type', 'school.campuses', 'school.enrollment_scope', 'school.scale',
    'school.calendar', 'school.schedule', 'grade.student_count', 'grade.class_count',
    'grade.class_types', 'grade.placement', 'grade.differences', 'teaching.textbook',
    'teaching.progress', 'teaching.supplements', 'teaching.class_differences',
    'teaching.difficulties', 'teaching.approach', 'exam.schedule', 'exam.scope',
    'exam.paper_features', 'exam.difficulty', 'exam.frequent_types', 'exam.loss_points',
    'insight.coverage', 'insight.feedback', 'insight.intelligence',
    'insight.sample_boundary', 'product.inventory', 'product.gaps', 'product.fit',
    'product.usage', 'activity.plan', 'activity.participation',
    'activity.completion', 'activity.feedback', 'activity.outcomes'
  )),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT '待确认' CHECK (status IN ('待确认', '已确认', '有冲突', '已过期')),
  document_id TEXT NOT NULL REFERENCES documents(id),
  source_locator TEXT NOT NULL CHECK (length(source_locator) BETWEEN 1 AND 200),
  observed_on TEXT NOT NULL CHECK (length(observed_on) = 10),
  expires_on TEXT NOT NULL CHECK (length(expires_on) = 10),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS profile_values_visible_field
ON profile_values (field_key, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profile_values_active_evidence
ON profile_values (field_key, value, document_id, source_locator, observed_on)
WHERE deleted_at IS NULL;
