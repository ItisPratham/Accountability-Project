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

const num = (s) => {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** One goal per line: `name weight target unit...`. Returns { goals } or { error }. */
export function parseGoals(body) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 5) return { error: "Send 1 to 5 goals, one per line." };

  const goals = [];
  for (const [i, line] of lines.entries()) {
    const [title, w, t, ...unit] = line.split(/\s+/);
    const weight = Number(w);
    const target = num(t);
    if (!unit.length || !Number.isInteger(weight) || weight <= 0 || !target) {
      return { error: `Line ${i + 1} should look like: dsa 40 45 min` };
    }
    if (num(title) !== null) return { error: `A goal can't be called "${title}".` };
    goals.push({ pos: i + 1, title, weight, target, unit: unit.join(" ") });
  }

  const total = goals.reduce((s, g) => s + g.weight, 0);
  if (total !== 100) return { error: `Weights add up to ${total}, they need to make exactly 100.` };
  if (new Set(goals.map((g) => g.title.toLowerCase())).size !== goals.length) {
    return { error: "Two goals have the same name." };
  }
  return { goals };
}

/**
 * `/log 45 3 20` sets every goal in order, `/log dsa 45` sets one.
 * Returns { entries: [[goal, amount]] } or { error }.
 */
export function parseLog(args, goals) {
  if (args.length === 2 && num(args[0]) === null) {
    const goal = goals.find((g) => g.title.toLowerCase() === args[0].toLowerCase());
    const n = num(args[1]);
    if (!goal) return { error: `You have no goal called "${args[0]}".` };
    if (n === null) return { error: `"${args[1]}" isn't a number.` };
    return { entries: [[goal, n]] };
  }
  const ns = args.map(num);
  if (ns.length !== goals.length || ns.includes(null)) {
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
