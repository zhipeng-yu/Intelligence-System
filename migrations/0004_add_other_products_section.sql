CREATE TABLE profile_sections_v2 (
  section_key TEXT PRIMARY KEY CHECK (section_key IN (
    'school_overview', 'calendar_schedule', 'grades_classes', 'teaching_progress',
    'exams', 'teaching_focus', 'activities', 'resources', 'other_products'
  )),
  content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 4000),
  source_document_id TEXT REFERENCES documents(id),
  updated_at TEXT,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
) STRICT;

INSERT INTO profile_sections_v2 (
  section_key, content, source_document_id, updated_at, locked
)
SELECT section_key, content, source_document_id, updated_at, locked
FROM profile_sections;

INSERT INTO profile_sections_v2 (section_key) VALUES ('other_products');

DROP TABLE profile_sections;
ALTER TABLE profile_sections_v2 RENAME TO profile_sections;
