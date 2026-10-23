import {
  logicalDay, addDays, weekday, mondayOf, daysBetween,
  goalWeek, parseGoals, parseLog, standings, steps, carryForward,
} from "./core.js";

// Every message goes out as Telegram HTML, so anything a user typed
// (names, goal titles, units, error text quoting them) must pass through esc().

const GOALS_HELP = `<b>Set your goals</b>
Send /setgoals. The bot asks for them, and you reply with one goal per line:
<code>name  weight%  target  unit</code>

<pre>dsa 40% 45 min
gym 30% 3 sessions a week
read 30% 20 pages</pre>

<b>name</b>: what it is. Spaces become dashes.
<b>weight%</b>: how much it counts. All weights add up to 100.
<b>target</b>: what a full day looks like. End with "a week" (or /week) and it's a full week instead.
<b>unit</b>: min, pages, problems... optional.

So <code>dsa 40% 45 min</code> means DSA is 40% of your score and 45 minutes is a full day. <code>gym 30% 3 sessions a week</code> means 3 sessions across the whole week, whenever.

Up to 5 goals. Set them on Sunday, they lock at 3am Monday for the whole week. Say nothing and last week's goals carry over. Joining midweek? Set them now.`;

const USAGE = `${GOALS_HELP}

<b>Log every day, before 3am</b>
<code>/log</code>  opens a form: adjust each goal with the buttons, tap Done
<code>/log 45 1 20</code>  or type them, one per goal in order
<code>/log dsa 45</code>  update just one goal
Logging again replaces that day's number. Logging 0 still counts as logging.

<b>How scoring works</b>
A daily goal scores what you logged ÷ its target, capped at 100%. A day with no log scores 0. Extra carries over to cover the next day, but only one day's worth. A weekly goal scores the week's total ÷ its target. Your week is the weighted average, and it resets every Monday.
Next to it: <i>avg</i>, your last 4 weeks, and 🔥 your streak, days in a row with a log. One missed day a week doesn't break it.

<b>Check in</b>
<code>/board</code>  this week's standings
<code>/goals</code>  everyone's goals
<code>/help</code>  this message

<b>What's new</b>
• Weekly goals: end the target with "a week", like <code>gym 30% 3 sessions a week</code>
• Forgot Sunday? Tap "Same as this week" on the Sunday post, or do nothing and your goals carry over
• 🔥 streaks on the board, one missed day a week forgiven
• avg is your last 4 weeks, not all time
• At 9:30pm your log form arrives on its own if you haven't logged
• No more warnings or removals. Agree a stake between yourselves instead`;

// ---- telegram --------------------------------------------------------------

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) console.log(method, r.status, JSON.stringify(j));
  return j;
}

const say = (env, text, extra) =>
  tg(env, "sendMessage", { chat_id: env.GROUP_ID, text, parse_mode: "HTML", ...extra });

const reply = (env, msg, text) =>
  tg(env, "sendMessage", {
    chat_id: msg.chat.id,
    text,
    parse_mode: "HTML",
    reply_parameters: { message_id: msg.message_id },
  });

// Tapping a command in Telegram's menu sends it bare, with no room for the
// rest. So a bare /setgoals or /log asks, and the reply to that message is the
// answer. No state kept: the reply is recognised by these phrases in the prompt.
const ASK_GOALS = "Reply to this message with your goals";
const ASK_LOG = "Reply to this message with today's numbers";

const del = (env, chat_id, message_id) => tg(env, "deleteMessage", { chat_id, message_id });

// Ask, then delete the message that led here (a bare command or a failed
// attempt). The question names the person so it's clear whose turn it is and so
// the reply box opens only for them. Once answered the question is deleted too,
// which leaves just the good answer and the confirmation in the chat.
// Deleting other people's messages needs the "Delete messages" admin right;
// without it those calls fail quietly and only the bot's own questions go.
async function ask(env, msg, text, placeholder) {
  await tg(env, "sendMessage", {
    chat_id: msg.chat.id,
    text: `${mention({ id: msg.from.id, name: msg.from.first_name })}\n${text}`,
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: placeholder },
  });
  await del(env, msg.chat.id, msg.message_id);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mention = (u) => `<a href="tg://user?id=${u.id}">${esc(u.name)}</a>`;

// ---- formatting ------------------------------------------------------------

const fmt = (day, opts) =>
  new Date(day).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
const dayMonth = (day) => fmt(day, { day: "numeric", month: "short" });
const shortDay = (day) => fmt(day, { weekday: "short", day: "numeric", month: "short" });

const qty = (n, unit) => (unit ? `${n} ${esc(unit)}` : `${n}`);
const goalLine = (g) =>
  `${g.pos}. ${esc(g.title)} · ${qty(g.target, g.unit)} ${g.weekly ? "a week" : "a day"} · ${+Number(g.weight).toFixed(2)}%`;

function boardText(rows, through, open) {
  const week = mondayOf(through);
  const full = daysBetween(week, through).length;
  const head = weekday(through) === 0 && !open
    ? `<b>Final, week of ${dayMonth(week)}</b>`
    : `<b>Week of ${dayMonth(week)}</b>\nthrough ${shortDay(through)}${open ? ", today still open" : ""}`;
  if (!rows.length) return `${head}\n\nNobody has goals set.`;
  return [head, "", ...rows.map((r, i) =>
    `${i + 1}. <b>${esc(r.user.name)}</b>  ${Math.round(r.score)}` +
    (r.days < full ? ` · ${r.days}d` : "") +
    (r.streak > 1 ? `  🔥${r.streak}` : "") +
    (r.recent === null ? "" : `   <i>avg ${Math.round(r.recent)}</i>`))].join("\n");
}

function goalsText({ users, goals }, today) {
  const weeks = [mondayOf(today)];
  if (weekday(today) === 0) weeks.push(addDays(today, 1));
  const out = [];
  for (const week of weeks) {
    out.push(`<b>${week > today ? "Next week" : "This week"}, from ${dayMonth(week)}</b>`);
    const people = users.filter((u) => goals.some((g) => g.user_id === u.id && g.week === week));
    if (!people.length) out.push("Nobody yet.");
    for (const u of people) {
      out.push("", `<b>${esc(u.name)}</b>`);
      for (const g of goals.filter((g) => g.user_id === u.id && g.week === week)) {
        out.push(goalLine(g));
      }
    }
    out.push("", "");
  }
  return out.join("\n").trim();
}

const welcome = (people) =>
  `Welcome, ${people.map((u) => mention({ id: u.id, name: u.first_name })).join(", ")}. Here's how this works.\n\n${USAGE}`;

// logged: today's amount per goal id. totals: the week's sum per goal id, for the weekly ones.
function todayText(goals, logged, today, totals) {
  return [`<b>${shortDay(today)}</b>`, ...goals.map((g) => {
    const t = logged.has(g.id) ? `${logged.get(g.id)}` : "not logged";
    return g.weekly
      ? `${esc(g.title)}: ${t} today · ${totals.get(g.id) ?? 0}/${qty(g.target, g.unit)} this week`
      : `${esc(g.title)}: ${logged.has(g.id) ? `${t}/${qty(g.target, g.unit)}` : t}`;
  })].join("\n");
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

const insertGoal = (env, userId, week, g) =>
  env.DB.prepare("INSERT INTO goals (user_id, week, pos, title, unit, target, weight, weekly) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(userId, week, g.pos, g.title, g.unit, g.target, g.weight, g.weekly ? 1 : 0);

const upsertLog = (env, goalId, day, amount) =>
  env.DB.prepare("INSERT INTO logs (goal_id, day, amount) VALUES (?, ?, ?) ON CONFLICT(goal_id, day) DO UPDATE SET amount = excluded.amount")
    .bind(goalId, day, amount);

// Someone's goals for the week of `day`, what they logged that day, and the
// week's totals. `text` is the status block every log path replies with.
async function myDay(env, me, day) {
  const week = mondayOf(day);
  const goals = await myGoals(env, me.id, week);
  const [logged, totals] = await Promise.all([
    env.DB.prepare("SELECT l.goal_id, l.amount FROM logs l JOIN goals g ON g.id = l.goal_id WHERE g.user_id = ? AND l.day = ?")
      .bind(me.id, day).all(),
    env.DB.prepare("SELECT l.goal_id, SUM(l.amount) AS total FROM logs l JOIN goals g ON g.id = l.goal_id WHERE g.user_id = ? AND g.week = ? GROUP BY l.goal_id")
      .bind(me.id, week).all(),
  ].map(async (q) => new Map((await q).results.map((r) => [r.goal_id, r.amount ?? r.total]))));
  return { goals, logged, totals, text: todayText(goals, logged, day, totals) };
}

// ---- commands --------------------------------------------------------------

async function handle(msg, env) {
  let text = msg.text.trim();
  // Is this a reply to one of the bot's questions?
  const asked = msg.reply_to_message?.from?.is_bot ? msg.reply_to_message.text ?? "" : "";
  const answering = asked.includes(ASK_GOALS) ? "/setgoals\n" : asked.includes(ASK_LOG) ? "/log " : null;
  if (!text.startsWith("/")) {
    if (!answering) return; // ordinary chat
    text = answering + text;
  }
  if (answering) await del(env, msg.chat.id, msg.reply_to_message.message_id);
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
      return reply(env, msg, boardText(standings(await load(env), today, true), today, true));

    case "/goals":
    case "/setgoals": {
      if (!body && cmd === "/goals") return reply(env, msg, goalsText(await load(env), today));

      const current = await myGoals(env, me.id, mondayOf(today));
      const week = goalWeek(today, current.length > 0);
      if (!week) return reply(env, msg, "Your goals are locked until Sunday.");

      if (!body) {
        return ask(env, msg, `<b>${ASK_GOALS}</b> for the week of ${dayMonth(week)}, one per line:
<pre>dsa 40% 45 min
gym 30% 3 sessions a week
read 30% 20 pages</pre>
That's name, weight %, target, unit. Up to 5 goals, weights add up to 100. A target is per day unless you say "a week".`, "dsa 40% 45 min");
      }
      const parsed = parseGoals(body);
      if (parsed.error) {
        return ask(env, msg, `${esc(parsed.error)}\n\n${ASK_GOALS} to try again.\n\n${GOALS_HELP}`, "dsa 40% 45 min");
      }

      const db = env.DB;
      await db.batch([
        db.prepare("INSERT INTO users (id, name, joined_on) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name")
          .bind(me.id, me.name, today),
        // Only ever next week's untouched rows (Sunday) or nothing (midweek), so no logs hang off them.
        db.prepare("DELETE FROM goals WHERE user_id = ? AND week = ?").bind(me.id, week),
        ...parsed.goals.map((g) => insertGoal(env, me.id, week, g)),
      ]);
      const lock = week > today ? "Editable until 3am, then locked for the week." : "Locked until Sunday.";
      return reply(env, msg, [
        `<b>Set for the week of ${dayMonth(week)}</b>`,
        ...parsed.goals.map(goalLine),
        "",
        lock,
        "Send /log each day and tap your numbers.",
      ].join("\n"));
    }

    case "/log": {
      const goals = await myGoals(env, me.id, mondayOf(today));
      if (!goals.length) return reply(env, msg, "You have no goals this week. Set them with /setgoals.");
      const example = goals.map((g) => g.target).join(" ");
      if (!args.length) {
        await say(env, ...(await logForm(env, me, today)));
        return del(env, msg.chat.id, msg.message_id);
      }
      const parsed = parseLog(args, goals);
      if (parsed.error) return ask(env, msg, `${esc(parsed.error)}\n\n${ASK_LOG} to try again.`, example);

      await env.DB.batch(parsed.entries.map(([g, n]) => upsertLog(env, g.id, today, n)));
      return reply(env, msg, (await myDay(env, me, today)).text);
    }
  }
}

// ---- the log form ----------------------------------------------------------

// Today's status with buttons under each goal: step down, step up, or jump
// straight to half or all of the target. Every tap saves, so an abandoned form loses nothing.
// Done strips the buttons and leaves the day's log. Returns [text, extra] for
// say(), or null if the person has no goals this week.
async function logForm(env, me, today, footer = "") {
  const { goals, logged, totals, text } = await myDay(env, me, today);
  if (!goals.length) return null;
  // Solid colours, since the default buttons are translucent and vanish into
  // some wallpapers. Older Telegram apps ignore `style` and show them as before.
  const rows = goals.flatMap((g) => {
    const [small, big] = steps(g.target);
    const step = (d) => ({
      text: d > 0 ? `+${d}` : `−${-d}`,
      callback_data: `s:${g.id}:${d}:${today}`,
      style: d > 0 ? "primary" : "danger",
    });
    const unit = g.unit ? ` ${g.unit}` : "";
    const label = g.weekly
      ? `${g.title}: ${logged.get(g.id) ?? 0} today, ${totals.get(g.id) ?? 0} / ${g.target}${unit} this week`
      : `${g.title}: ${logged.get(g.id) ?? 0} / ${g.target}${unit}`;
    return [
      [{ text: label, callback_data: "-" }],
      g.weekly
        ? [step(-big), step(-small), step(small), step(big)] // Half and Full of a week make no sense for one day
        : [
          step(-big), step(-small),
          { text: "Half", callback_data: `h:${g.id}:${today}`, style: "primary" },
          { text: "Full", callback_data: `t:${g.id}:${today}`, style: "success" },
          step(small), step(big),
        ],
    ];
  });
  rows.push([{ text: "Done", callback_data: `d:${me.id}:${today}`, style: "success" }]);
  const body = `${mention(me)}\n${text}\n\n` +
    "Use the buttons under each goal, then tap Done.\n" +
    `Rather type? ${ASK_LOG}, in this order: ${esc(goals.map((g) => g.title).join(", "))}` +
    (footer ? `\n\n${footer}` : "");
  return [body, { reply_markup: { inline_keyboard: rows } }];
}

// A button press. callback_data is one of:
//   f                 open the presser's own form
//   r                 repeat: copy the presser's goals to next week (Sunday)
//   s:goal:delta:day  step a goal up or down
//   t:goal:day        set a goal to its target
//   h:goal:day        set a goal to half its target
//   d:user:day        done: drop the buttons, keep the log
async function onTap(tap, env) {
  const today = logicalDay();
  const me = { id: tap.from.id, name: tap.from.first_name };
  const answer = (text, alert = false) =>
    tg(env, "answerCallbackQuery", { callback_query_id: tap.id, text, show_alert: alert });
  const redraw = (text, extra) =>
    tg(env, "editMessageText", {
      chat_id: tap.message.chat.id, message_id: tap.message.message_id, text, parse_mode: "HTML", ...extra,
    });
  const notYours = () => answer("That's not your form. Send /log for yours.", true);
  const [kind, a, b, c] = (tap.data ?? "").split(":");

  if (kind === "f") {
    const form = await logForm(env, me, today);
    if (!form) return answer("You have no goals this week. Send /setgoals.", true);
    await say(env, ...form);
    return answer();
  }

  if (kind === "r") {
    if (weekday(today) !== 0) return answer("Goals are set on Sunday. Send /setgoals then.", true);
    const current = await myGoals(env, me.id, mondayOf(today));
    if (!current.length) return answer("You have no goals this week to repeat. Send /setgoals.", true);
    const week = addDays(today, 1);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM goals WHERE user_id = ? AND week = ?").bind(me.id, week),
      ...current.map((g) => insertGoal(env, me.id, week, g)),
    ]);
    await say(env, [
      `${mention(me)}\n<b>Same again for the week of ${dayMonth(week)}</b>`,
      ...current.map(goalLine),
      "",
      "Editable until 3am, then locked for the week.",
    ].join("\n"));
    return answer("Set");
  }

  if (kind === "d") {
    if (Number(a) !== me.id) return notYours();
    const day = b;
    const { goals, logged } = await myDay(env, me, day);
    // Done means "that's my day": anything left untouched counts as 0. Only for
    // today, though. A sealed day's form just loses its buttons.
    const blank = day === today ? goals.filter((g) => !logged.has(g.id)) : [];
    if (blank.length) await env.DB.batch(blank.map((g) => upsertLog(env, g.id, today, 0)));
    await redraw(`${mention(me)}\n${(await myDay(env, me, day)).text}`); // no keyboard
    return answer("Saved");
  }

  if (!"sth".includes(kind) || kind.length !== 1) return answer();
  if ((kind === "s" ? c : b) !== today) {
    return answer("That form is from an earlier day. Send /log for today's.", true);
  }
  // The goal must be the presser's own and from this week, whatever the button claims.
  const { goals, logged } = await myDay(env, me, today);
  const goal = goals.find((g) => g.id === Number(a));
  if (!goal) return notYours();

  const before = logged.get(goal.id);
  const n = kind === "t" ? goal.target
    : kind === "h" ? +(goal.target / 2).toFixed(2)
    : Math.max(0, +((before ?? 0) + Number(b)).toFixed(2));
  if (!(n >= 0)) return answer();
  await upsertLog(env, goal.id, today, n).run();
  if (before !== n) await redraw(...(await logForm(env, me, today))); // Telegram rejects an edit that changes nothing
  return answer(`${goal.title}: ${n}`);
}

// ---- cron ------------------------------------------------------------------

async function scheduled(event, env) {
  const today = logicalDay();
  const data = await load(env);
  const week = mondayOf(today);
  const mine = (u) => data.goals.filter((g) => g.user_id === u.id && g.week === week);

  switch (event.cron) {
    case "0 16 * * *": { // 21:30 IST: a form for everyone with something unlogged, showing what the others did
      const amount = new Map(data.logs.filter((l) => l.day === today).map((l) => [l.goal_id, l.amount]));
      const late = data.users.filter((u) => mine(u).some((g) => !amount.has(g.id)));
      const proof = data.users.flatMap((u) => {
        const did = mine(u).filter((g) => amount.get(g.id) > 0);
        return did.length ? [`${esc(u.name)}: ${did.map((g) => `${esc(g.title)} ${qty(amount.get(g.id), g.unit)}`).join(", ")}`] : [];
      });
      const footer = proof.length ? `<b>Today so far</b>\n${proof.join("\n")}` : "";
      for (const u of late) await say(env, ...(await logForm(env, u, today, footer)));
      return;
    }
    case "30 2 * * *": { // 08:00 IST: yesterday's standings. On Monday that is last week's final, then goals nobody reset carry over.
      const through = addDays(today, -1);
      await say(env, boardText(standings(data, through), through, false));
      if (weekday(today) !== 1) return;
      const carried = carryForward(data, week);
      if (!carried.length) return;
      await env.DB.batch(carried.map((g) => insertGoal(env, g.user_id, week, g)));
      const who = data.users.filter((u) => carried.some((g) => g.user_id === u.id));
      return say(env, `Same goals as last week for ${who.map(mention).join(", ")}.`);
    }
    case "30 14 * * SUN": { // 20:00 IST Sunday: plan next week
      const next = addDays(today, 1);
      const missing = data.users.filter((u) => !data.goals.some((g) => g.user_id === u.id && g.week === next));
      const text = "Sunday planning. Set next week's goals with /setgoals, or tap the button to keep this week's. They lock at 3am. " +
        "Do nothing and this week's goals carry over, as long as you logged something this week.";
      const who = missing.length ? `Still to set: ${missing.map(mention).join(", ")}` : "Everyone is set.";
      return say(env, `${text}\n${who}`,
        { reply_markup: { inline_keyboard: [[{ text: "Same as this week", callback_data: "r" }]] } });
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
    const update = await req.json();
    const tap = update.callback_query;
    if (tap && String(tap.message?.chat.id) === env.GROUP_ID) {
      try {
        await onTap(tap, env);
      } catch (e) {
        console.log("tap failed", e.stack);
      }
    }
    const msg = update.message;
    if (!msg) return new Response("ok");

    try {
      if (String(msg.chat.id) === env.GROUP_ID) {
        const joined = (msg.new_chat_members ?? []).filter((u) => !u.is_bot);
        if (joined.length) await say(env, welcome(joined));
        else if (msg.text) await handle(msg, env);
      } else {
        // Silent everywhere else. The log line is how you find GROUP_ID during
        // setup (wrangler tail); once it is set, walk out of any other group.
        console.log("ignored chat", msg.chat.id, msg.chat.type);
        if (env.GROUP_ID !== "0" && msg.chat.type !== "private") {
          await tg(env, "leaveChat", { chat_id: msg.chat.id });
        }
      }
    } catch (e) {
      // Still answer 200, or Telegram retries the same update forever.
      console.log("update failed", e.stack);
    }
    return new Response("ok");
  },
};
