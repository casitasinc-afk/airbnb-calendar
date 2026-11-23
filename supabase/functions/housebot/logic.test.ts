import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  asksForAccess,
  canonicalListing,
  cleanMessage,
  cleanName,
  decideAnswer,
  entryHasSecret,
  fallbackReply,
  inboxSummary,
  knowledgeText,
  nextQuota,
  parseModelJson,
  replyLeaksSecret,
  sessionIdOf,
  validUuid,
  type KbEntry,
  type Listing,
} from "./logic.ts";

const listings: Listing[] = [
  { name: "Anahita", kind: "houseboat" },
  { name: "Vavrinec", kind: "house" },
];

const entries: KbEntry[] = [
  { listing: "", topic: "checkin", sort: 20, body: "Check-in is at 15:00." },
  { listing: "", topic: "wifi", sort: 100, body: "Wi-Fi network name and password: NOT SET." },
  { listing: "", topic: "access", sort: 110, body: "Housebot never gives entry codes, and none are stored in these notes." },
  { listing: "Anahita", topic: "wifi", sort: 100, body: "Wi-Fi network: MarinaGuest password: RiverLight" },
  { listing: "", topic: "leaked", sort: 1, body: "The lockbox code is 4821." },
];

test("listing names match the calendar snapshot", () => {
  const raw = fs.readFileSync(new URL("../../../data.js", import.meta.url), "utf8");
  const i = raw.indexOf("window.DATA = ");
  const data = JSON.parse(raw.slice(i + "window.DATA = ".length).trim().replace(/;$/, ""));
  const fromData = data.L.map((row: [string, number]) => row[0] + ":" + row[1]);
  const kb = JSON.parse(fs.readFileSync(new URL("./knowledge.json", import.meta.url), "utf8"));
  const fromKb = kb.listings.map((l: Listing) => l.name + ":" + (l.kind === "houseboat" ? 1 : 0));
  assert.deepEqual(fromKb, fromData);
});

test("knowledge file has no entry codes", () => {
  const kb = JSON.parse(fs.readFileSync(new URL("./knowledge.json", import.meta.url), "utf8"));
  for (const e of kb.entries) assert.equal(entryHasSecret(e.body), false, e.topic);
  const sql = fs.readFileSync(new URL("../../migrations/20261123193000_housebot.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on table public\.housebot_messages from/i);
  assert.doesNotMatch(sql, /lockbox code is/i);
});

test("secret knowledge lines are dropped and property wifi overrides the shared line", () => {
  const text = knowledgeText(listings[0], entries);
  assert.equal(text.includes("4821"), false);
  assert.equal(text.includes("lockbox"), false);
  assert.equal(text.includes("RiverLight"), true);
  assert.equal(text.includes("NOT SET"), false);
  const house = knowledgeText(listings[1], entries);
  assert.match(house, /not a houseboat/);
  assert.match(house, /NOT SET/);
});

test("access questions never produce a code", () => {
  assert.equal(asksForAccess("what is the lockbox code?"), true);
  assert.equal(asksForAccess("wifi password please"), false);
  const out = decideAnswer({
    parsed: { reply: "The lockbox code is 4821.", known: true, needs_host: false },
    kb: "Check-in is at 15:00.",
    userText: "lockbox?",
    lang: "en",
  });
  assert.equal(out.escalated, true);
  assert.equal(out.reply.includes("4821"), false);
  assert.match(out.reply, /host team/i);
});

test("invented wifi password is replaced; a password that is in the notes is kept", () => {
  const kb = "Wi-Fi network: MarinaGuest password: RiverLight";
  const invented = decideAnswer({
    parsed: { reply: "The password is Secret99.", known: true, needs_host: false },
    kb,
    userText: "wifi?",
    lang: "de",
  });
  assert.equal(invented.escalated, true);
  assert.match(invented.reply, /Notizen/);
  const real = decideAnswer({
    parsed: { reply: "The password is RiverLight.", known: true, needs_host: false },
    kb,
    userText: "wifi?",
    lang: "en",
  });
  assert.equal(real.escalated, false);
  assert.equal(real.reply.includes("RiverLight"), true);
});

test("unknown answers escalate and check-in facts can be answered", () => {
  const unknown = decideAnswer({
    parsed: { reply: "I don't have the address.", known: false, needs_host: true },
    kb: "Check-in is at 15:00.",
    userText: "what is the street?",
    lang: "cs",
  });
  assert.equal(unknown.escalated, true);
  const known = decideAnswer({
    parsed: { reply: "Check-in is at 15:00.", known: true, needs_host: false },
    kb: "Check-in is at 15:00.",
    userText: "when can I arrive?",
    lang: "en",
  });
  assert.equal(known.escalated, false);
  assert.equal(known.reply, "Check-in is at 15:00.");
});

test("needs_host still escalates when the rule itself is known", () => {
  const out = decideAnswer({
    parsed: { reply: "Early check-in is 5 EUR per hour. The host team will confirm.", known: true, needs_host: true },
    kb: "fee is 5 EUR",
    userText: "can we arrive at 13:00?",
    lang: "en",
  });
  assert.equal(out.escalated, true);
  assert.match(out.reply, /5 EUR/);
});

test("parse, names, quota, and inbox summary", () => {
  assert.deepEqual(parseModelJson("```json\n{\"reply\":\"Hi\",\"known\":true,\"needs_host\":false}\n```"), {
    reply: "Hi",
    known: true,
    needs_host: false,
  });
  assert.equal(parseModelJson("nope"), null);
  assert.equal(cleanName("  Ana   Novak "), "Ana Novak");
  assert.equal(cleanName(""), null);
  assert.equal(cleanMessage("x".repeat(801)), null);
  assert.equal(canonicalListing(" anahita ", listings)?.name, "Anahita");
  assert.equal(canonicalListing("Nope", listings), null);
  assert.equal(validUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(sessionIdOf("hb:550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  const now = Date.parse("2026-11-23T18:00:00Z");
  const first = nextQuota({ window_start: "2026-11-23T17:30:00Z", window_count: 11, msg_count: 11 }, now, "session");
  assert.equal(first.allow, true);
  assert.equal(first.window_count, 12);
  const blocked = nextQuota({ window_start: "2026-11-23T17:30:00Z", window_count: 12, msg_count: 12 }, now, "session");
  assert.equal(blocked.allow, false);
  const reset = nextQuota({ window_start: "2026-11-23T16:00:00Z", window_count: 12, msg_count: 12 }, now, "session");
  assert.equal(reset.allow, true);
  assert.equal(reset.window_count, 1);
  const summary = inboxSummary([
    { role: "guest", body: "Where is the Wi-Fi?", escalated: true, created_at: "2026-11-23T18:01:00Z" },
    { role: "assistant", body: "The host team will reply.", created_at: "2026-11-23T18:01:02Z" },
    { role: "host", body: "Network is on the card.", by_name: "Gabriela", created_at: "2026-11-23T18:20:00Z" },
  ], "replied");
  assert.match(summary.summary, /Where is the Wi-Fi/);
  assert.match(summary.summary, /Network is on the card/);
  assert.match(summary.original, /Host \(Gabriela\)/);
  assert.equal(fallbackReply("cs-CZ").includes("hostitele"), true);
});

test("the static page and the function do not carry the OpenAI key", () => {
  const page = fs.readFileSync(new URL("../../../housebot/index.html", import.meta.url), "utf8");
  const fn = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const kb = JSON.parse(fs.readFileSync(new URL("./knowledge.json", import.meta.url), "utf8"));
  const embedded = page.match(/<script type="application\/json" id="hb-listings">([\s\S]*?)<\/script>/);
  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded[1]), kb.listings);
  assert.equal(page.includes("OPENAI"), false);
  assert.equal(page.includes("service_role"), false);
  assert.match(page, /functions\/v1\/housebot/);
  assert.doesNotMatch(page, /@keyframes|speech|porthole/);
  assert.match(fn, /OPENAI_API_KEY/);
  assert.match(fn, /get_msg_counts/);
  assert.doesNotMatch(fn, /sk-[A-Za-z0-9]{10,}/);
});
