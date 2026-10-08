-- ClaimShield Nexus: serving_* tables.
-- OWNER: Python engine (the only writer). The Java gateway only reads these.
-- Every table is versioned by run_id. A run is published in ONE transaction, then serving_current_run flips.
-- Complex objects are stored as JSON text so the gateway can pass them through without mapping.
-- Statements are separated by ';' (plain sqlite3 executescript).

CREATE TABLE IF NOT EXISTS serving_run (
  run_id             TEXT PRIMARY KEY,
  asof               TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  master_seed        INTEGER,
  data_hash          TEXT,
  exception_set_json TEXT NOT NULL DEFAULT '[]',
  precedent_count    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETE','FAILED'))
);

CREATE TABLE IF NOT EXISTS serving_current_run (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  run_id  TEXT NOT NULL REFERENCES serving_run(run_id)
);

CREATE TABLE IF NOT EXISTS serving_case (
  run_id              TEXT NOT NULL REFERENCES serving_run(run_id),
  case_id             TEXT NOT NULL,
  primary_provider_id TEXT NOT NULL,
  specialty_code      TEXT,
  tier                TEXT NOT NULL CHECK (tier IN ('HIGH','MEDIUM')),
  risk_30 REAL NOT NULL, risk_60 REAL NOT NULL, risk_90 REAL NOT NULL,
  utility_30 REAL NOT NULL, utility_60 REAL NOT NULL, utility_90 REAL NOT NULL,
  dollars_exact       REAL NOT NULL,
  dollars_est         REAL NOT NULL,
  dollars_basis       TEXT NOT NULL,
  member_impact       REAL NOT NULL,
  severity            REAL NOT NULL,
  evidence_strength   REAL NOT NULL,
  precedent_fit       REAL NOT NULL,
  est_hours           REAL NOT NULL,
  trend               TEXT CHECK (trend IN ('ESCALATING','STABLE','DECLINING')),
  hypotheses_json     TEXT NOT NULL,
  subjects_json       TEXT NOT NULL,
  channels_json       TEXT NOT NULL,
  tier_reasons_json   TEXT NOT NULL,
  header_json         TEXT NOT NULL,
  fv_json             TEXT NOT NULL,
  PRIMARY KEY (run_id, case_id)
);
CREATE INDEX IF NOT EXISTS idx_serving_case_run_tier ON serving_case (run_id, tier);

CREATE TABLE IF NOT EXISTS serving_evidence_pack (
  run_id TEXT NOT NULL, case_id TEXT NOT NULL,
  pack_json TEXT NOT NULL, pack_sha256 TEXT NOT NULL,
  PRIMARY KEY (run_id, case_id)
);

CREATE TABLE IF NOT EXISTS serving_case_line (
  run_id TEXT NOT NULL, case_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
  claim_id TEXT NOT NULL, line_no INTEGER NOT NULL,
  member_id TEXT, provider_id TEXT, service_dt TEXT,
  hcpcs TEXT, hcpcs_label TEXT, units INTEGER, paid_amt REAL, flag_role TEXT,
  PRIMARY KEY (run_id, case_id, evidence_id, claim_id, line_no)
);

CREATE TABLE IF NOT EXISTS serving_graph (
  run_id TEXT NOT NULL, case_id TEXT NOT NULL, graph_json TEXT NOT NULL,
  PRIMARY KEY (run_id, case_id)
);

CREATE TABLE IF NOT EXISTS serving_timeline (
  run_id TEXT NOT NULL, case_id TEXT NOT NULL, timeline_json TEXT NOT NULL,
  PRIMARY KEY (run_id, case_id)
);

CREATE TABLE IF NOT EXISTS serving_case_precedent (
  run_id TEXT NOT NULL, case_id TEXT NOT NULL, precedent_id TEXT NOT NULL,
  similarity REAL NOT NULL, disposition TEXT NOT NULL, reason_code TEXT,
  compare_json TEXT NOT NULL,
  PRIMARY KEY (run_id, case_id, precedent_id)
);

CREATE TABLE IF NOT EXISTS serving_monitor_item (
  run_id TEXT NOT NULL, monitor_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  reasons_json TEXT NOT NULL, raise_json TEXT NOT NULL,
  PRIMARY KEY (run_id, monitor_id)
);

CREATE TABLE IF NOT EXISTS serving_funnel    (run_id TEXT PRIMARY KEY, funnel_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS serving_dashboard (run_id TEXT PRIMARY KEY, dashboard_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS serving_eval      (run_id TEXT PRIMARY KEY, eval_json TEXT NOT NULL);

-- Knowledge sources (English-only; read by the gateway for chat tools and the Knowledge screen)
CREATE TABLE IF NOT EXISTS serving_policy_section (
  section_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  version TEXT NOT NULL, eff_dt TEXT NOT NULL, provenance TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS serving_rule_registry (
  rule_id TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, scheme_type TEXT NOT NULL,
  family TEXT NOT NULL, status TEXT NOT NULL, params_json TEXT NOT NULL, policy_ids_json TEXT NOT NULL,
  PRIMARY KEY (rule_id, version)
);
CREATE TABLE IF NOT EXISTS serving_glossary (
  term_id TEXT PRIMARY KEY, term TEXT NOT NULL, definition TEXT NOT NULL, category TEXT NOT NULL, version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS serving_help_article (
  article_id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS serving_precedent_seed (
  precedent_id TEXT PRIMARY KEY, investigation_id TEXT, scheme_type TEXT NOT NULL, specialty_code TEXT,
  disposition TEXT NOT NULL, reason_code TEXT, rule_ids_json TEXT NOT NULL, feature_vector_json TEXT NOT NULL,
  fv_version TEXT NOT NULL, rationale TEXT NOT NULL, exposure REAL, recovered REAL, closed_dt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS serving_knowledge_lint (
  run_id TEXT NOT NULL, finding_id TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL,
  entities_json TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (run_id, finding_id)
);
