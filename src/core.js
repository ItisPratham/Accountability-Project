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

/** goals: [{ weight, target, amounts }], weights total 100. Returns 0 to 100. */
export const scoreWeek = (goals) =>
  goals.reduce((total, g) => total + g.weight * scoreGoal(g.amounts, g.target), 0);

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

/**
 * One goal per line: a name, then a weight and a daily target, then an
 * optional unit. With % on the weight the order after the name is free.
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

    goals.push({ pos: i + 1, title: toks.slice(0, at).join("-"), weight, target, unit: unit.join(" ") });
  }

  const total = goals.reduce((s, g) => s + g.weight, 0);
  if (Math.abs(total - 100) > 0.01) {
    return { error: `Weights add up to ${+total.toFixed(2)}, they need to make exactly 100.` };
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
    return { error: `Send ${goals.length} numbers, in this order: ${goals.map((g) => g.title).join(", ")}` };
  }
  return { entries: goals.map((g, i) => [g, ns[i]]) };
}

// ---- standings -------------------------------------------------------------

/**
 * Ranked rows for the week containing `through`, scored up to `through`.
 * data is the three tables as plain rows: { users, goals, logs }.
 * Each row: { user, score, days, allTime }. allTime is the mean of finished
 * past weeks (weeks with no goals set are skipped), or null.
 *
 * ponytail: rescores every past week from raw rows on each call. Fine for a
 * friend group for years; store weekly finals in a table if it ever drags.
 */
export function standings({ users, goals, logs }, through) {
  const amount = new Map(logs.map((l) => [`${l.goal_id}|${l.day}`, l.amount]));

  const weekScore = (user, week, end) => {
    const gs = goals.filter((g) => g.user_id === user.id && g.week === week);
    const start = user.joined_on > week ? user.joined_on : week;
    if (!gs.length || start > end) return null;
    const days = daysBetween(start, end);
    const score = scoreWeek(gs.map((g) => ({
      weight: g.weight,
      target: g.target,
      amounts: days.map((d) => amount.get(`${g.id}|${d}`) ?? 0),
    })));
    return { score, days: days.length };
  };

  const week = mondayOf(through);
  const pastWeeks = [...new Set(goals.map((g) => g.week))].filter((w) => w < week);

  return users
    .flatMap((user) => {
      const now = weekScore(user, week, through);
      if (!now) return [];
      const past = pastWeeks.map((w) => weekScore(user, w, addDays(w, 6))).filter(Boolean);
      const allTime = past.length ? past.reduce((s, p) => s + p.score, 0) / past.length : null;
      return [{ user, ...now, allTime }];
    })
    .sort((a, b) => b.score - a.score || (b.allTime ?? 0) - (a.allTime ?? 0));
}
