-- Safe to re-run: every statement is IF NOT EXISTS / OR IGNORE, so this file is
-- also the migration. Scores and the leaderboard are queries over these.

CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY,   -- telegram user id
  name      TEXT NOT NULL,
  joined_on TEXT NOT NULL          -- 'YYYY-MM-DD', logical day (see logicalDay in index.js)
);

CREATE TABLE IF NOT EXISTS goals (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  week    TEXT    NOT NULL,        -- the Monday of that week, 'YYYY-MM-DD'
  pos     INTEGER NOT NULL,        -- 1..5. This is the argument order for /log
  title   TEXT    NOT NULL,
  unit    TEXT    NOT NULL,        -- 'min', 'problems', 'pages', whatever
  target  REAL    NOT NULL,        -- per day
  weight  INTEGER NOT NULL,        -- must total exactly 100 across the week's goals
  weekly  INTEGER NOT NULL DEFAULT 0, -- 1: target is for the whole week, not per day
  UNIQUE (user_id, week, pos)
);
-- Existing database from before weekly goals? Run this once (ALTER has no IF NOT EXISTS):
--   npx wrangler d1 execute accountability --remote --command "ALTER TABLE goals ADD COLUMN weekly INTEGER NOT NULL DEFAULT 0"

CREATE TABLE IF NOT EXISTS logs (
  goal_id INTEGER NOT NULL REFERENCES goals(id),
  day     TEXT    NOT NULL,        -- 'YYYY-MM-DD'
  amount  REAL    NOT NULL,
  PRIMARY KEY (goal_id, day)       -- one row per goal per day, re-logging overwrites
);
