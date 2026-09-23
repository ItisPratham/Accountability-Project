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
