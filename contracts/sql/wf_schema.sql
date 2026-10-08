-- ClaimShield Nexus: wf_* tables.
-- OWNER: Java gateway (the only writer). The Python engine never touches these; it gets what it needs in request bodies.
-- Statements are separated by a line holding three caret characters (the value of spring.sql.init.separator),
-- because trigger bodies contain semicolons. Never write that token inside a comment.

CREATE TABLE IF NOT EXISTS wf_user (
  user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('INVESTIGATOR','SUPERVISOR','GOVERNANCE','AUDITOR'))
)
^^^
CREATE TABLE IF NOT EXISTS wf_user_pref (
  user_id TEXT PRIMARY KEY REFERENCES wf_user(user_id),
  language TEXT NOT NULL DEFAULT 'en',
  onboarded INTEGER NOT NULL DEFAULT 0,
  onboarding_skipped INTEGER NOT NULL DEFAULT 0
)
^^^
CREATE TABLE IF NOT EXISTS wf_case_state (
  case_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('NEW','TRIAGED','IN_REVIEW','NEED_INFO','ACTION_PROPOSED','ACTION_APPROVED','ACTION_TAKEN','CLOSED')),
  assigned_to TEXT, outcome TEXT, closed_at TEXT, updated_at TEXT NOT NULL
)
^^^
CREATE TABLE IF NOT EXISTS wf_review_action (
  action_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  actor TEXT NOT NULL, role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ACCEPT','MODIFY','REJECT','REQUEST_INFO')),
  reason_code TEXT, notes TEXT,
  new_action TEXT, hypothesis TEXT,
  ai_proposal_json TEXT NOT NULL, human_decision_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('RECORDED','PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  approver TEXT, approved_at TEXT, approval_notes TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL
)
^^^
CREATE INDEX IF NOT EXISTS idx_review_case ON wf_review_action (case_id, created_at)
^^^
CREATE TABLE IF NOT EXISTS wf_brief (
  brief_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, pack_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('LLM','TEMPLATE')),
  model TEXT, prompt_sha256 TEXT, response_sha256 TEXT,
  output_json TEXT NOT NULL, rendered_json TEXT NOT NULL, validation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (case_id, pack_sha256)
)
^^^
CREATE TABLE IF NOT EXISTS wf_precedent (
  precedent_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('SEED','LIVE')),
  investigation_id TEXT, case_id TEXT,
  scheme_type TEXT NOT NULL, specialty_code TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN ('CONFIRMED','UNFOUNDED','EDUCATION','INSUFFICIENT')),
  reason_code TEXT, rule_ids_json TEXT NOT NULL,
  feature_vector_json TEXT NOT NULL, fv_version TEXT NOT NULL, graph_pattern_json TEXT,
  rationale TEXT NOT NULL, ai_drafted INTEGER NOT NULL DEFAULT 0,
  exposure REAL, recovered REAL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_COSIGN','ACTIVE','SUPERSEDED','RETIRED')),
  closed_dt TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  cosigned_by TEXT, cosigned_at TEXT, reinforces_id TEXT, conflicts_with_id TEXT
)
^^^
CREATE TABLE IF NOT EXISTS wf_exception_rule (
  exc_id TEXT NOT NULL, version INTEGER NOT NULL,
  scope_json TEXT NOT NULL, condition_json TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('DOWNGRADE_TO_MONITOR','SUPPRESS_ALERT')),
  source_precedent_id TEXT, support_n INTEGER NOT NULL DEFAULT 1, flags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SIMULATED','PENDING_APPROVAL','APPROVED','REJECTED','RETIRED')),
  simulate_report_json TEXT, lint_verdict TEXT CHECK (lint_verdict IN ('PASS','WARN','BLOCK')),
  explanation_json TEXT,
  proposed_by TEXT NOT NULL, approved_by TEXT, approved_at TEXT, approval_notes TEXT,
  supersedes TEXT, review_due TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (exc_id, version)
)
^^^
CREATE TABLE IF NOT EXISTS wf_job (
  job_id TEXT PRIMARY KEY, kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')),
  stage TEXT, engine_job_id TEXT, request_json TEXT, result_run_id TEXT, error TEXT,
  created_by TEXT, created_at TEXT NOT NULL, finished_at TEXT
)
^^^
CREATE TABLE IF NOT EXISTS wf_chat_session (
  session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, lang TEXT NOT NULL, created_at TEXT NOT NULL
)
^^^
CREATE TABLE IF NOT EXISTS wf_chat_message (
  message_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES wf_chat_session(session_id),
  role TEXT NOT NULL CHECK (role IN ('USER','ASSISTANT')), text TEXT NOT NULL,
  intent TEXT, evidence_ids_json TEXT, validation_json TEXT,
  mode TEXT CHECK (mode IN ('LLM','FACTS_ONLY','REFUSAL')), created_at TEXT NOT NULL
)
^^^
CREATE TABLE IF NOT EXISTS wf_audit_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL,
  event_type TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  payload_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
)
^^^
CREATE TRIGGER IF NOT EXISTS wf_audit_no_update BEFORE UPDATE ON wf_audit_event
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END
^^^
CREATE TRIGGER IF NOT EXISTS wf_audit_no_delete BEFORE DELETE ON wf_audit_event
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END
^^^
CREATE INDEX IF NOT EXISTS idx_audit_entity ON wf_audit_event (entity_type, entity_id, seq)
^^^
CREATE TABLE IF NOT EXISTS wf_ai_output (
  output_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, purpose TEXT NOT NULL, pack_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('LLM','TEMPLATE')), badge TEXT NOT NULL, model TEXT,
  output_json TEXT NOT NULL, validation_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (case_id, purpose, pack_sha256)
)
^^^
CREATE TABLE IF NOT EXISTS wf_feedback (
  feedback_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('REASONING','BRIEF','PRECEDENT','RECOMMENDATION','CHAT')),
  rating TEXT NOT NULL CHECK (rating IN ('USEFUL','NOT_USEFUL')),
  categories_json TEXT NOT NULL DEFAULT '[]', comment TEXT,
  decision TEXT NOT NULL DEFAULT 'NONE' CHECK (decision IN ('ACCEPTED','MODIFIED','REJECTED','NONE')),
  ai_recommendation TEXT, ai_confidence TEXT, pack_sha256 TEXT, created_at TEXT NOT NULL
)
^^^
CREATE TABLE IF NOT EXISTS wf_knowledge_item (
  item_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('AI','DETERMINISTIC')), model TEXT, pack_sha256 TEXT,
  scheme_type TEXT, specialty_code TEXT, evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED','RETIRED')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_notes TEXT
)
^^^
CREATE TABLE IF NOT EXISTS wf_handoff (
  handoff_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, requested_by TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('WAITING','ACTIVE','CLOSED')), agent TEXT, case_id TEXT,
  created_at TEXT NOT NULL, joined_at TEXT, closed_at TEXT
)
^^^
CREATE TABLE IF NOT EXISTS wf_handoff_message (
  message_id TEXT PRIMARY KEY, handoff_id TEXT NOT NULL REFERENCES wf_handoff(handoff_id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('USER','AGENT','SYSTEM')), sender TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL
)
^^^
CREATE TABLE IF NOT EXISTS wf_notification (
  notif_id TEXT PRIMARY KEY, username TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  ref TEXT, count INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, read_at TEXT
)
^^^
CREATE INDEX IF NOT EXISTS idx_notification_user ON wf_notification (username, read_at, created_at)
