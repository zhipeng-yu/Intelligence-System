ALTER TABLE documents ADD COLUMN undone_at TEXT;

ALTER TABLE profile_history ADD COLUMN change_document_id TEXT REFERENCES documents(id);
ALTER TABLE profile_history ADD COLUMN previous_updated_at TEXT;

-- Existing AI history rows describe the state before a change. The following
-- row (or the current section) identifies the document that made that change.
UPDATE profile_history AS history
SET
  change_document_id = COALESCE(
    (
      SELECT later.source_document_id
      FROM profile_history AS later
      WHERE later.section_key = history.section_key
        AND (
          later.changed_at > history.changed_at
          OR (later.changed_at = history.changed_at AND later.id > history.id)
        )
      ORDER BY later.changed_at, later.id
      LIMIT 1
    ),
    (
      SELECT section.source_document_id
      FROM profile_sections AS section
      WHERE section.section_key = history.section_key
    )
  ),
  previous_updated_at = COALESCE(
    (
      SELECT earlier.changed_at
      FROM profile_history AS earlier
      WHERE earlier.section_key = history.section_key
        AND (
          earlier.changed_at < history.changed_at
          OR (earlier.changed_at = history.changed_at AND earlier.id < history.id)
        )
      ORDER BY earlier.changed_at DESC, earlier.id DESC
      LIMIT 1
    ),
    (
      SELECT COALESCE(document.analyzed_at, document.uploaded_at)
      FROM documents AS document
      WHERE document.id = history.source_document_id
    )
  )
WHERE history.changed_by = 'ai';

-- The old writer skipped history when the previous card was empty. Recreate
-- that first empty state for every inferred document change.
INSERT INTO profile_history (
  id, section_key, content, source_document_id, changed_at, changed_by,
  change_document_id, previous_updated_at
)
SELECT
  lower(hex(randomblob(16))), previous.section_key, '', NULL,
  COALESCE(document.analyzed_at, document.uploaded_at), 'ai',
  previous.source_document_id, NULL
FROM (
  SELECT DISTINCT section_key, source_document_id
  FROM profile_history
  WHERE source_document_id IS NOT NULL
) AS previous
JOIN documents AS document ON document.id = previous.source_document_id
WHERE NOT EXISTS (
  SELECT 1
  FROM profile_history AS history
  WHERE history.section_key = previous.section_key
    AND history.change_document_id = previous.source_document_id
);

INSERT INTO profile_history (
  id, section_key, content, source_document_id, changed_at, changed_by,
  change_document_id, previous_updated_at
)
SELECT
  lower(hex(randomblob(16))), section.section_key, '', NULL,
  section.updated_at, 'ai', section.source_document_id, NULL
FROM profile_sections AS section
WHERE section.source_document_id IS NOT NULL
  AND section.updated_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM profile_history AS history
    WHERE history.section_key = section.section_key
      AND history.change_document_id = section.source_document_id
  );
