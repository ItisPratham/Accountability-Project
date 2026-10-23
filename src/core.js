// Everything in here is pure: no Telegram, no D1. test.js covers all of it.

// ---- days ------------------------------------------------------------------

// IST is UTC+5:30 and a day stays open until 3am IST.
// Both rules collapse into one shift: add 5:30, subtract 3:00, take the date.
const SHIFT_MS = 2.5 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

/** The day a log belongs to. 01:40 IST Tuesday still counts as Monday. */
export const logicalDay = (now = Date.now()) =>
  new Date(now + SHIFT_MS).toISOString().slice(0, 10);

export const addDays = (day, n) =>
  new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

/** Sun=0 ... Sat=6 */
export const weekday = (day) => new Date(day).getUTCDay();

/** Monday of the week containing `day`. This is the goals.week key. */
export const mondayOf = (day) => addDays(day, -((weekday(day) + 6) % 7));

/** Every day from start to end, both included. */
export function daysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- scoring ---------------------------------------------------------------

/**
 * One goal's score for the days given, 0 to 1.
 * amounts: logged per day in order, 0 for a missed day.
 *
 * A day's ratio caps at 1. Overshoot banks raw units forward, but the bank
 * never holds more than one day's target, and a short day is never repaired.
 */
export function scoreGoal(amounts, target) {
  if (amounts.length === 0) return 0;
  let bank = 0;
  let sum = 0;
  for (const logged of amounts) {
    const avail = logged + bank;
    const spent = Math.min(avail, target);
    sum += spent / target;
    bank = Math.min(avail - spent, target);
  }
  return sum / amounts.length;
}

/**
 * A weekly goal: the week's total against the target, capped at 1. Before the
 * week is over the target is prorated to the days scored so far, so 1 of 3
 * sessions by Tuesday is not a 33.
 */
export const scoreWeekly = (amounts, target) =>
  amounts.length ? Math.min(amounts.reduce((s, a) => s + a, 0) / (target * amounts.length / 7), 1) : 0;

/** goals: [{ weight, target, weekly, amounts }], weights total 100. Returns 0 to 100. */
export const scoreWeek = (goals) =>
  goals.reduce((total, g) => total + g.weight * (g.weekly ? scoreWeekly : scoreGoal)(g.amounts, g.target), 0);

// ---- streaks ---------------------------------------------------------------

/**
 * Days in a row with a log (a 0 counts), walking back from `from`. One missed
 * day is forgiven as long as the last forgiven one is at least 7 days later,
 * so a single bad day doesn't reset a streak.
 */
export function streak(loggedDays, from) {
  let n = 0;
  let freeze = null;
  for (let d = from; ; d = addDays(d, -1)) {
    if (loggedDays.has(d)) n++;
    else if (freeze === null || addDays(d, 7) <= freeze) freeze = d;
    else return n;
  }
}

// ---- the weekly lock -------------------------------------------------------

/**
 * Which week a /goals command writes to, or null if locked.
 * Sunday: always next week, and re-sending overwrites.
 * Mon to Sat: this week, but only if you have nothing set yet. That covers a
 * new joiner and anyone who forgot Sunday (who then eats zeros from Monday).
 */
export function goalWeek(today, hasThisWeek) {
  if (weekday(today) === 0) return addDays(today, 1);
  return hasThisWeek ? null : mondayOf(today);
}

// ---- parsing ---------------------------------------------------------------

// People type goals every which way: "dsa - 40% - 45min.", "1. dsa: 40%, 45 min".
// Split on separators and drop stray punctuation. Hyphens inside words
// ("leet-code") survive, bare dashes and bullets do not.
function tokens(text) {
  return text
    .replace(/(\d)\s+%/g, "$1%") // "40 %" -> "40%"
    .replace(/(\d)\/(week|wk)\b/gi, "$1 /$2") // "3/week" -> "3 /week"
    .split(/[\s,;:|=–—]+/)
    .map((t) => t.replace(/[.-]+$/, ""))
    .filter((t) => t && !/^[-*•.]+$/.test(t));
}

// "45", "2.5", ".5", "40%", "45min" -> { n, suffix }. Anything else -> null.
function readNum(t) {
  const m = t.match(/^(\d+(?:\.\d+)?|\.\d+)(%|[a-z]+)?$/i);
  return m && { n: Number(m[1]), suffix: m[2] ?? "" };
}

const EXAMPLE = "dsa 40% 45 min";

// "sessions a week", "pages/week", "3 /wk", "weekly": a weekly target.
const WEEKLY = /(?:^|\s)(?:(?:a|per)\s+)?(?:week|wk|weekly)$|\/(?:week|wk)$/i;

/**
 * One goal per line: a name, then a weight and a target, then an optional
 * unit. A target is per day unless the unit ends in "a week" (or /week).
 * With % on the weight the order after the name is free.
 * Returns { goals } or { error }.
 */
export function parseGoals(body) {
  const lines = body.split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•–—]+|\d+[.)])\s+/, "").trim()) // list markers
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 5) return { error: "Send 1 to 5 goals, one per line." };

  const goals = [];
  for (const [i, line] of lines.entries()) {
    const bad = { error: `Couldn't read line ${i + 1}, "${line}". Write it like: ${EXAMPLE}` };
    const toks = tokens(line);
    const at = toks.findIndex(readNum);
    if (at < 1) return bad; // no name, or no numbers

    let weight;
    const nums = [];
    const unit = [];
    for (const t of toks.slice(at)) {
      const r = readNum(t);
      if (!r) unit.push(t);
      else if (r.suffix === "%") {
        if (weight !== undefined) return bad;
        weight = r.n;
      } else {
        nums.push(r.n);
        if (r.suffix) unit.push(r.suffix);
      }
    }
    if (weight === undefined) weight = nums.shift();
    const target = nums.shift();
    if (nums.length || !(weight > 0) || !(target > 0)) return bad;

    const u = unit.join(" ");
    goals.push({
      pos: i + 1, title: toks.slice(0, at).join("-"), weight, target,
      unit: u.replace(WEEKLY, "").trim(), weekly: WEEKLY.test(u),
    });
  }

  const total = goals.reduce((s, g) => s + g.weight, 0);
  if (Math.abs(total - 100) > 0.01) {
    const sum = goals.map((g) => `${g.title} ${g.weight}`).join(" + ");
    return { error: `Weights must add up to 100, yours make ${sum} = ${+total.toFixed(2)}.` };
  }
  if (new Set(goals.map((g) => g.title.toLowerCase())).size !== goals.length) {
    return { error: "Two goals have the same name." };
  }
  return { goals };
}

/**
 * `/log 45 3 20` sets every goal in order, `/log dsa 45` sets one.
 * Units and punctuation are ignored: `/log 45min, 3 problems` works.
 * Returns { entries: [[goal, amount]] } or { error }.
 */
export function parseLog(args, goals) {
  const toks = tokens(args.join(" "));
  if (toks.length && !readNum(toks[0])) {
    const goal = goals.find((g) => g.title.toLowerCase() === toks[0].toLowerCase());
    const r = toks.slice(1).map(readNum).find(Boolean);
    if (!goal) return { error: `You have no goal called "${toks[0]}".` };
    if (!r) return { error: `Give ${goal.title} a number, like /log ${goal.title} ${goal.target}` };
    return { entries: [[goal, r.n]] };
  }
  const ns = toks.map(readNum).filter(Boolean).map((r) => r.n);
  if (ns.length !== goals.length) {
    return {
      error: `Send ${goals.length} numbers, one per goal in this order: ${goals.map((g) => g.title).join(", ")}\n` +
        `Like: /log ${goals.map((g) => g.target).join(" ")}`,
    };
  }
  return { entries: goals.map((g, i) => [g, ns[i]]) };
}

// ---- standings -------------------------------------------------------------

const RECENT_WEEKS = 4;

/**
 * Ranked rows for the week containing `through`, scored up to `through`.
 * data is the three tables as plain rows: { users, goals, logs }.
 * Each row: { user, score, days, recent, streak }. recent is the mean of the
 * last 4 finished weeks that had goals, or null. `open` means `through` is
 * today and still loggable, so an empty today doesn't count against the streak.
 *
 * ponytail: rescores every past week from raw rows on each call. Fine for a
 * friend group for years; store weekly finals in a table if it ever drags.
 */
export function standings({ users, goals, logs }, through, open = false) {
  const amount = new Map(logs.map((l) => [`${l.goal_id}|${l.day}`, l.amount]));
  const owner = new Map(goals.map((g) => [g.id, g.user_id]));
  const loggedDays = new Map(users.map((u) => [u.id, new Set()]));
  for (const l of logs) loggedDays.get(owner.get(l.goal_id))?.add(l.day);

  const weekScore = (user, week, end) => {
    const gs = goals.filter((g) => g.user_id === user.id && g.week === week);
    const start = user.joined_on > week ? user.joined_on : week;
    if (!gs.length || start > end) return null;
    const days = daysBetween(start, end);
    const score = scoreWeek(gs.map((g) => ({
      weight: g.weight,
      target: g.target,
      weekly: g.weekly,
      amounts: days.map((d) => amount.get(`${g.id}|${d}`) ?? 0),
    })));
    return { score, days: days.length };
  };

  const week = mondayOf(through);
  const since = addDays(week, -7 * RECENT_WEEKS);
  const pastWeeks = [...new Set(goals.map((g) => g.week))].filter((w) => w < week && w >= since);

  return users
    .flatMap((user) => {
      const now = weekScore(user, week, through);
      if (!now) return [];
      const past = pastWeeks.map((w) => weekScore(user, w, addDays(w, 6))).filter(Boolean);
      const recent = past.length ? past.reduce((s, p) => s + p.score, 0) / past.length : null;
      const days = loggedDays.get(user.id);
      const from = open && !days.has(through) ? addDays(through, -1) : through;
      return [{ user, ...now, recent, streak: streak(days, from) }];
    })
    .sort((a, b) => b.score - a.score || (b.recent ?? 0) - (a.recent ?? 0));
}

// ---- carrying goals forward ------------------------------------------------

/**
 * Goals to copy into `week` for everyone who had goals the week before and
 * logged at least once, but has nothing set for `week`. Same rows, new week,
 * no id. Anyone who never logged is left alone, so the board doesn't fill up
 * with people who have drifted off.
 */
export function carryForward({ goals, logs }, week) {
  const prev = addDays(week, -7);
  const logged = new Set(logs.map((l) => l.goal_id));
  const set = new Set(goals.filter((g) => g.week === week).map((g) => g.user_id));
  const last = goals.filter((g) => g.week === prev && !set.has(g.user_id));
  const active = new Set(last.filter((g) => logged.has(g.id)).map((g) => g.user_id));
  return last.filter((g) => active.has(g.user_id)).map(({ id, ...g }) => ({ ...g, week }));
}

// ---- the log form's step sizes ---------------------------------------------

// Nearest "nice" number: 1, 2 or 5 times a power of ten.
function nice(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/**
 * [small, big] steps for the +/- buttons: about 10% and 20% of the target,
 * rounded to clean numbers. 45 min -> 5 and 10, 20 pages -> 2 and 5.
 * Small targets get 0.5 and 1, since a tenth of a session means nothing.
 */
export function steps(target) {
  if (target < 5) return [0.5, 1];
  const small = nice(target * 0.1);
  const big = nice(target * 0.2);
  return [small, big > small ? big : small * 2];
}
