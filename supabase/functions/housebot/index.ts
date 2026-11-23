// Housebot chat. OpenAI is called only here. OPENAI_API_KEY is a function secret.
// Guests never see lockbox codes: the model is grounded on housebot_knowledge, access
// questions skip the model, and replies are filtered again before they are stored.
import bundled from "./knowledge.json" with { type: "json" };
import {
  LIMITS,
  asksForAccess,
  canonicalListing,
  cleanMessage,
  cleanName,
  decideAnswer,
  fallbackReply,
  inboxSummary,
  knowledgeText,
  nextQuota,
  parseModelJson,
  rateReply,
  sessionIdOf,
  systemPrompt,
  unavailableReply,
  type KbEntry,
  type Listing,
  type ModelReply,
} from "./logic.ts";

type Gate = { ok: true } | { ok: false; error: string };

const MODEL_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "housebot_reply",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        reply: { type: "string" },
        known: { type: "boolean" },
        needs_host: { type: "boolean" },
      },
      required: ["reply", "known", "needs_host"],
    },
  },
};

function envUrl(): string {
  return (Deno.env.get("SUPABASE_URL") || "https://pamzwqmjeizcieciaijf.supabase.co").replace(/\/$/, "");
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.default || parsed.service_role || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

function anonKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

function presentedKey(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  const bearer = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
  return bearer || (req.headers.get("apikey") || "").trim();
}

function keyAllowed(presented: string): boolean {
  if (!presented) return false;
  const anon = anonKey();
  if (anon && presented === anon) return true;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.values(parsed).includes(presented);
  } catch {
    return false;
  }
}

function allowOrigin(origin: string): string {
  if (!origin) return "";
  if (origin === "https://casitasinc-afk.github.io") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return origin;
  const extra = (Deno.env.get("HOUSEBOT_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return extra.includes(origin) ? origin : "";
}

function corsHeaders(origin: string): Headers {
  const h = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "origin",
  });
  const allowed = allowOrigin(origin);
  if (allowed) {
    h.set("access-control-allow-origin", allowed);
    h.set("access-control-allow-headers", "authorization, apikey, content-type");
    h.set("access-control-allow-methods", "POST, OPTIONS");
    h.set("access-control-max-age", "86400");
  }
  return h;
}

function json(status: number, body: unknown, origin: string): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

class DbError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super("db");
    this.status = status;
    this.detail = detail;
  }
}

function missingTable(detail: unknown): boolean {
  const s = JSON.stringify(detail ?? "");
  return s.includes("PGRST205") || s.includes("42P01") || s.includes("does not exist");
}

function adminHeaders(prefer?: string): Headers {
  const key = serviceKey();
  const h = new Headers({ apikey: key, "content-type": "application/json" });
  if (key.split(".").length === 3) h.set("authorization", `Bearer ${key}`);
  if (prefer) h.set("prefer", prefer);
  return h;
}

async function db(path: string, method: string, body?: unknown, prefer?: string): Promise<unknown> {
  const res = await fetch(`${envUrl()}/rest/v1/${path}`, {
    method,
    headers: adminHeaders(prefer),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 180) };
    }
  }
  if (!res.ok) throw new DbError(res.status, data);
  return data;
}

async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const pepper = Deno.env.get("HOUSEBOT_IP_PEPPER") || "housebot-v1";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pepper}|${ip}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function loadKnowledge(): Promise<{ listings: Listing[]; entries: KbEntry[] }> {
  const fallback = bundled as { listings: Listing[]; entries: KbEntry[] };
  try {
    const rows = await db("housebot_knowledge?select=listing,topic,body,sort&order=sort.asc", "GET") as KbEntry[];
    if (!Array.isArray(rows) || !rows.length) return fallback;
    const names = new Map<string, Listing>();
    for (const l of fallback.listings || []) names.set(l.name.toLowerCase(), l);
    for (const row of rows) {
      const name = String(row.listing || "").trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), { name, kind: "houseboat" });
    }
    return { listings: [...names.values()], entries: rows };
  } catch (err) {
    if (err instanceof DbError && missingTable(err.detail)) return fallback;
    throw err;
  }
}

async function pinGate(pin: string): Promise<Gate> {
  if (!String(pin || "").trim()) return { ok: false, error: "pin_not_set" };
  const anon = anonKey();
  const res = await fetch(`${envUrl()}/rest/v1/rpc/get_msg_counts`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ p_pin: String(pin) }),
  });
  const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (data && data.ok === true) return { ok: true };
  if (data && data.error) return { ok: false, error: String(data.error) };
  return { ok: false, error: "pin_invalid" };
}

async function bumpIp(hash: string, now: number): Promise<boolean> {
  let row: { ip_hash: string; window_start: string; hits: number } | null = null;
  try {
    const rows = await db(`housebot_ip_window?ip_hash=eq.${hash}&select=ip_hash,window_start,hits`, "GET") as { ip_hash: string; window_start: string; hits: number }[];
    row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (err) {
    if (err instanceof DbError && missingTable(err.detail)) return true;
    throw err;
  }
  const quota = nextQuota({ window_start: row?.window_start || new Date(now).toISOString(), hits: row?.hits || 0, window_count: 0 }, now, "ip");
  if (!quota.allow) return false;
  if (!row) {
    try {
      await db("housebot_ip_window", "POST", { ip_hash: hash, window_start: quota.window_start, hits: quota.window_count }, "return=minimal");
    } catch (err) {
      if (!(err instanceof DbError) || err.status !== 409) throw err;
    }
  } else {
    await db(`housebot_ip_window?ip_hash=eq.${hash}`, "PATCH", { window_start: quota.window_start, hits: quota.window_count }, "return=minimal");
  }
  return true;
}

type Session = {
  id: string;
  listing: string;
  guest_name: string;
  lang: string;
  status: string;
  window_start: string;
  window_count: number;
  msg_count: number;
  last_at?: string;
};

async function loadSession(id: string): Promise<Session | null> {
  const rows = await db(`housebot_sessions?id=eq.${id}&select=id,listing,guest_name,lang,status,window_start,window_count,msg_count,last_at`, "GET") as Session[];
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function openaiReply(messages: unknown[]): Promise<ModelReply | null> {
  const key = Deno.env.get("OPENAI_API_KEY") || "";
  if (!key) return null;
  const model = Deno.env.get("HOUSEBOT_MODEL") || "gpt-5-mini";
  const send = async (extra: Record<string, unknown>) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(25000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: 900,
        ...extra,
      }),
    });
    const text = await res.text();
    return { status: res.status, text };
  };
  let res = await send({ reasoning_effort: "minimal", response_format: MODEL_SCHEMA });
  if (res.status === 400 && /reasoning_effort|temperature|unsupported/i.test(res.text)) {
    res = await send({ response_format: MODEL_SCHEMA });
  }
  if (res.status === 400 && /response_format|json_schema/i.test(res.text)) {
    res = await send({ response_format: { type: "json_object" } });
  }
  if (res.status >= 400) {
    console.log(JSON.stringify({ housebot: "openai", status: res.status }));
    return null;
  }
  let content = "";
  try {
    const parsed = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] };
    content = parsed.choices?.[0]?.message?.content || "";
  } catch {
    return null;
  }
  return parseModelJson(content);
}

function calendarItem(session: Session, messages: { role: string; body: string; created_at?: string; escalated?: boolean; by_name?: string | null }[]) {
  const view = inboxSummary(messages, session.status);
  const waiting = session.status === "waiting";
  return {
    id: `hb:${session.id}`,
    hb_session: session.id,
    kind: "housebot",
    guest_name: session.guest_name,
    listing: session.listing,
    start_date: "",
    end_date: "",
    last_msg_at: view.at,
    last_msg_summary: view.summary,
    last_msg_original: view.original && view.original !== view.summary ? view.original : "",
    last_msg_lang: session.lang || "",
    status: "open",
    urgent: waiting,
    confirmation_code: "",
    drafts: [{
      key: "_meta",
      last_by_role: "guest",
      last_by_name: "Housebot",
      cls: waiting ? "red" : "yellow",
      cls_reason: "Housebot",
    }],
  };
}

async function handleChat(req: Request, body: Record<string, unknown>, origin: string): Promise<Response> {
  const lang = String(body.lang || req.headers.get("accept-language") || "en").slice(0, 40);
  const pack = await loadKnowledge();
  const listing = canonicalListing(String(body.listing || ""), pack.listings);
  const guest = cleanName(String(body.guest_name || ""));
  const message = cleanMessage(String(body.message || ""));
  const sid = sessionIdOf(String(body.session_id || ""));
  if (!listing || !guest || !message || !sid) {
    return json(400, { ok: false, error: "bad_request", reply: unavailableReply(lang) }, origin);
  }
  const now = Date.now();
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "").split(",")[0].trim();
  if (ip && !(await bumpIp(await ipHash(req), now))) {
    return json(429, { ok: false, error: "rate_limited", reply: rateReply(lang) }, origin);
  }
  let session = await loadSession(sid);
  const quota = nextQuota({
    window_start: session?.window_start || new Date(now).toISOString(),
    window_count: session?.window_count || 0,
    msg_count: session?.msg_count || 0,
  }, now, "session");
  if (!quota.allow) return json(429, { ok: false, error: "rate_limited", reply: rateReply(lang) }, origin);

  const patch = {
    listing: listing.name,
    guest_name: guest,
    lang,
    last_at: new Date(now).toISOString(),
    window_start: quota.window_start,
    window_count: quota.window_count,
    msg_count: quota.msg_count,
  };
  if (!session) {
    try {
      await db("housebot_sessions", "POST", { id: sid, status: "chat", ...patch }, "return=minimal");
      session = { id: sid, status: "chat", ...patch };
    } catch (err) {
      if (!(err instanceof DbError) || err.status !== 409) throw err;
      session = await loadSession(sid);
      if (!session) throw err;
    }
  } else {
    await db(`housebot_sessions?id=eq.${sid}`, "PATCH", patch, "return=minimal");
    session = { ...session, ...patch };
  }

  const inserted = await db("housebot_messages", "POST", {
    session_id: sid,
    role: "guest",
    body: message,
    escalated: false,
  }, "return=representation") as { id?: string }[] | { id?: string };
  const insertedRow = Array.isArray(inserted) ? inserted[0] : inserted;
  const guestMsgId = insertedRow && insertedRow.id ? insertedRow.id : "";

  const finish = async (reply: string, escalated: boolean) => {
    if (escalated) {
      if (guestMsgId) await db(`housebot_messages?id=eq.${guestMsgId}`, "PATCH", { escalated: true }, "return=minimal");
      await db(`housebot_sessions?id=eq.${sid}`, "PATCH", { status: "waiting", last_at: new Date().toISOString() }, "return=minimal");
    }
    await db("housebot_messages", "POST", { session_id: sid, role: "assistant", body: reply, escalated: false }, "return=minimal");
    return json(200, { ok: true, reply, escalated }, origin);
  };

  try {
    const kb = knowledgeText(listing, pack.entries);
    if (asksForAccess(message) || !Deno.env.get("OPENAI_API_KEY")) {
      return await finish(fallbackReply(lang), true);
    }
    const history = await db(
      `housebot_messages?session_id=eq.${sid}&select=role,body&order=created_at.asc&limit=12`,
      "GET",
    ) as { role: string; body: string }[];
    const chat: { role: string; content: string }[] = [{
      role: "system",
      content: systemPrompt({ listing, guest, lang, kb }),
    }];
    for (const row of (Array.isArray(history) ? history : []).slice(-8)) {
      const text = String(row.body || "").slice(0, row.role === "guest" ? LIMITS.message : LIMITS.replyMax);
      if (row.role === "guest") chat.push({ role: "user", content: text });
      else if (row.role === "host") chat.push({ role: "assistant", content: "The host already told the guest: " + text });
      else chat.push({ role: "assistant", content: text });
    }
    if (!chat.some((m) => m.role === "user" && m.content === message)) chat.push({ role: "user", content: message });
    const parsed = await openaiReply(chat);
    const decision = decideAnswer({ parsed, kb, userText: message, lang });
    return await finish(decision.reply, decision.escalated);
  } catch (err) {
    console.log(JSON.stringify({ housebot: "chat_failed", missing: err instanceof DbError ? missingTable(err.detail) : false }));
    try {
      return await finish(fallbackReply(lang), true);
    } catch {
      return json(503, { ok: false, error: "unavailable", reply: unavailableReply(lang) }, origin);
    }
  }
}

async function handleHistory(body: Record<string, unknown>, origin: string): Promise<Response> {
  const sid = sessionIdOf(String(body.session_id || ""));
  if (!sid) return json(400, { ok: false, error: "bad_request" }, origin);
  try {
    const session = await loadSession(sid);
    if (!session) return json(200, { ok: true, messages: [] }, origin);
    const rows = await db(
      `housebot_messages?session_id=eq.${sid}&select=role,body,created_at&order=created_at.asc&limit=${LIMITS.history}`,
      "GET",
    );
    return json(200, { ok: true, messages: Array.isArray(rows) ? rows : [], listing: session.listing, guest_name: session.guest_name }, origin);
  } catch (err) {
    if (err instanceof DbError && missingTable(err.detail)) return json(200, { ok: true, messages: [] }, origin);
    return json(503, { ok: false, error: "unavailable" }, origin);
  }
}

async function handleListings(origin: string): Promise<Response> {
  try {
    const pack = await loadKnowledge();
    return json(200, { ok: true, listings: pack.listings }, origin);
  } catch {
    const fallback = bundled as { listings: Listing[] };
    return json(200, { ok: true, listings: fallback.listings || [] }, origin);
  }
}

async function handleInbox(body: Record<string, unknown>, origin: string): Promise<Response> {
  const gate = await pinGate(String(body.pin || ""));
  if (!gate.ok) return json(200, gate, origin);
  try {
    const sessions = await db(
      "housebot_sessions?status=in.(waiting,replied)&select=id,listing,guest_name,lang,status,last_at,housebot_messages(role,body,created_at,escalated,by_name)&order=last_at.desc&limit=50",
      "GET",
    ) as (Session & { housebot_messages?: { role: string; body: string; created_at?: string; escalated?: boolean; by_name?: string | null }[] })[];
    const items = (Array.isArray(sessions) ? sessions : []).map((s) => calendarItem(s, s.housebot_messages || []));
    return json(200, { ok: true, items }, origin);
  } catch (err) {
    if (err instanceof DbError && missingTable(err.detail)) return json(200, { ok: true, items: [] }, origin);
    console.log(JSON.stringify({ housebot: "inbox_failed" }));
    return json(200, { ok: false, error: "unavailable" }, origin);
  }
}

async function handleReply(body: Record<string, unknown>, origin: string, resolve: boolean): Promise<Response> {
  const gate = await pinGate(String(body.pin || ""));
  if (!gate.ok) return json(200, gate, origin);
  const sid = sessionIdOf(String(body.session_id || ""));
  if (!sid) return json(400, { ok: false, error: "bad_request" }, origin);
  try {
    const session = await loadSession(sid);
    if (!session) return json(200, { ok: false, error: "not_found" }, origin);
    if (resolve) {
      await db(`housebot_sessions?id=eq.${sid}`, "PATCH", { status: "resolved", last_at: new Date().toISOString() }, "return=minimal");
      return json(200, { ok: true }, origin);
    }
    const text = cleanMessage(String(body.body || ""), LIMITS.hostReply);
    if (!text) return json(400, { ok: false, error: "bad_request" }, origin);
    const by = cleanName(String(body.by_name || "")) || "";
    await db("housebot_messages", "POST", { session_id: sid, role: "host", body: text, escalated: false, by_name: by || null }, "return=minimal");
    await db(`housebot_sessions?id=eq.${sid}`, "PATCH", { status: "replied", last_at: new Date().toISOString() }, "return=minimal");
    return json(200, { ok: true }, origin);
  } catch (err) {
    if (err instanceof DbError && missingTable(err.detail)) return json(200, { ok: false, error: "not_ready" }, origin);
    return json(200, { ok: false, error: "unavailable" }, origin);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return json(405, { ok: false, error: "method" }, origin);
  if (!keyAllowed(presentedKey(req))) return json(401, { ok: false, error: "unauthorized" }, origin);
  if (!serviceKey()) return json(500, { ok: false, error: "not_configured" }, origin);
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return json(400, { ok: false, error: "bad_request" }, origin);
  }
  if (raw.length > 20000) return json(413, { ok: false, error: "too_large" }, origin);
  let body: Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { ok: false, error: "bad_request" }, origin);
  }
  const action = String(body.action || "");
  try {
    if (action === "listings") return await handleListings(origin);
    if (action === "history") return await handleHistory(body, origin);
    if (action === "chat") return await handleChat(req, body, origin);
    if (action === "inbox") return await handleInbox(body, origin);
    if (action === "reply") return await handleReply(body, origin, false);
    if (action === "resolve") return await handleReply(body, origin, true);
    return json(400, { ok: false, error: "bad_request" }, origin);
  } catch (err) {
    console.log(JSON.stringify({ housebot: "error", action, missing: err instanceof DbError ? missingTable(err.detail) : false }));
    return json(503, { ok: false, error: "unavailable", reply: unavailableReply(String(body.lang || "en")) }, origin);
  }
});
