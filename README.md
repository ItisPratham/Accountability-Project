# Accountability

A Telegram bot for a small group of friends. Everyone commits to up to five
weighted goals for the week, logs numbers every night, and the group sees who
actually did the work.

It runs on a Cloudflare Worker with D1 (SQLite) and fits in the free tier.

## Rules

- Up to 5 goals, each with a daily target and an optional unit. Weights add up to 100.
  Dashes, commas, bullets and glued units like `45min` are all fine.
- Goals are set on Sunday and lock at 3am Monday until the next Sunday. If you
  join midweek, you can set yours straight away and you are scored from that day.
- A day stays open until 3am IST. After that it is sealed.
- Each goal scores `logged / target` per day, capped at 1. A day with no log scores 0.
- Overshoot rolls forward, but only up to one day's worth, so you can cover one
  day at most. A day you fell short on stays short.
- The leaderboard resets every Monday. Your average over past weeks sits next to it.

## Commands

```
/goals               everyone's goals this week
/goals               set yours, one per line: name weight% target unit
dsa 40% 45 min
gym 30% 1 session
read 30% 20 pages

/log 45 1 20         today's numbers, in your goal order
/log dsa 45          one goal
/log                 what you've logged today
/board               this week's standings
```

The bot posts on its own three times: a 9:30pm list of whoever hasn't logged,
the 8am standings, and a Sunday 8pm reminder to set goals.

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
7. In @BotFather, send `/setjoingroups`, pick the bot, and choose Disable.
   Nobody can add it to another group after that, you included. Turn it back
   on for a minute if you ever move to a new group.

## Who can use it

Only members of your group. Everywhere else the bot stays silent, and it
leaves any other group the moment it notices one. Nothing reaches the database
without the webhook secret. Membership is the access control, so keep the group
private and only let admins add members.

## Development

`npm test` runs the scoring, parsing and standings checks. All the logic lives
in `src/core.js` with no Telegram or database code in it. `src/index.js` is the
glue.

Cron times in `wrangler.toml` are UTC. If you change one, change the matching
`case` in `scheduled()` too.
