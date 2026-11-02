BEGIN;

CREATE TABLE IF NOT EXISTS provider_runtime_config_schema (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_runtime_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO provider_runtime_config_schema (singleton, version)
VALUES (TRUE, 1)
ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version;

COMMIT;
