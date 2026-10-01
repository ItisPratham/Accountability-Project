// node test.js
// No framework. Prints "all good" or throws at the first broken case.
import assert from "node:assert/strict";
import * as core from "./src/core.js";

const { logicalDay, addDays, mondayOf, daysBetween, scoreGoal, scoreWeek,
  goalWeek, parseGoals, parseLog, standings, memberChecks, steps } = core;

const near = (got, want, what) =>
  assert.ok(Math.abs(got - want) < 1e-9, `${what}: got ${got}, wanted ${want}`);

// ---- days ------------------------------------------------------------------

const at = (iso) => logicalDay(Date.parse(iso));
assert.equal(at("2026-09-21T17:30:00Z"), "2026-09-21", "23:00 IST Mon is Mon");
assert.equal(at("2026-09-21T20:30:00Z"), "2026-09-21", "02:00 IST Tue is still Mon");
assert.equal(at("2026-09-21T22:30:00Z"), "2026-09-22", "04:00 IST Tue is Tue");

assert.equal(mondayOf("2026-09-20"), "2026-09-14", "Sunday belongs to the week before");
assert.equal(mondayOf("2026-09-21"), "2026-09-21", "Monday is its own week");
assert.equal(mondayOf("2026-09-23"), "2026-09-21", "Wednesday");
assert.equal(addDays("2026-09-30", 1), "2026-10-01", "month rollover");
assert.deepEqual(daysBetween("2026-09-21", "2026-09-23"),
  ["2026-09-21", "2026-09-22", "2026-09-23"], "inclusive range");
assert.deepEqual(daysBetween("2026-09-23", "2026-09-21"), [], "empty when reversed");

// ---- scoring ---------------------------------------------------------------

near(scoreGoal([45, 45, 45], 45), 1, "hit target every day");
near(scoreGoal([0, 0, 0], 45), 0, "logged nothing");
near(scoreGoal([], 45), 0, "no days yet");
near(scoreGoal([22.5, 22.5], 45), 0.5, "half every day");
near(scoreGoal([90], 45), 1, "overshoot still caps at 1");
near(scoreGoal([90, 0], 45), 1, "surplus covers the next day");
near(scoreGoal([180, 0, 0], 45), 2 / 3, "bank holds one day, not two");
near(scoreGoal([0, 90], 45), 0.5, "a short day is never repaired");
near(scoreGoal([30, 45], 45), (30 / 45 + 1) / 2, "partial credit");
near(scoreGoal([30, 0], 45), 30 / 45 / 2, "no surplus, nothing carries");

near(scoreWeek([
  { weight: 60, target: 45, amounts: [45] },
  { weight: 40, target: 10, amounts: [5] },
]), 80, "60 full plus 40 at half");
near(scoreWeek([
  { weight: 50, target: 45, amounts: [0, 0] },
  { weight: 50, target: 3, amounts: [3, 3] },
]), 50, "one goal ignored all week");

// ---- the weekly lock -------------------------------------------------------

assert.equal(goalWeek("2026-09-20", true), "2026-09-21", "Sunday edits next week");
assert.equal(goalWeek("2026-09-20", false), "2026-09-21", "Sunday joiner starts Monday");
assert.equal(goalWeek("2026-09-23", false), "2026-09-21", "Wednesday joiner gets this week");
assert.equal(goalWeek("2026-09-23", true), null, "locked midweek once set");
assert.equal(goalWeek("2026-09-21", true), null, "locked on Monday too");

// ---- parsing ---------------------------------------------------------------

const good = parseGoals("dsa 40 45 min\ngym 30 1 session\nread 30 20 pages of a book");
assert.equal(good.error, undefined, "valid goals parse");
assert.equal(good.goals.length, 3);
assert.deepEqual(good.goals[2], { pos: 3, title: "read", weight: 30, target: 20, unit: "pages of a book" });

// the ways people actually type them
const one = (line, want, what) => {
  const r = parseGoals(line);
  assert.equal(r.error, undefined, `${what}: ${r.error}`);
  const { title, weight, target, unit } = r.goals[0];
  assert.deepEqual({ title, weight, target, unit }, want, what);
};
const dsa = { title: "dsa", weight: 100, target: 45, unit: "min" };
one("dsa 100% 45 min", dsa, "percent sign");
one("dsa 100 % 45 min", dsa, "spaced percent");
one("dsa - 100% - 45 min", dsa, "dash separators");
one("dsa — 100% — 45 min", dsa, "em dashes");
one("1. dsa: 100%, 45min.", dsa, "numbered, colon, comma, glued unit, full stop");
one("- dsa 100 45 mins.", { ...dsa, unit: "mins" }, "bullet and trailing dot");
one("• dsa 45 min 100%", dsa, "percent makes order free");
one("leetcode problems 100% 3 problems",
  { title: "leetcode-problems", weight: 100, target: 3, unit: "problems" }, "multi-word name");
one("leet-code 100 3 problems",
  { title: "leet-code", weight: 100, target: 3, unit: "problems" }, "hyphen inside name");
one("meditate 100% 1", { title: "meditate", weight: 100, target: 1, unit: "" }, "unit optional");
one("sleep 100% 7.5 hours", { title: "sleep", weight: 100, target: 7.5, unit: "hours" }, "decimal target");
assert.equal(parseGoals("a 33.33% 1 x\nb 33.33% 1 x\nc 33.34% 1 x").error, undefined, "decimal weights");

const bad = (body, what) => assert.ok(parseGoals(body).error, what);
bad("dsa 40 45 min\ngym 30 1 session", "weights short of 100");
bad("dsa 100", "no target");
bad("dsa 100 0 min", "zero target");
bad("dsa 100.5 45 min", "weights over 100");
bad("dsa -10 45 min\ngym 110 1 x", "negative weight");
bad("45 100 45 min", "no name");
bad("dsa 40% 60% 45 min", "two percents");
bad("dsa 40 45 min 3", "three numbers");
bad("dsa 50 45 min\nDSA 50 1 x", "duplicate names, any case");
bad("a 20 1 x\nb 20 1 x\nc 20 1 x\nd 20 1 x\ne 10 1 x\nf 10 1 x", "six goals");
bad("   \n  ", "empty");

const gs = good.goals;
const amounts = (args) => parseLog(args, gs).entries.map(([, n]) => n);
assert.deepEqual(amounts(["45", "1", "20"]), [45, 1, 20], "positional");
assert.deepEqual(amounts(["45min,", "1,", "20."]), [45, 1, 20], "glued units and commas");
assert.deepEqual(amounts(["45", "min", "1", "session", "20", "pages"]), [45, 1, 20], "unit words ignored");
assert.deepEqual(amounts(["2.5", "0", "0"]), [2.5, 0, 0], "decimals and zeros");
assert.deepEqual(parseLog(["GYM", "1"], gs).entries.map(([g, n]) => [g.title, n]), [["gym", 1]], "named, any case");
assert.deepEqual(parseLog(["dsa:", "45min"], gs).entries.map(([g, n]) => [g.title, n]), [["dsa", 45]], "named, punctuated");
assert.ok(parseLog(["45", "1"], gs).error, "too few numbers");
assert.ok(parseLog(["45", "-1", "2"], gs).error, "negative");
assert.ok(parseLog(["yoga", "30"], gs).error, "unknown goal");
assert.ok(parseLog(["dsa", "lots"], gs).error, "named but no number");
assert.deepEqual(parseLog(["45"], [gs[0]]).entries.map(([, n]) => n), [45], "single goal positional");

// ---- standings -------------------------------------------------------------

// Week of Mon 2026-09-21, scored through Wed 09-23.
const users = [
  { id: 1, name: "A", joined_on: "2026-09-01" }, // perfect so far
  { id: 2, name: "B", joined_on: "2026-09-23" }, // joined Wednesday
  { id: 3, name: "C", joined_on: "2026-09-01" }, // forgot Sunday, set goals Wednesday
  { id: 4, name: "D", joined_on: "2026-09-01" }, // no goals this week at all
];
const goals = [
  { id: 10, user_id: 1, week: "2026-09-21", weight: 100, target: 10 },
  { id: 20, user_id: 2, week: "2026-09-21", weight: 100, target: 10 },
  { id: 30, user_id: 3, week: "2026-09-21", weight: 100, target: 10 },
  { id: 11, user_id: 1, week: "2026-09-14", weight: 100, target: 10 }, // A last week
  { id: 41, user_id: 4, week: "2026-09-14", weight: 100, target: 10 }, // D last week
];
const logs = [
  ...["2026-09-21", "2026-09-22", "2026-09-23"].map((day) => ({ goal_id: 10, day, amount: 10 })),
  { goal_id: 20, day: "2026-09-23", amount: 10 },
  { goal_id: 30, day: "2026-09-23", amount: 10 },
  { goal_id: 11, day: "2026-09-14", amount: 35 }, // banks 10, covers Tue only
];
const rows = standings({ users, goals, logs }, "2026-09-23");
const by = Object.fromEntries(rows.map((r) => [r.user.name, r]));

assert.deepEqual(rows.map((r) => r.user.name), ["A", "B", "C"], "tie on 100 broken by history, D absent");
near(by.A.score, 100, "A perfect");
assert.equal(by.A.days, 3);
near(by.A.allTime, 200 / 7, "A last week: Mon + banked Tue out of 7");
near(by.B.score, 100, "joiner scored from their first day");
assert.equal(by.B.days, 1);
assert.equal(by.B.allTime, null, "joiner has no history");
near(by.C.score, 100 / 3, "late setter eats Mon and Tue");
assert.equal(by.C.days, 3);
assert.equal(standings({ users, goals, logs }, "2026-09-20")[0].user.name, "A",
  "Sunday through-date scores the week that is ending");

// ---- step sizes ------------------------------------------------------------

assert.deepEqual(steps(45), [1, 10], "45 min");
assert.deepEqual(steps(20), [1, 5], "20 pages");
assert.deepEqual(steps(100), [1, 20], "100 reps");
assert.deepEqual(steps(10000), [1, 2000], "10000 steps");
assert.deepEqual(steps(1), [0.5, 1], "1 session");
assert.deepEqual(steps(7.5), [0.5, 1], "7.5 hours");

// ---- membership ------------------------------------------------------------

// Morning of Wed 2026-09-30, so Tue 09-29 is the last sealed day.
const TODAY = "2026-09-30";
const m = (id, active_on, extra = {}) => ({ id, name: `m${id}`, active_on, ...extra });
const who = (members, data = {}) => {
  const r = memberChecks({ members, goals: [], logs: [], ...data }, TODAY);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.map((x) => x.id)]));
};
const none = { warn: [], remove: [], cheer: [] };

assert.deepEqual(who([m(1, "2026-09-25")]), none, "4 idle days: fine");
assert.deepEqual(who([m(1, "2026-09-24")]), { ...none, warn: [1] }, "5 idle days: warned");
assert.deepEqual(who([m(1, "2026-09-23", { warned_on: "2026-09-29" })]), none, "warned yesterday, 6 idle: wait");
assert.deepEqual(who([m(1, "2026-09-22", { warned_on: "2026-09-28" })]), { ...none, remove: [1] }, "7 idle, warned 2 days ago: out");
assert.deepEqual(who([m(1, "2026-09-20")]), { ...none, warn: [1] }, "missed the day-5 check: warn first, never straight to removal");
assert.deepEqual(who([m(1, "2026-09-20", { warned_on: "2026-09-29" })]), none, "warned only yesterday: still 2 days' grace");
assert.deepEqual(who([m(1, "2026-09-29", { warned_on: "2026-09-27" })]), none, "logged after the warning: cleared");
assert.deepEqual(who([m(1, "2026-09-01", { kicked_on: "2026-09-10" })]), none, "removed members are skipped");
assert.deepEqual(who([m(1, TODAY)]), none, "joined today");

// the 50% nudge: window is Thu 09-25 .. Tue 09-29
const cg = [
  { id: 1, user_id: 1, week: "2026-09-28", weight: 60, target: 10 },
  { id: 2, user_id: 1, week: "2026-09-28", weight: 40, target: 10 },
  { id: 3, user_id: 1, week: "2026-09-21", weight: 100, target: 10 },
];
const L = (goal_id, day, amount) => ({ goal_id, day, amount });
assert.deepEqual(who([m(1, "2026-09-29")], { goals: cg, logs: [L(1, "2026-09-29", 5), L(3, "2026-09-26", 4)] }),
  { ...none, cheer: [1] }, "logging, best day 40: nudged");
assert.deepEqual(who([m(1, "2026-09-29")], { goals: cg, logs: [L(1, "2026-09-29", 5), L(2, "2026-09-29", 5)] }),
  none, "one day at exactly 50: fine");
assert.deepEqual(who([m(1, "2026-09-29")], { goals: cg, logs: [L(3, "2026-09-25", 10), L(1, "2026-09-29", 1)] }),
  none, "a full day last week, still inside the window: fine");
assert.deepEqual(who([m(1, "2026-09-29", { cheered_on: "2026-09-27" })], { goals: cg, logs: [L(1, "2026-09-29", 1)] }),
  none, "nudged 3 days ago: not again yet");
assert.deepEqual(who([m(1, "2026-09-29", { cheered_on: "2026-09-25" })], { goals: cg, logs: [L(1, "2026-09-29", 1)] }),
  { ...none, cheer: [1] }, "nudged 5 days ago: again");
assert.deepEqual(who([m(1, "2026-09-29")], { goals: cg, logs: [L(1, "2026-09-20", 1)] }),
  none, "no logs inside the window: that's the idle rule's job");

console.log("all good");
