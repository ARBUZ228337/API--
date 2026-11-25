CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL DEFAULT 'default',
  key_hash   CHAR(64) UNIQUE NOT NULL,   -- sha256 ключа; сам ключ не хранится
  key_prefix VARCHAR(12) NOT NULL,       -- для отображения в интерфейсе
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_logs (
  id               BIGSERIAL PRIMARY KEY,
  api_key_id       INT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint         VARCHAR(500) NOT NULL,
  method           VARCHAR(10) NOT NULL,
  status_code      INT NOT NULL,
  response_time_ms INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_key_time ON request_logs (api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_keys_user ON api_keys (user_id);
