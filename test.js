// node test.js
// No framework. Prints "all good" or throws at the first broken case.
import assert from "node:assert/strict";
import * as core from "./src/core.js";

const { logicalDay, addDays, mondayOf, daysBetween, scoreGoal, scoreWeek,
  goalWeek, parseGoals, parseLog, standings } = core;

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

const bad = (body, what) => assert.ok(parseGoals(body).error, what);
bad("dsa 40 45 min\ngym 30 1 session", "weights short of 100");
bad("dsa 100 45", "missing unit");
bad("dsa 100 0 min", "zero target");
bad("dsa 100.5 45 min", "fractional weight");
bad("dsa -10 45 min\ngym 110 1 x", "negative weight");
bad("45 100 45 min", "numeric title would break /log");
bad("dsa 50 45 min\nDSA 50 1 x", "duplicate names, any case");
bad("a 20 1 x\nb 20 1 x\nc 20 1 x\nd 20 1 x\ne 10 1 x\nf 10 1 x", "six goals");
bad("   \n  ", "empty");

const gs = good.goals;
assert.deepEqual(parseLog(["45", "1", "20"], gs).entries.map(([, n]) => n), [45, 1, 20], "positional");
assert.deepEqual(parseLog(["GYM", "1"], gs).entries.map(([g, n]) => [g.title, n]), [["gym", 1]], "named, any case");
assert.deepEqual(parseLog(["2.5", "0", "0"], gs).entries.map(([, n]) => n), [2.5, 0, 0], "decimals and zeros");
assert.ok(parseLog(["45", "1"], gs).error, "too few numbers");
assert.ok(parseLog(["45", "-1", "2"], gs).error, "negative");
assert.ok(parseLog(["yoga", "30"], gs).error, "unknown goal");
assert.ok(parseLog(["dsa", "lots"], gs).error, "named but not a number");
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

console.log("all good");
