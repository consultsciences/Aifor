-- PostgreSQL schema for clinical-dojo (Dokploy / Hostinger deployment)
-- Designed for the synthetic prototype; in production: add row-level security,
-- audit_triggers, and a separate user per Dokploy service.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for sha256 if not using node crypto

-- Programs (fixture programme definitions)
CREATE TABLE IF NOT EXISTS programs (
    id VARCHAR(60) PRIMARY KEY,
    title TEXT NOT NULL,
    sponsor VARCHAR(256),
    area VARCHAR(64),
    phase VARCHAR(16),
    indication TEXT,
    endpoint TEXT,
    comparator TEXT,
    n INTEGER,
    duration_months INTEGER,
    readout_window VARCHAR(32),
    base_rate_value DOUBLE PRECISION,
    base_rate_class VARCHAR(128),
    base_rate_source TEXT,
    summary TEXT,
    fixture BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_programs_area ON programs(area);
CREATE INDEX IF NOT EXISTS idx_programs_readout ON programs(readout_window);

-- Evidence spans per programme
CREATE TABLE IF NOT EXISTS evidence (
    id VARCHAR(32) PRIMARY KEY,
    program_id VARCHAR(60) REFERENCES programs(id) ON DELETE CASCADE,
    claim TEXT NOT NULL,
    source VARCHAR(256),
    span TEXT,
    status VARCHAR(32) CHECK (status IN ('supported','partial','contradicted','not_found')),
    synthetic BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_program ON evidence(program_id);

-- Design-critique findings
CREATE TABLE IF NOT EXISTS design_flags (
    id VARCHAR(32) PRIMARY KEY,
    program_id VARCHAR(60) REFERENCES programs(id) ON DELETE CASCADE,
    severity VARCHAR(16) CHECK (severity IN ('high','medium','low')),
    title TEXT NOT NULL,
    detail TEXT,
    evidence_ids TEXT[] DEFAULT '{}',
    synthetic BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flags_program ON design_flags(program_id);

-- Panel analysts (model + persona combinations)
CREATE TABLE IF NOT EXISTS analysts (
    id SERIAL PRIMARY KEY,
    persona_id VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    model_id VARCHAR(32) REFERENCES models(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personas (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    lens VARCHAR(256),
    bias DOUBLE PRECISION DEFAULT 0,
    templates TEXT[] DEFAULT '{}',
    synthetic BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS models (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    synthetic BOOLEAN DEFAULT true
);

-- Resolved forecasts (ledger)
CREATE TABLE IF NOT EXISTS ledger (
    id SERIAL PRIMARY KEY,
    model VARCHAR(32) REFERENCES models(id) ON DELETE SET NULL,
    persona VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    p DOUBLE PRECISION CHECK (p >= 0 AND p <= 1),
    outcome DOUBLE PRECISION CHECK (outcome IN (0,1)),
    base_rate DOUBLE PRECISION,
    resolved_at TIMESTAMPTZ DEFAULT now(),
    synthetic BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_ledger_model ON ledger(model);
CREATE INDEX IF NOT EXISTS idx_ledger_resolved ON ledger(resolved_at DESC);

-- Pre-registration (immutable)
CREATE TABLE IF NOT EXISTS registrations (
    id VARCHAR(32) PRIMARY KEY,
    hash VARCHAR(64) NOT NULL UNIQUE,
    program_id VARCHAR(60) REFERENCES programs(id) ON DELETE CASCADE,
    projection JSONB,
    evidence_ids TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    fixture BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_reg_program ON registrations(program_id);
CREATE INDEX IF NOT EXISTS idx_reg_hash ON registrations(hash);
CREATE INDEX IF NOT EXISTS idx_reg_time ON registrations(created_at DESC);

-- Function to rebuild registrations (use in Dokploy init / backup restore)
CREATE OR REPLACE FUNCTION public.recompute_registrations()
RETURNS INTEGER LANGUAGE sql AS $$
    SELECT count(*) FROM registrations;
$$;

COMMENT ON SCHEMA public IS 'Clinical R&D forecasting prototype schema (v0.1)';
COMMENT ON TABLE registrations IS 'Immutable pre-registered projections. Append-only; never update existing rows.';
