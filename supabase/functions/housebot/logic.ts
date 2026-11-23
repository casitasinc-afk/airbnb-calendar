// Pure Housebot rules. No network, no secrets. The edge function and the tests both use this.

export const LIMITS = {
  message: 800,
  name: 60,
  hostReply: 2000,
  perHour: 12,
  perSession: 60,
  perIpHour: 30,
  history: 40,
  replyMax: 1500,
};

export type Listing = { name: string; kind: string };
export type KbEntry = { listing: string; topic: string; body: string; sort?: number };
export type ModelReply = { reply: string; known: boolean; needs_host: boolean };
export type QuotaRow = { window_start: string; window_count: number; hits?: number; msg_count?: number };

const FALLBACK: Record<string, string> = {
  en: "I don't have that in my notes. The host team will reply here soon.",
  cs: "Tohle v poznámkách nemám. Tým hostitele sem brzy odpoví.",
  de: "Das steht nicht in meinen Notizen. Das Gastgeber-Team antwortet hier bald.",
  uk: "Цього немає в моїх нотатках. Команда господарів скоро відповість тут.",
  sk: "Toto v poznámkach nemám. Tím hostiteľa sem čoskoro odpovie.",
  pl: "Nie mam tego w notatkach. Zespół gospodarzy wkrótce tu odpowie.",
  fr: "Je n'ai pas ça dans mes notes. L'équipe des hôtes répondra ici bientôt.",
  es: "No tengo eso en mis notas. El equipo anfitrión responderá aquí pronto.",
  it: "Non ho questa informazione nelle note. Il team risponderà qui a breve.",
  nl: "Dit staat niet in mijn notities. Het hostteam antwoordt hier snel.",
  ru: "Этого нет в моих заметках. Команда хозяев скоро ответит здесь.",
};

const UNAVAILABLE: Record<string, string> = {
  en: "Housebot can't reach the host just now. Please message the host on Airbnb.",
  cs: "Housebot se teď k hostiteli nedostane. Napište prosím hostiteli na Airbnb.",
  de: "Housebot erreicht die Gastgeber gerade nicht. Bitte schreiben Sie ihnen über Airbnb.",
  uk: "Housebot зараз не може зв’язатися з господарями. Напишіть їм в Airbnb.",
  sk: "Housebot sa teraz k hostiteľovi nedostane. Napíšte prosím hostiteľovi na Airbnb.",
  pl: "Housebot nie może teraz skontaktować się z gospodarzem. Napisz do gospodarza na Airbnb.",
  fr: "Housebot ne joint pas l'hôte pour le moment. Écrivez à l'hôte sur Airbnb.",
  es: "Housebot no puede contactar al anfitrión ahora. Escriba al anfitrión en Airbnb.",
  it: "Housebot non riesce a contattare l'host in questo momento. Scrivete all'host su Airbnb.",
  nl: "Housebot kan de host nu niet bereiken. Stuur de host een bericht via Airbnb.",
  ru: "Housebot сейчас не может связаться с хозяевами. Напишите им в Airbnb.",
};

const RATE: Record<string, string> = {
  en: "That's a lot of messages for now. Please wait a little, or message the host on Airbnb.",
  cs: "Teď přišlo hodně zpráv. Chvíli počkejte, nebo napište hostiteli na Airbnb.",
  de: "Das sind für den Moment viele Nachrichten. Bitte kurz warten oder den Gastgebern über Airbnb schreiben.",
  uk: "Зараз забагато повідомлень. Зачекайте трохи або напишіть господарям в Airbnb.",
  sk: "Teraz prišlo veľa správ. Chvíľu počkajte, alebo napíšte hostiteľovi na Airbnb.",
  pl: "To na razie dużo wiadomości. Poczekaj chwilę albo napisz do gospodarza na Airbnb.",
  fr: "C'est beaucoup de messages pour le moment. Patientez un peu, ou écrivez à l'hôte sur Airbnb.",
  es: "Son muchos mensajes por ahora. Espere un poco o escriba al anfitrión en Airbnb.",
  it: "Sono tanti messaggi per ora. Attendete un poco, oppure scrivete all'host su Airbnb.",
  nl: "Dat zijn voor nu veel berichten. Wacht even, of stuur de host een bericht via Airbnb.",
  ru: "Сейчас слишком много сообщений. Подождите немного или напишите хозяевам в Airbnb.",
};

const ACCESS_WORD = /lock\s*box|key\s*box|keybox|lockbox|door\s*code|gate\s*code|entry\s*code|access\s*code|\bpin\s*code\b|keypad/i;
const ASK_ACCESS = /lock\s*box|key\s*box|keybox|lockbox|door\s*code|gate\s*code|entry\s*code|access\s*code|\bpin\b|keypad|klíč|klic\b|schrán|schrank|key\s*safe|lock\s*code/i;
const SECRET_TOKEN = /\b\d{3,8}\b/;
const PASSWORD_LEAK = /(?:password|heslo|hasło|passwort|mot de passe|contraseña|wachtwoord|пароль)\s*(?:is|je|ist|es|to|:|–|-)?\s*["“']?([^\s"'“”,.]{3,})/gi;

export function langKey(lang: string): string {
  const l = String(lang || "").toLowerCase();
  if (l.startsWith("cs") || l === "cz" || l.startsWith("ces")) return "cs";
  if (l.startsWith("de")) return "de";
  if (l.startsWith("uk") || l === "ua" || l.startsWith("ua-")) return "uk";
  if (l.startsWith("sk")) return "sk";
  if (l.startsWith("pl")) return "pl";
  if (l.startsWith("fr")) return "fr";
  if (l.startsWith("es")) return "es";
  if (l.startsWith("it")) return "it";
  if (l.startsWith("nl")) return "nl";
  if (l.startsWith("ru")) return "ru";
  return "en";
}

function pick(table: Record<string, string>, lang: string): string {
  return table[langKey(lang)] || table.en;
}

export function fallbackReply(lang: string): string {
  return pick(FALLBACK, lang);
}
export function unavailableReply(lang: string): string {
  return pick(UNAVAILABLE, lang);
}
export function rateReply(lang: string): string {
  return pick(RATE, lang);
}

export function validUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ""));
}

export function cleanName(raw: string): string | null {
  const n = String(raw || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.length > LIMITS.name) return null;
  return n;
}

export function cleanMessage(raw: string, max = LIMITS.message): string | null {
  const n = String(raw || "").replace(/\u0000/g, "").trim();
  if (!n || n.length > max) return null;
  return n;
}

export function canonicalListing(raw: string, listings: Listing[]): Listing | null {
  const n = String(raw || "").trim().toLowerCase();
  if (!n || n.length > 80) return null;
  return listings.find((l) => l.name.toLowerCase() === n) || null;
}

export function asksForAccess(text: string): boolean {
  return ASK_ACCESS.test(String(text || ""));
}

export function entryHasSecret(body: string): boolean {
  const s = String(body || "");
  return ACCESS_WORD.test(s) && SECRET_TOKEN.test(s);
}

export function replyLeaksSecret(reply: string, kb: string): boolean {
  const text = String(reply || "");
  if (ACCESS_WORD.test(text) || ASK_ACCESS.test(text)) return true;
  const hay = String(kb || "").toLowerCase();
  PASSWORD_LEAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PASSWORD_LEAK.exec(text))) {
    const token = m[1];
    if (token && !hay.includes(token.toLowerCase())) return true;
  }
  return false;
}

export function knowledgeText(listing: Listing, entries: KbEntry[]): string {
  const clean = (entries || [])
    .filter((e) => e && e.body && !entryHasSecret(e.body))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const own = clean.filter((e) => e.listing && e.listing.toLowerCase() === listing.name.toLowerCase());
  const ownTopics = new Set(own.map((e) => e.topic));
  const shared = clean.filter((e) => !String(e.listing || "").trim() && !ownTopics.has(e.topic));
  const kindLine = listing.kind === "house"
    ? `${listing.name} is a house in Prague (Smíchov), not a houseboat, and it is not in the marina parking lot.`
    : `${listing.name} is a houseboat at the marina in Prague (Smíchov).`;
  const lines = [`Property: ${kindLine}`];
  for (const e of shared) lines.push(`- ${e.topic}: ${e.body.trim()}`);
  for (const e of own) lines.push(`- ${e.topic} (this property): ${e.body.trim()}`);
  return lines.join("\n").slice(0, 12000);
}

export function systemPrompt(opts: { listing: Listing; guest: string; lang: string; kb: string }): string {
  return [
    "You are Housebot, the guest assistant for the host's houseboats and houses in Prague (Smíchov).",
    `The guest is asking about: ${opts.listing.name} (${opts.listing.kind}).`,
    `The guest's name is: ${opts.guest}.`,
    `Reply in the language of the guest's latest message. If that language is unclear, reply in this language: ${opts.lang || "en"}.`,
    "Use only the knowledge base below. Do not use outside knowledge about the property, the address, Wi-Fi, parking spots, or how to get in.",
    "If the knowledge base does not contain the fact, set known to false and needs_host to true. The reply must say you do not have it in your notes and the host team will reply in this chat soon. Do not guess.",
    "If the guest wants the host to decide something (early check-in, late check-out, extra guests, a problem in the property, a refund, a broken appliance), set needs_host to true. You may explain a rule that is written below. End with one sentence that the host team will confirm in this chat.",
    "Never reveal, invent, or hint at a lockbox, keybox, door, gate, or PIN code. If asked, set known to false and needs_host to true, and do not include any code or the words lockbox or keybox.",
    "Never invent a Wi-Fi name or password. If the notes say NOT SET, or do not give one, set known to false and needs_host to true.",
    "A line that says NOT SET means you do not know that fact.",
    "Keep the reply short, warm, and plain text. No headings, no bullet lists unless the guest asked for steps that are written below.",
    "",
    "Knowledge base:",
    opts.kb,
  ].join("\n");
}

export function parseModelJson(text: string): ModelReply | null {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(s.slice(start, end + 1));
    if (!j || typeof j.reply !== "string") return null;
    return { reply: j.reply, known: j.known === true, needs_host: j.needs_host === true };
  } catch {
    return null;
  }
}

export function decideAnswer(opts: { parsed: ModelReply | null; kb: string; userText: string; lang: string }): { reply: string; escalated: boolean } {
  const fb = fallbackReply(opts.lang);
  if (asksForAccess(opts.userText)) return { reply: fb, escalated: true };
  if (!opts.parsed || !String(opts.parsed.reply || "").trim()) return { reply: fb, escalated: true };
  const reply = String(opts.parsed.reply).trim().slice(0, LIMITS.replyMax);
  if (replyLeaksSecret(reply, opts.kb) || /NOT SET/i.test(reply)) return { reply: fb, escalated: true };
  const escalated = opts.parsed.known === false || opts.parsed.needs_host === true;
  return { reply, escalated };
}

export function nextQuota(row: QuotaRow, now: number, kind: "session" | "ip"): { allow: boolean; window_start: string; window_count: number; msg_count: number } {
  const start = Date.parse(row.window_start || "");
  const fresh = !Number.isFinite(start) || now - start >= 3600_000;
  const window_start = fresh ? new Date(now).toISOString() : row.window_start;
  const used = fresh ? 0 : Number(kind === "ip" ? row.hits || 0 : row.window_count || 0);
  const cap = kind === "ip" ? LIMITS.perIpHour : LIMITS.perHour;
  const life = Number(row.msg_count || 0);
  if (used >= cap || (kind === "session" && life >= LIMITS.perSession)) {
    return { allow: false, window_start, window_count: used, msg_count: life };
  }
  return { allow: true, window_start, window_count: used + 1, msg_count: life + (kind === "session" ? 1 : 0) };
}

export function sessionIdOf(raw: string): string | null {
  const s = String(raw || "").trim().replace(/^hb:/i, "");
  return validUuid(s) ? s.toLowerCase() : null;
}

export function inboxSummary(messages: { role: string; body: string; created_at?: string; escalated?: boolean; by_name?: string | null }[], status: string): { summary: string; original: string; at: string } {
  const list = messages || [];
  const escalated = list.filter((m) => m.role === "guest" && m.escalated);
  const guests = list.filter((m) => m.role === "guest");
  const question = escalated[escalated.length - 1] || guests[guests.length - 1];
  const host = [...list].reverse().find((m) => m.role === "host");
  const at = (status === "replied" && host && host.created_at) || (question && question.created_at) || (list[list.length - 1] && list[list.length - 1].created_at) || new Date().toISOString();
  let summary = question ? question.body : "";
  if (host) summary += `\n\n— Host: ${host.body}`;
  const original = list.slice(-10).map((m) => {
    const who = m.role === "guest" ? "Guest" : m.role === "host" ? "Host" + (m.by_name ? ` (${m.by_name})` : "") : "Housebot";
    return `${who}: ${m.body}`;
  }).join("\n");
  return { summary, original, at };
}
