import {
  logicalDay, addDays, weekday, mondayOf, daysBetween,
  goalWeek, parseGoals, parseLog, standings,
} from "./core.js";

const USAGE = `/goals, then one goal per line: name weight target unit
  /goals
  dsa 40 45 min
  gym 30 1 session
  read 30 20 pages
Up to 5 goals, weights add to exactly 100, target is per day.
Set them on Sunday. They lock Monday 3am until the next Sunday.

/log 45 1 20   today's numbers, in your goal order
/log dsa 45    just one goal
/board         this week's standings
/goals         everyone's goals

A day stays open until 3am.`;

// ---- telegram --------------------------------------------------------------

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.log(method, r.status, await r.text());
}

const say = (env, text, html = false) =>
  tg(env, "sendMessage", { chat_id: env.GROUP_ID, text, ...(html && { parse_mode: "HTML" }) });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mention = (u) => `<a href="tg://user?id=${u.id}">${esc(u.name)}</a>`;

const reply = (env, msg, text) =>
  tg(env, "sendMessage", {
    chat_id: msg.chat.id,
    text,
    reply_parameters: { message_id: msg.message_id },
  });

// ---- formatting ------------------------------------------------------------

const fmt = (day, opts) =>
  new Date(day).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
const dayMonth = (day) => fmt(day, { day: "numeric", month: "short" });
const shortDay = (day) => fmt(day, { weekday: "short", day: "numeric", month: "short" });

function boardText(rows, through, open) {
  const week = mondayOf(through);
  const full = daysBetween(week, through).length;
  const head = weekday(through) === 0 && !open
    ? `Final, week of ${dayMonth(week)}`
    : `Week of ${dayMonth(week)}, through ${shortDay(through)}${open ? " (today still open)" : ""}`;
  if (!rows.length) return `${head}\nNobody has goals set.`;
  return [head, "", ...rows.map((r, i) =>
    `${i + 1}. ${r.user.name}  ${Math.round(r.score)}` +
    (r.days < full ? ` (${r.days}d)` : "") +
    (r.allTime === null ? "" : `  · avg ${Math.round(r.allTime)}`))].join("\n");
}

function goalsText({ users, goals }, today) {
  const weeks = [mondayOf(today)];
  if (weekday(today) === 0) weeks.push(addDays(today, 1));
  const out = [];
  for (const week of weeks) {
    out.push(`Week of ${dayMonth(week)}`);
    const people = users.filter((u) => goals.some((g) => g.user_id === u.id && g.week === week));
    if (!people.length) out.push("  nobody yet");
    for (const u of people) {
      out.push(u.name);
      for (const g of goals.filter((g) => g.user_id === u.id && g.week === week)) {
        out.push(`  ${g.pos}. ${g.title}  ${g.target} ${g.unit}/day  (${g.weight}%)`);
      }
    }
    out.push("");
  }
  return out.join("\n").trim();
}

function todayText(goals, logged, today) {
  const parts = goals.map((g) => `${g.title} ${logged.get(g.id) ?? "-"}/${g.target} ${g.unit}`);
  return `${shortDay(today)}: ${parts.join(" · ")}`;
}

// ---- database --------------------------------------------------------------

// ponytail: reads whole tables. A friend group will not notice for years.
async function load(env) {
  const [users, goals, logs] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM users"),
    env.DB.prepare("SELECT * FROM goals ORDER BY user_id, week, pos"),
    env.DB.prepare("SELECT * FROM logs"),
  ]);
  return { users: users.results, goals: goals.results, logs: logs.results };
}

const myGoals = async (env, userId, week) =>
  (await env.DB.prepare("SELECT * FROM goals WHERE user_id = ? AND week = ? ORDER BY pos")
    .bind(userId, week).all()).results;

async function loggedToday(env, userId, today) {
  const { results } = await env.DB.prepare(
    "SELECT l.goal_id, l.amount FROM logs l JOIN goals g ON g.id = l.goal_id WHERE g.user_id = ? AND l.day = ?",
  ).bind(userId, today).all();
  return new Map(results.map((r) => [r.goal_id, r.amount]));
}

// ---- commands --------------------------------------------------------------

async function handle(msg, env) {
  const text = msg.text.trim();
  const token = text.split(/\s/)[0];
  const cmd = token.split("@")[0]; // "/log@yourbot" in groups
  const body = text.slice(token.length).trim();
  const args = body.split(/\s+/).filter(Boolean);
  const me = { id: msg.from.id, name: msg.from.first_name };
  const today = logicalDay();

  switch (cmd) {
    case "/start":
    case "/help":
      return reply(env, msg, USAGE);

    case "/board":
      return reply(env, msg, boardText(standings(await load(env), today), today, true));

    case "/goals": {
      if (!body) return reply(env, msg, goalsText(await load(env), today));

      const parsed = parseGoals(body);
      if (parsed.error) return reply(env, msg, `${parsed.error}\n\n${USAGE}`);

      const current = await myGoals(env, me.id, mondayOf(today));
      const week = goalWeek(today, current.length > 0);
      if (!week) return reply(env, msg, "Your goals are locked until Sunday.");

      const db = env.DB;
      await db.batch([
        db.prepare("INSERT INTO users (id, name, joined_on) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name")
          .bind(me.id, me.name, today),
        // Only ever next week's untouched rows (Sunday) or nothing (midweek), so no logs hang off them.
        db.prepare("DELETE FROM goals WHERE user_id = ? AND week = ?").bind(me.id, week),
        ...parsed.goals.map((g) =>
          db.prepare("INSERT INTO goals (user_id, week, pos, title, unit, target, weight) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(me.id, week, g.pos, g.title, g.unit, g.target, g.weight)),
      ]);
      const lock = week > today ? "Editable until 3am, then locked for the week." : "Locked until Sunday.";
      return reply(env, msg, `Set for the week of ${dayMonth(week)}. ${lock}\n/log takes numbers in this order: ${parsed.goals.map((g) => g.title).join(", ")}`);
    }

    case "/log": {
      const goals = await myGoals(env, me.id, mondayOf(today));
      if (!goals.length) return reply(env, msg, "You have no goals this week. Set them with /goals.");
      if (!args.length) return reply(env, msg, todayText(goals, await loggedToday(env, me.id, today), today));

      const parsed = parseLog(args, goals);
      if (parsed.error) return reply(env, msg, parsed.error);

      await env.DB.batch(parsed.entries.map(([g, n]) =>
        env.DB.prepare("INSERT INTO logs (goal_id, day, amount) VALUES (?, ?, ?) ON CONFLICT(goal_id, day) DO UPDATE SET amount = excluded.amount")
          .bind(g.id, today, n)));
      return reply(env, msg, todayText(goals, await loggedToday(env, me.id, today), today));
    }
  }
}

// ---- cron ------------------------------------------------------------------

async function scheduled(event, env) {
  const today = logicalDay();
  const data = await load(env);
  const has = (u, week) => data.goals.some((g) => g.user_id === u.id && g.week === week);

  switch (event.cron) {
    case "0 16 * * *": { // 21:30 IST: name anyone with a goal not logged today
      const week = mondayOf(today);
      const logged = new Set(data.logs.filter((l) => l.day === today).map((l) => l.goal_id));
      const late = data.users.filter((u) =>
        data.goals.some((g) => g.user_id === u.id && g.week === week && !logged.has(g.id)));
      if (late.length) await say(env, `Not logged yet today: ${late.map(mention).join(", ")}`, true);
      return;
    }
    case "30 2 * * *": { // 08:00 IST: yesterday's standings. On Monday that is last week's final.
      const through = addDays(today, -1);
      return say(env, boardText(standings(data, through), through, false));
    }
    case "30 14 * * SUN": { // 20:00 IST Sunday: plan next week
      const missing = data.users.filter((u) => !has(u, addDays(today, 1)));
      const text = "Sunday planning. Set next week's goals with /goals, they lock at 3am.";
      const who = missing.length ? `Still to set: ${missing.map(mention).join(", ")}` : "Everyone is set.";
      return say(env, `${text}\n${who}`, true);
    }
  }
}

export default {
  scheduled,

  async fetch(req, env) {
    // Anyone can POST to a workers.dev URL. Telegram sends this header back on
    // every update, so this check is what keeps strangers out of the database.
    if (req.headers.get("x-telegram-bot-api-secret-token") !== env.SECRET) {
      return new Response("no", { status: 401 });
    }
    const msg = (await req.json()).message;
    if (!msg?.text?.startsWith("/")) return new Response("ok");

    try {
      // Only the one group counts. Anywhere else, hand back the chat id,
      // which is also how you find GROUP_ID during setup.
      if (String(msg.chat.id) !== env.GROUP_ID) {
        await reply(env, msg, `This bot only works in its own group. This chat's id is ${msg.chat.id}`);
      } else {
        await handle(msg, env);
      }
    } catch (e) {
      // Still answer 200, or Telegram retries the same update forever.
      console.log("update failed", e.stack);
    }
    return new Response("ok");
  },
};
