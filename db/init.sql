-- Composure: Tiger Data (TimescaleDB on Postgres) schema. Idempotent: safe to re-run.
-- Works on plain Postgres too (hypertable step is skipped if timescaledb is absent).

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'timescaledb not available (%); using plain tables', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS matches (
  id            text PRIMARY KEY,              -- match_id created by the game client
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  p1_name       text DEFAULT 'Player 1',
  p2_name       text DEFAULT 'Player 2',
  winner        smallint,                      -- 1, 2, or NULL (draw/unfinished)
  duration_ms   integer,
  summary       text,                          -- Gemini post-match summary (from Person C)
  meta          jsonb NOT NULL DEFAULT '{}'    -- anything else: build id, biometric source, etc.
);

-- Biometrics per player, ~1-4 Hz. ts = matches.started_at + t_ms
CREATE TABLE IF NOT EXISTS biometric_samples (
  ts        timestamptz NOT NULL,
  match_id  text NOT NULL,
  t_ms      integer NOT NULL,                  -- ms since match start (game clock)
  player    smallint NOT NULL,                 -- 1 or 2
  hr        real,                              -- heart rate, bpm
  breath    real,                              -- breaths/min
  stress    real,                              -- 0..1
  calm      real,                              -- 0..1
  source    text NOT NULL DEFAULT 'presage'    -- 'presage' | 'simulated' | 'keyboard'
);

-- Discrete events: hit, flinch, heal_streak, special, ko, round_start ...
CREATE TABLE IF NOT EXISTS game_events (
  ts        timestamptz NOT NULL,
  match_id  text NOT NULL,
  t_ms      integer NOT NULL,
  type      text NOT NULL,
  player    smallint,                          -- who the event is about (victim for hit/flinch)
  payload   jsonb NOT NULL DEFAULT '{}'        -- e.g. {"damage":12,"multiplier":1.4}
);

-- 250 ms game-state snapshots
CREATE TABLE IF NOT EXISTS match_snapshots (
  ts        timestamptz NOT NULL,
  match_id  text NOT NULL,
  t_ms      integer NOT NULL,
  p1_hp     real, p2_hp     real,
  p1_meter  real, p2_meter  real
);

DO $$ BEGIN
  PERFORM create_hypertable('biometric_samples', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
  PERFORM create_hypertable('game_events',       'ts', if_not_exists => TRUE, migrate_data => TRUE);
  PERFORM create_hypertable('match_snapshots',   'ts', if_not_exists => TRUE, migrate_data => TRUE);
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'create_hypertable missing; staying on plain tables';
END $$;

CREATE INDEX IF NOT EXISTS biometric_samples_match_idx ON biometric_samples (match_id, t_ms);
CREATE INDEX IF NOT EXISTS game_events_match_idx       ON game_events (match_id, t_ms);
CREATE INDEX IF NOT EXISTS match_snapshots_match_idx   ON match_snapshots (match_id, t_ms);
CREATE INDEX IF NOT EXISTS matches_started_idx         ON matches (started_at DESC);
