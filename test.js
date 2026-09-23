// node test.js
// No framework. Prints "all good" or throws at the first broken case.
import assert from "node:assert/strict";
import * as core from "./src/core.js";

const { logicalDay, addDays, mondayOf, daysBetween, scoreGoal, scoreWeek } = core;

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

console.log("all good");
