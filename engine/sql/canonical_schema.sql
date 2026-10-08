-- Canonical analytic schema (DuckDB, claims.duckdb). M1 subset of docs/ClaimShield_Nexus_Data_Architecture.md.
-- DELIBERATELY ABSENT: any column saying whether a claim or line was injected. Lineage lives only in gt.duckdb.

CREATE TABLE ref_specialty (
  specialty_code VARCHAR PRIMARY KEY,
  name           VARCHAR NOT NULL,
  category       VARCHAR NOT NULL
);

CREATE TABLE ref_hcpcs (
  hcpcs             VARCHAR PRIMARY KEY,
  short_label       VARCHAR NOT NULL,          -- OUR short label; no AMA descriptors
  family            VARCHAR NOT NULL,
  em_level          TINYINT,
  typical_minutes   SMALLINT,
  is_timed          BOOLEAN NOT NULL,
  reference_allowed DECIMAL(10,2) NOT NULL
);

CREATE TABLE ref_ncci_ptp (
  ptp_id       BIGINT PRIMARY KEY,
  col1_hcpcs   VARCHAR NOT NULL,
  col2_hcpcs   VARCHAR NOT NULL,
  modifier_ind TINYINT NOT NULL,
  eff_dt       DATE NOT NULL,
  del_dt       DATE,
  source_file  VARCHAR NOT NULL,               -- 'FIXTURE (not CMS data)' in M1
  UNIQUE (col1_hcpcs, col2_hcpcs, eff_dt)
);

CREATE TABLE ref_mue (
  hcpcs        VARCHAR NOT NULL,
  service_type VARCHAR NOT NULL,               -- PRACTITIONER | DME
  mue_value    INTEGER NOT NULL,
  mai          TINYINT NOT NULL,               -- 1 = line edit, 2/3 = date-of-service edit
  PRIMARY KEY (hcpcs, service_type)
);

CREATE TABLE ref_place_of_service (
  pos_code    VARCHAR PRIMARY KEY,
  label       VARCHAR NOT NULL,
  is_facility BOOLEAN NOT NULL
);

CREATE TABLE member (
  member_id      VARCHAR PRIMARY KEY,
  birth_year     SMALLINT NOT NULL,
  sex            VARCHAR NOT NULL,             -- display only; never a model feature
  coverage_start DATE NOT NULL,
  death_dt       DATE,
  acuity_score   DOUBLE NOT NULL
);

CREATE TABLE provider (
  provider_id    VARCHAR PRIMARY KEY,
  provider_type  VARCHAR NOT NULL,             -- INDIVIDUAL | ORGANIZATION
  name_syn       VARCHAR NOT NULL,
  specialty_code VARCHAR NOT NULL REFERENCES ref_specialty(specialty_code),
  enroll_dt      DATE NOT NULL,
  status         VARCHAR NOT NULL,
  npi_syn        VARCHAR NOT NULL UNIQUE,
  tin_syn        VARCHAR NOT NULL
);

CREATE TABLE exclusion (
  exclusion_id VARCHAR PRIMARY KEY,
  provider_id  VARCHAR NOT NULL REFERENCES provider(provider_id),
  excl_type    VARCHAR NOT NULL,
  excl_dt      DATE NOT NULL,
  reinstate_dt DATE
);

CREATE TABLE claim (
  claim_id              VARCHAR PRIMARY KEY,
  claim_type            VARCHAR NOT NULL,      -- CARRIER | DME
  member_id             VARCHAR NOT NULL REFERENCES member(member_id),
  billing_provider_id   VARCHAR NOT NULL REFERENCES provider(provider_id),
  rendering_provider_id VARCHAR REFERENCES provider(provider_id),
  referring_provider_id VARCHAR REFERENCES provider(provider_id),
  from_dt               DATE NOT NULL,
  thru_dt               DATE NOT NULL,
  pos_code              VARCHAR REFERENCES ref_place_of_service(pos_code),
  dx1                   VARCHAR,
  paid_amt              DECIMAL(12,2) NOT NULL,
  CHECK (thru_dt >= from_dt)
);

CREATE TABLE claim_line (
  claim_id              VARCHAR NOT NULL REFERENCES claim(claim_id),
  line_no               SMALLINT NOT NULL,
  service_dt            DATE NOT NULL,
  hcpcs                 VARCHAR NOT NULL,
  modifier1             VARCHAR,
  modifier2             VARCHAR,
  units                 INTEGER NOT NULL CHECK (units > 0),
  billed_amt            DECIMAL(12,2),
  allowed_amt           DECIMAL(12,2) NOT NULL,
  paid_amt              DECIMAL(12,2) NOT NULL CHECK (paid_amt >= 0),
  rendering_provider_id VARCHAR REFERENCES provider(provider_id),
  pos_code              VARCHAR REFERENCES ref_place_of_service(pos_code),
  PRIMARY KEY (claim_id, line_no)
);

CREATE TABLE provider_location (
  provider_id VARCHAR PRIMARY KEY REFERENCES provider(provider_id),
  region      SMALLINT NOT NULL,
  lat         DOUBLE NOT NULL,
  lon         DOUBLE NOT NULL,
  is_rural    BOOLEAN NOT NULL,
  building_id VARCHAR,                         -- same value = same physical building
  phone_syn   VARCHAR
);

CREATE TABLE member_location (
  member_id VARCHAR PRIMARY KEY REFERENCES member(member_id),
  region    SMALLINT NOT NULL,
  lat       DOUBLE NOT NULL,
  lon       DOUBLE NOT NULL
);

CREATE TABLE inpatient_stay (
  stay_id      VARCHAR PRIMARY KEY,
  member_id    VARCHAR NOT NULL REFERENCES member(member_id),
  admit_dt     DATE NOT NULL,
  discharge_dt DATE NOT NULL,
  CHECK (discharge_dt >= admit_dt)
);

CREATE TABLE gen_manifest (
  run_id      VARCHAR PRIMARY KEY,
  master_seed BIGINT NOT NULL,
  config_json VARCHAR NOT NULL,
  table_hashes_json VARCHAR NOT NULL,
  created_at  TIMESTAMP NOT NULL
);

-- Detector output (written by the engine, never by the generator)
CREATE TABLE out_rule_hit (
  rule_id    VARCHAR NOT NULL,
  claim_id   VARCHAR NOT NULL,
  line_no    SMALLINT NOT NULL,
  member_id  VARCHAR NOT NULL,
  provider_id VARCHAR NOT NULL,
  service_dt DATE NOT NULL,
  hcpcs      VARCHAR NOT NULL,
  paid_amt   DECIMAL(12,2) NOT NULL,
  dollars    DECIMAL(12,2) NOT NULL,
  detail     VARCHAR NOT NULL,
  flag_role  VARCHAR NOT NULL,
  PRIMARY KEY (rule_id, claim_id, line_no)
);

CREATE TABLE out_alert (
  alert_id    VARCHAR PRIMARY KEY,
  run_id      VARCHAR NOT NULL,
  rule_id     VARCHAR NOT NULL,
  rule_version INTEGER NOT NULL,
  family      VARCHAR NOT NULL,
  scheme_type VARCHAR NOT NULL,
  provider_id VARCHAR NOT NULL,
  window_start DATE NOT NULL,
  window_end   DATE NOT NULL,
  score       DOUBLE NOT NULL,
  dollars     DECIMAL(12,2) NOT NULL,
  dollars_basis VARCHAR NOT NULL,
  n_lines     INTEGER NOT NULL,
  suppressed_by_exception_id VARCHAR
);

CREATE TABLE out_alert_line (
  alert_id VARCHAR NOT NULL REFERENCES out_alert(alert_id),
  claim_id VARCHAR NOT NULL,
  line_no  SMALLINT NOT NULL,
  dollars  DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (alert_id, claim_id, line_no)
);
