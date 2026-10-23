// node test-bot.js
// Drives the real worker end to end: an in-memory SQLite stands in for D1 and a
// fake Telegram records what the bot sends. Every outgoing message is also
// checked to be valid Telegram HTML, whatever users typed into it.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// ---- fakes -----------------------------------------------------------------

const sql = new DatabaseSync(":memory:");
sql.exec("PRAGMA foreign_keys = ON;" + readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const rows = (q, p = []) => sql.prepare(q).all(...p).map((r) => ({ ...r }));
const stmt = (q, p = []) => ({
  bind: (...a) => stmt(q, a),
  all: async () => ({ results: rows(q, p) }),
  run: async () => sql.prepare(q).run(...p),
  exec: () => (/^\s*select/i.test(q) ? { results: rows(q, p) } : sql.prepare(q).run(...p)),
});
const env = {
  DB: { prepare: (q) => stmt(q), batch: async (list) => list.map((s) => s.exec()) },
  SECRET: "s3cret", GROUP_ID: "-100123", BOT_TOKEN: "x",
};

let calls = [];
let botMsg = 5000; // ids of the bot's own messages
const TAGS = /<\/?(b|i|code|pre)>|<a href="tg:\/\/user\?id=\d+">|<\/a>/g;
globalThis.fetch = async (url, init) => {
  const method = url.split("/").pop();
  const body = JSON.parse(init.body);
  if (method === "sendMessage" || method === "editMessageText") {
    assert.equal(body.parse_mode, "HTML");
    assert.ok(!/[<>]|&(?!amp;|lt;|gt;)/.test(body.text.replace(TAGS, "")), `bad html: ${body.text}`);
  }
  calls.push({ method, ...body });
  const result = method === "sendMessage" ? { message_id: ++botMsg } : true;
  return { json: async () => ({ ok: true, result }) };
};

let now;
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
};
const at = (ist) => { now = RealDate.parse(`2026-${ist}:00+05:30`); };

const { default: bot } = await import("./src/index.js");

// What a person sees: tags gone, mentions as @Name.
const plain = (t) => t.replace(/<a [^>]*>([^<]*)<\/a>/g, "@$1").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const texts = () => calls.filter((c) => c.method === "sendMessage").map((c) => plain(c.text));

let id = 0;
async function send(from, text, { chat = -100123, type = "supergroup", secret = "s3cret", ...extra } = {}) {
  calls = [];
  const res = await bot.fetch(new Request("https://bot/", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify({ message: { message_id: ++id, chat: { id: chat, type }, from, text, ...extra } }),
  }), env);
  return Object.assign(texts(), {
    status: res.status,
    id,
    asks: calls.some((c) => c.reply_markup?.force_reply),
    deleted: calls.filter((c) => c.method === "deleteMessage").map((c) => c.message_id),
  });
}
// Reply to the bot's last message, as tapping "reply" in Telegram would.
const answer = (from, text, botSaid) =>
  send(from, text, { reply_to_message: { message_id: botMsg, from: { is_bot: true }, text: botSaid } });
// Press an inline button on one of the bot's messages.
async function tap(from, data, message_id = botMsg) {
  calls = [];
  await bot.fetch(new Request("https://bot/", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret" },
    body: JSON.stringify({ callback_query: { id: "q", from, data, message: { message_id, chat: { id: -100123 } } } }),
  }), env);
  const edit = calls.find((c) => c.method === "editMessageText");
  return {
    toast: calls.find((c) => c.method === "answerCallbackQuery"),
    edit: edit && plain(edit.text),
    buttons: edit?.reply_markup?.inline_keyboard.flat().map((b) => b.text),
    sent: texts(),
  };
}
const goalId = (u, title) => rows("SELECT id FROM goals WHERE user_id = ? AND title = ? ORDER BY week DESC", [u.id, title])[0].id;
const loggedOn = (gid, day) => rows("SELECT amount FROM logs WHERE goal_id = ? AND day = ?", [gid, day])[0]?.amount;
const join = (u) => send(u, undefined, { new_chat_members: [{ ...u, is_bot: false }] });
async function cron(expr) {
  calls = [];
  await bot.scheduled({ cron: expr }, env);
  return texts();
}
const NUDGE = "0 16 * * *", MORNING = "30 2 * * *", SUNDAY = "30 14 * * SUN";

const A = { id: 1, first_name: "Asha" }, B = { id: 2, first_name: "Bo" }, C = { id: 3, first_name: "Cy" };
const G = { id: 4, first_name: "Ghost" }, O = { id: 5, first_name: "Owner" };
const X = { id: 6, first_name: "<b>Evil & Co" };
let r;

// ---- Sunday 20 Sept: setting goals -----------------------------------------

at("09-20T18:00");
r = await send(A, "/setgoals");
assert.ok(r.asks && /^@Asha\nReply to this message with your goals for the week of 21/.test(r[0]), "bare /setgoals asks, by name");
assert.deepEqual(r.deleted, [r.id], "the bare command is cleaned up");
let question = botMsg;
r = await answer(A, "dsa 60 45 min\ngym 30 1 session", r[0]);
assert.ok(r.asks && /dsa 60 \+ gym 30 = 90/.test(r[0]), "bad weights: explains and asks again");
assert.deepEqual(r.deleted, [question, r.id], "the old question and the failed attempt are cleaned up");
question = botMsg;
r = await answer(A, "1. dsa - 60% - 45min.\n2. gym: 40%, 1 session", r[0]);
assert.deepEqual(r.deleted, [question], "on success only the question goes: the answer and confirmation stay");
assert.match(r[0], /Set for the week of 21[\s\S]*1\. dsa · 45 min a day · 60%[\s\S]*2\. gym · 1 session a day · 40%/, "messy reply accepted");
assert.match((await send(B, "/goals@acc_bot read 100% 20 pages"))[0], /Set for the week of 21/, "one-message form still works");
assert.match((await send(G, "/setgoals nap 100% 1"))[0], /nap · 1 a day · 100%/, "unit optional");
await join(O);
assert.match((await send(A, "/goals"))[0], /Next week, from 21[\s\S]*Asha[\s\S]*Bo[\s\S]*Ghost/, "/goals lists everyone");

at("09-21T01:30"); // Monday 1:30am is still Sunday
assert.match((await send(A, "/setgoals dsa 70% 45 min\ngym 30% 1 session"))[0], /Editable until 3am/, "editable until 3am");

// ---- the week: logging, the lock, the 3am line -----------------------------

at("09-21T10:00");
assert.match((await send(A, "/setgoals"))[0], /locked until Sunday/, "locked on Monday, and doesn't ask");
r = await send(A, "/log");
assert.match(r[0], /^@Asha\nMon 21 Sept\ndsa: not logged[\s\S]*Reply to this message with today's numbers, in this order: dsa, gym/, "bare /log opens the form");
assert.deepEqual(calls[0].reply_markup.inline_keyboard.map((row) => row.map((b) => b.text)), [
  ["dsa: 0 / 45 min"], ["−10", "−5", "Half", "Full", "+5", "+10"],
  ["gym: 0 / 1 session"], ["−1", "−0.5", "Half", "Full", "+0.5", "+1"],
  ["Done"],
], "a stepper per goal, then Done");
assert.deepEqual(r.deleted, [r.id], "the bare /log is cleaned up");
r = await answer(A, "90 min", r[0]);
assert.ok(r.asks && /Send 2 numbers[\s\S]*Like: \/log 45 1/.test(r[0]), "one number short: asks again");
assert.match((await answer(A, "90min, 1", r[0]))[0], /Mon 21[\s\S]*dsa: 90\/45 min\ngym: 1\/1 session/, "reply logs");
// tapping the form
await send(B, "/log");
const read = goalId(B, "read");
const DAY = "2026-09-21";
r = await tap(B, `s:${read}:-5:${DAY}`);
assert.equal(loggedOn(read, DAY), 0, "stepping down from nothing stops at 0");
r = await tap(B, `t:${read}:${DAY}`);
assert.match(r.edit, /read: 20\/20 pages/, "Full jumps to the target and redraws");
assert.ok(r.buttons.includes("read: 20 / 20 pages"), "the label shows the running value");
assert.equal(r.toast.text, "read: 20");
r = await tap(B, `t:${read}:${DAY}`);
assert.equal(r.edit, undefined, "no redraw when nothing changed");
await tap(B, `h:${read}:${DAY}`);
assert.equal(loggedOn(read, DAY), 10, "Half is half the target");
await tap(B, `t:${read}:${DAY}`);
await tap(B, `s:${read}:5:${DAY}`);
r = await tap(B, `s:${read}:-1:${DAY}`);
assert.equal(loggedOn(read, DAY), 24, "20 + 5 - 1, saved on every tap");
assert.deepEqual(calls.find((c) => c.method === "editMessageText").reply_markup.inline_keyboard[1].map((b) => b.style),
  ["danger", "danger", "primary", "success", "primary", "primary"], "solid colours");

r = await tap(A, `s:${read}:5:${DAY}`);
assert.ok(r.toast.show_alert && /not your form/.test(r.toast.text), "can't step someone else's goal");
r = await tap(A, `d:${B.id}:${DAY}`);
assert.ok(r.toast.show_alert && /not your form/.test(r.toast.text), "or finish their form");
r = await tap(B, `s:${read}:5:2026-09-20`);
assert.ok(r.toast.show_alert && /earlier day/.test(r.toast.text), "yesterday's form is dead");
assert.equal(loggedOn(read, DAY), 24, "none of that changed anything");

r = await tap(B, `d:${B.id}:${DAY}`);
assert.equal(r.edit, "@Bo\nMon 21 Sept\nread: 24/20 pages", "Done leaves just the log");
assert.equal(calls.find((c) => c.method === "editMessageText").reply_markup, undefined, "and takes the buttons away");

r = await tap(B, "f");
assert.match(r.sent[0], /^@Bo\nMon 21 Sept\nread: 24\/20 pages/, "the Log today button opens your own form");
r = await tap(C, "f");
assert.ok(r.toast.show_alert && /no goals this week/.test(r.toast.text) && !r.sent.length, "no goals, no form");

r = await send(B, "/log 10");
assert.match(r[0], /read: 10\/20 pages/);
assert.deepEqual(r.deleted, [], "a one-message log that works leaves everything alone");
assert.match((await send(B, "/log read 25"))[0], /read: 25\/20 pages/, "logging again replaces");
assert.equal((await send(A, "nice work everyone")).length, 0, "plain chat ignored");
assert.equal((await send(A, "3 9", { reply_to_message: { from: { is_bot: false }, text: "Reply to this message with today's numbers" } })).length, 0,
  "a reply to a person is not an answer to the bot");

at("09-22T02:30"); // Tuesday 2:30am still counts as Monday
assert.match((await send(A, "/log gym 0"))[0], /Mon 21[\s\S]*gym: 0\/1/, "3am grace");
at("09-22T21:00");
assert.match((await send(A, "/log 0 1"))[0], /Tue 22/);

at("09-23T12:00");
assert.match((await send(C, "/log 5"))[0], /no goals this week/, "can't log without goals");
assert.match((await send(C, "/setgoals run 100% 3 km"))[0], /Set for the week of 21[\s\S]*Locked until Sunday/, "midweek joiner sets now");
await send(C, "/log 3");
// a weekly goal
assert.match((await send(O, "/setgoals gym 100% 3 sessions a week"))[0], /gym · 3 sessions a week · 100%/, "weekly goal");
assert.match((await send(O, "/log 1"))[0], /gym: 1 today · 1\/3 sessions this week/, "weekly log shows the week's total");
await send(O, "/log");
assert.deepEqual(calls[0].reply_markup.inline_keyboard.map((row) => row.map((b) => b.text)), [
  ["gym: 1 today, 1 / 3 sessions this week"], ["−1", "−0.5", "+0.5", "+1"], ["Done"],
], "weekly goals get steps but no Half or Full");
assert.match((await send(X, "/setgoals a<b 100% 1 x&y"))[0], /a<b · 1 x&y a day/, "html in names and goals is escaped");

// Asha: dsa 70 x (Mon full, Tue banked, Wed 0) + gym 30 x (Tue only) = 57. Bo: 1.25/3 = 42.
r = (await send(A, "/board"))[0];
assert.match(r, /today still open[\s\S]*1\. Cy  100 · 1d\n2\. Owner  100 · 1d\n3\. Asha  57  🔥2\n4\. Bo  42\n/, `board: ${r}`);

r = await tap(A, `d:${A.id}:2026-09-23`);
assert.equal(r.edit, "@Asha\nWed 23 Sept\ndsa: 0/45 min\ngym: 0/1 session", "Done counts untouched goals as 0");
assert.equal(loggedOn(goalId(A, "dsa"), "2026-09-23"), 0);

// ---- who the bot answers ---------------------------------------------------

r = await send(A, "/log 45 1", { chat: 999, type: "private" });
assert.equal(calls.length, 0, "silent in DMs");
await send(A, "/help", { chat: -100777 });
assert.deepEqual(calls.map((c) => c.method), ["leaveChat"], "leaves other groups");
env.GROUP_ID = "0";
await send(A, undefined, { chat: -100888, new_chat_members: [{ id: 9 }] });
assert.equal(calls.length, 0, "setup mode: stays put, only logs the id");
env.GROUP_ID = "-100123";
assert.equal((await send(A, "/log 45 1", { secret: "wrong" })).status, 401, "webhook secret required");
assert.match((await join({ id: 7, first_name: "Dee" }))[0], /^Welcome, @Dee\.[\s\S]*Set your goals/, "welcome");

// ---- scheduled posts -------------------------------------------------------

at("09-23T21:30");
r = await cron(NUDGE);
assert.deepEqual(r.map((t) => t.split("\n")[0]), ["@Bo", "@Ghost", "@<b>Evil & Co"], "a form for each person with something unlogged");
assert.ok(r.every((t) => /Use the buttons[\s\S]*Today so far\nCy: run 3 km\nOwner: gym 1 sessions$/.test(t)), `social proof: ${r[0]}`);
assert.ok(calls.every((c) => c.reply_markup.inline_keyboard.at(-1)[0].text === "Done"), "each with its own buttons");
at("09-24T08:00");
r = await cron(MORNING);
assert.match(r[0], /^Week of 21 Sept\nthrough Wed 23/, "morning standings");
assert.equal(r.length, 1, "nothing else in the morning");

// ---- Sunday: repeat or carry over ------------------------------------------

at("09-27T20:00");
r = await cron(SUNDAY);
assert.match(r[0], /Still to set: .*@Ghost/, "Sunday reminder");
assert.equal(calls[0].reply_markup.inline_keyboard[0][0].callback_data, "r", "with a Same as this week button");
r = await tap(A, "r");
assert.match(r.sent[0], /^@Asha\nSame again for the week of 28 Sept\n1\. dsa · 45 min a day · 70%\n2\. gym · 1 session a day · 30%/, "repeats this week's goals");
assert.equal(r.toast.text, "Set");
r = await tap({ id: 8, first_name: "New" }, "r");
assert.ok(r.toast.show_alert && /no goals this week/.test(r.toast.text), "nothing to repeat");
assert.match((await send(A, "/goals"))[0], /Next week, from 28[\s\S]*Asha/, "listed for next week");

at("09-28T08:00");
r = await cron(MORNING);
// Owner: 1 of 3 sessions, prorated to Wed..Sun = 1 / (3 * 5/7) = 47.
assert.match(r[0], /^Final, week of 21 Sept\n\n1\. Owner  47 · 5d\n2\. Asha  24\n/, "Monday posts last week's final");
assert.equal(r[1], "Same goals as last week for @Bo, @Cy, @Owner.", "then carries over whoever logged but didn't reset. Asha already had, Ghost and Evil never logged");
assert.match((await send(B, "/log 5"))[0], /Mon 28 Sept\nread: 5\/20 pages/, "carried goals are live");
assert.match((await send(C, "/setgoals run 100% 10 km"))[0], /locked until Sunday/, "and locked like any other");
assert.match((await send(G, "/log 1"))[0], /no goals this week/, "Ghost was not carried");

at("09-29T08:00");
assert.equal((await cron(MORNING)).length, 1, "carry-over only on Monday");
at("10-04T18:00"); // Sunday
r = await tap(A, "r");
assert.match(r.sent[0], /Same again for the week of 5 Oct/);
at("10-05T10:00"); // Monday
r = await tap(A, "r");
assert.ok(r.toast.show_alert && /set on Sunday/.test(r.toast.text), "the button only works on Sunday");

console.log("bot ok");
