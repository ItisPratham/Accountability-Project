-- Three tables. Everything else (scores, leaderboard, streaks) is a query over these.

CREATE TABLE users (
  id        INTEGER PRIMARY KEY,   -- telegram user id
  name      TEXT NOT NULL,
  joined_on TEXT NOT NULL          -- 'YYYY-MM-DD', logical day (see logicalDay in index.js)
);

CREATE TABLE goals (
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

CREATE TABLE logs (
  goal_id INTEGER NOT NULL REFERENCES goals(id),
  day     TEXT    NOT NULL,        -- 'YYYY-MM-DD'
  amount  REAL    NOT NULL,
  PRIMARY KEY (goal_id, day)       -- one row per goal per day, re-logging overwrites
);
