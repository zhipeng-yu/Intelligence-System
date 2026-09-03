ALTER TABLE network_search_jobs
ADD COLUMN detail_budget INTEGER NOT NULL DEFAULT 0
CHECK (detail_budget BETWEEN 0 AND 60);

ALTER TABLE network_search_jobs
ADD COLUMN homepage_candidates INTEGER NOT NULL DEFAULT 0
CHECK (homepage_candidates BETWEEN 0 AND 60);

ALTER TABLE network_search_jobs
ADD COLUMN eligible_candidates INTEGER NOT NULL DEFAULT 0
CHECK (eligible_candidates BETWEEN 0 AND 60);

ALTER TABLE network_search_jobs
ADD COLUMN detail_opens INTEGER NOT NULL DEFAULT 0
CHECK (detail_opens BETWEEN 0 AND 60);

ALTER TABLE network_search_jobs
ADD COLUMN keyword_checks INTEGER NOT NULL DEFAULT 0
CHECK (keyword_checks BETWEEN 0 AND 60);

ALTER TABLE network_search_jobs
ADD COLUMN matched_results INTEGER NOT NULL DEFAULT 0
CHECK (matched_results BETWEEN 0 AND 30);

ALTER TABLE network_search_jobs
ADD COLUMN termination_reason TEXT
CHECK (termination_reason IS NULL OR termination_reason IN (
  'results_cap', 'detail_budget_exhausted', 'runtime_cutoff',
  'security_blocked', 'candidates_exhausted', 'worker_failed',
  'lease_expired', 'legacy_unreported'
));

ALTER TABLE network_search_jobs
ADD COLUMN counts_complete INTEGER NOT NULL DEFAULT 0
CHECK (counts_complete IN (0, 1));

ALTER TABLE network_search_jobs
ADD COLUMN budget_date TEXT
CHECK (
  budget_date IS NULL OR (
    length(budget_date) = 10
    AND budget_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  )
);

UPDATE network_search_jobs
SET termination_reason = 'legacy_unreported'
WHERE status IN ('completed', 'partial', 'blocked', 'failed');

CREATE INDEX network_search_budget_date
ON network_search_jobs (budget_date, counts_complete, status);

CREATE TABLE network_worker_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  halted INTEGER NOT NULL DEFAULT 0 CHECK (halted IN (0, 1)),
  halt_reason TEXT CHECK (halt_reason IS NULL OR halt_reason = 'security_blocked'),
  updated_at TEXT
) STRICT;

INSERT INTO network_worker_control (id, halted, halt_reason, updated_at)
VALUES (1, 0, NULL, NULL);
