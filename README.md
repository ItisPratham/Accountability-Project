# Accountability

A Telegram bot for a small group of friends. Everyone commits to up to five
weighted goals for the week, logs numbers every night, and the group sees who
actually did the work.

It runs on a Cloudflare Worker with D1 (SQLite) and fits in the free tier.

## Rules

- Up to 5 goals, each with a target and an optional unit. Weights add up to 100.
  Dashes, commas, bullets and glued units like `45min` are all fine.
- A target is per day. End it with `a week` (or `/week`) and it is for the
  whole week instead: `gym 30% 3 sessions a week`.
- Goals are set on Sunday and lock at 3am Monday until the next Sunday. The
  Sunday post has a "Same as this week" button. Do nothing and your goals carry
  over on Monday morning, as long as you logged at least once that week. If you
  join midweek, you can set yours straight away and you are scored from that day.
- A day stays open until 3am IST. After that it is sealed.
- A daily goal scores `logged / target` per day, capped at 1. A day with no log
  scores 0. Overshoot rolls forward, but only up to one day's worth, so you can
  cover one day at most. A day you fell short on stays short.
- A weekly goal scores `week total / target`, capped at 1. Before the week is
  over the target is prorated to the days scored so far.
- The leaderboard resets every Monday. Next to your score: `avg`, your mean
  over the last 4 weeks, and 🔥 your streak, days in a row with a log (a 0
  counts). One missed day per week is forgiven.
- There is no stick in the bot. Agree one between yourselves: lowest score of
  the week buys dinner, a pot, whatever. The bot makes it visible, that's all.

## Commands

```
/setgoals            the bot asks for your goals, you reply with one per line:
dsa 40% 45 min         name, weight %, target, unit
gym 30% 3 sessions a week
read 30% 20 pages

/log                 opens a form: step each goal up or down, tap Done
/log 45 1 20         or type them, in your goal order
/log dsa 45          one goal
/goals               everyone's goals this week
/board               this week's standings
```

Tapping a command in Telegram's menu sends it immediately, so `/setgoals`
asks and you reply, and `/log` opens a form. Each goal gets step buttons
(`−10 −5 Half Full +5 +10`, about 10% and 20% of the target; weekly goals skip Half and Full) and every tap saves. Done removes
the buttons and leaves the day's log, counting anything untouched as 0. You can
also reply to the form with numbers, or send everything in one message.

The bot posts on its own: at 9:30pm, a log form for each person with something
unlogged, with what the others did today at the bottom; at 8am, yesterday's
standings (on Monday, last week's final and who got carried over); and on Sunday
at 8pm a reminder to set goals, with the "Same as this week" button.

## Setup

1. Make a bot with [@BotFather](https://t.me/BotFather) and keep the token.
   Leave privacy mode on, since the bot only needs to see commands.
2. Install and log in:
   ```bash
   npm install
   npx wrangler login
   ```
3. Create the database, paste the `database_id` it prints into `wrangler.toml`,
   then load the schema:
   ```bash
   npx wrangler d1 create accountability
   npx wrangler d1 execute accountability --remote --file=schema.sql
   ```
4. Deploy, then set the secrets. `SECRET` is any random string, for example
   the output of `openssl rand -hex 32`. Set `GROUP_ID` to `0` for now.
   ```bash
   npx wrangler deploy
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put SECRET
   npx wrangler secret put GROUP_ID
   ```
5. Point Telegram at the worker:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -d url=https://<your-worker>.workers.dev -d secret_token=<SECRET>
   ```
6. Find the group's chat id. Run `npx wrangler tail`, create a Telegram
   group, and add the bot. The tail prints `ignored chat -100...`. Store that
   number as `GROUP_ID` and the bot starts answering in that group:
   ```bash
   npx wrangler secret put GROUP_ID
   ```
7. Make the bot a group admin with only the "Delete messages" permission, so
   it can tidy up its own questions and failed attempts once they are answered.
   As an admin it receives every message in the group, but it ignores anything
   that isn't a command and stores none of it.
8. In @BotFather, send `/setjoingroups`, pick the bot, and choose Disable.
   Nobody can add it to another group after that, you included. Turn it back
   on for a minute if you ever move to a new group.

### Upgrading from before weekly goals

The `goals` table gained a column. Run once:
```bash
npx wrangler d1 execute accountability --remote --command "ALTER TABLE goals ADD COLUMN weekly INTEGER NOT NULL DEFAULT 0"
```
The old `members` table is no longer used and can stay or be dropped.

## Who can use it

Only members of your group. Everywhere else the bot stays silent, and it
leaves any other group the moment it notices one. Nothing reaches the database
without the webhook secret. Membership is the access control, so keep the group
private and only let admins add members.

## Development

`npm test` runs the logic checks, then drives the whole bot against a fake
Telegram and an in-memory database. All the logic lives
in `src/core.js` with no Telegram or database code in it. `src/index.js` is the
glue.

Cron times in `wrangler.toml` are UTC. If you change one, change the matching
`case` in `scheduled()` too.
