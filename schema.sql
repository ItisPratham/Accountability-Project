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
  UNIQUE (user_id, week, pos)
);

CREATE TABLE IF NOT EXISTS logs (
  goal_id INTEGER NOT NULL REFERENCES goals(id),
  day     TEXT    NOT NULL,        -- 'YYYY-MM-DD'
  amount  REAL    NOT NULL,
  PRIMARY KEY (goal_id, day)       -- one row per goal per day, re-logging overwrites
);

-- Group membership, kept apart from scoring. Drives the inactivity warnings,
-- removals, and "welcome back". Rows survive a removal so the bot remembers.
CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY,  -- telegram user id
  name       TEXT    NOT NULL,
  active_on  TEXT    NOT NULL,     -- last /log or /goals, (re)join, or when the idle clock restarted
  warned_on  TEXT,                 -- last inactivity warning
  cheered_on TEXT,                 -- last "hit 50%" nudge
  kicked_on  TEXT,                 -- set while removed, cleared when they come back
  kicks      INTEGER NOT NULL DEFAULT 0
);

-- Everyone who already set goals becomes a member, active as of their last log.
INSERT OR IGNORE INTO members (id, name, active_on)
SELECT u.id, u.name, COALESCE(
  (SELECT MAX(l.day) FROM logs l JOIN goals g ON g.id = l.goal_id WHERE g.user_id = u.id),
  u.joined_on)
FROM users u;
