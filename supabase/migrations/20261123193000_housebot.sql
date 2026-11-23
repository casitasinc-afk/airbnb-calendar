-- Housebot guest chat.
-- Guests and the anon key cannot read these tables. The housebot edge function
-- uses the service role. Owner replies are checked with the same PIN as
-- get_msg_counts, inside the function, before any guest text is returned.
-- Do not store lockbox, keybox, or PIN codes in housebot_knowledge.
-- A row whose body mentions an entry code and a number is dropped before the model sees it.

create table public.housebot_sessions (
  id uuid primary key,
  listing text not null,
  guest_name text not null default '',
  lang text not null default '',
  status text not null default 'chat',
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  window_start timestamptz not null default now(),
  window_count integer not null default 0,
  msg_count integer not null default 0,
  ip_hash text,
  constraint housebot_sessions_status_chk check (status in ('chat', 'waiting', 'replied', 'resolved'))
);

create table public.housebot_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.housebot_sessions (id) on delete cascade,
  role text not null,
  body text not null,
  created_at timestamptz not null default now(),
  escalated boolean not null default false,
  by_name text,
  constraint housebot_messages_role_chk check (role in ('guest', 'assistant', 'host'))
);

create index housebot_messages_session_idx on public.housebot_messages (session_id, created_at);
create index housebot_sessions_inbox_idx on public.housebot_sessions (status, last_at desc);

create table public.housebot_knowledge (
  id bigint generated always as identity primary key,
  listing text not null default '',
  topic text not null,
  body text not null,
  sort integer not null default 0
);

create unique index housebot_knowledge_topic_idx on public.housebot_knowledge (listing, topic);

create table public.housebot_ip_window (
  ip_hash text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

alter table public.housebot_sessions enable row level security;
alter table public.housebot_messages enable row level security;
alter table public.housebot_knowledge enable row level security;
alter table public.housebot_ip_window enable row level security;

alter table public.housebot_sessions force row level security;
alter table public.housebot_messages force row level security;
alter table public.housebot_knowledge force row level security;
alter table public.housebot_ip_window force row level security;

revoke all on table public.housebot_sessions from public, anon, authenticated;
revoke all on table public.housebot_messages from public, anon, authenticated;
revoke all on table public.housebot_knowledge from public, anon, authenticated;
revoke all on table public.housebot_ip_window from public, anon, authenticated;
revoke all on sequence public.housebot_knowledge_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.housebot_sessions to service_role;
grant select, insert, update, delete on table public.housebot_messages to service_role;
grant select, insert, update, delete on table public.housebot_knowledge to service_role;
grant select, insert, update, delete on table public.housebot_ip_window to service_role;
grant usage, select on sequence public.housebot_knowledge_id_seq to service_role;

comment on table public.housebot_knowledge is
  'Guest-safe facts Housebot may repeat. Empty listing means every property. A listing name overrides the same topic for that property. Never put lockbox or PIN codes here.';

insert into public.housebot_knowledge (listing, topic, body, sort) values

  ($hb$$hb$, $hb$place$hb$, $hb$These are the host's houseboats and houses in Prague, Smíchov. Houseboats are at the marina. The houses are Dafni, Podkozi, and Vavrinec: they are houses, not houseboats, and they are not in the marina parking lot. The exact street address and walking directions are not in these notes. If a guest asks for the street address, a map pin, or how to arrive from public transport, say you do not have it and the host team will reply.$hb$, 10),
  ($hb$$hb$, $hb$checkin$hb$, $hb$Check-in is at 15:00 (3:00 p.m.), Europe/Prague time, for every houseboat and every house. The property is ready from 15:00.$hb$, 20),
  ($hb$$hb$, $hb$checkout$hb$, $hb$Check-out is at 10:00 (10:00 a.m.), Europe/Prague time, for every houseboat and every house.$hb$, 30),
  ($hb$$hb$, $hb$early$hb$, $hb$Early check-in before 15:00 is not automatic, and Housebot cannot approve it. If the host agrees, the fee is 5 EUR for each hour before 15:00, paid in the Airbnb app (a payment request arrives there). Explain this rule. The host team confirms whether this stay may arrive early.$hb$, 40),
  ($hb$$hb$, $hb$late$hb$, $hb$Late check-out after 10:00 is not automatic, and Housebot cannot approve it. The host team has to confirm.$hb$, 50),
  ($hb$$hb$, $hb$parking$hb$, $hb$Marina parking for the houseboats: park behind the white line, only in an approved parking spot, take only one spot, and do not park in a spot marked with a company logo. The houses (Dafni, Podkozi, Vavrinec) are not in the marina parking lot. Where a house has a marked spot, the same manners apply: behind the white line, one approved spot, not a company-logo spot. Which exact spot is free, and house-specific parking directions, are not in these notes; the host team will reply.$hb$, 60),
  ($hb$$hb$, $hb$toilet$hb$, $hb$Toilet rule for every property: on arrival, check that the toilet flushes. A blockage found later is at the guest's cost. Toilet paper only — no wet wipes, tissues, food, sanitary pads, or anything else.$hb$, 70),
  ($hb$$hb$, $hb$broken$hb$, $hb$Please report anything broken or damaged as soon as you arrive, in this chat or on Airbnb.$hb$, 80),
  ($hb$$hb$, $hb$rules$hb$, $hb$Rules about pets, smoking, parties, quiet hours, and extra guests are the ones agreed on the Airbnb listing and on the house website. The full text of those rules is not in these notes. If a guest asks whether pets, smoking, parties, or extra people are allowed, do not guess; the host team will confirm.$hb$, 90),
  ($hb$$hb$, $hb$wifi$hb$, $hb$Wi-Fi network name and password: NOT SET. Do not invent a network name or a password. If a guest asks for Wi-Fi, say it is not in your notes and the host team will reply with it. Replace this sentence with the real network name and password guests are allowed to see. A row with the same topic and a listing name overrides this for that property only.$hb$, 100),
  ($hb$$hb$, $hb$access$hb$, $hb$Getting in: Housebot never gives entry codes, and none are stored in these notes. If a guest cannot get in or asks how the door opens, the host team will reply. Do not describe a keypad, a code, or a hidden key.$hb$, 110),
  ($hb$$hb$, $hb$contact$hb$, $hb$The host team answers in this Housebot chat and on Airbnb. Housebot cannot phone the guest, take payment, or change a reservation. Guest messages from the host team are signed by Gabriela and the houseboat team; for the houses, Gabriela and the team.$hb$, 120),
  ($hb$$hb$, $hb$problems$hb$, $hb$If heating, hot water, electricity, or water is not working, Housebot has no repair steps. Apologise briefly and say the host team will reply soon. Do not invent fuse boxes, breaker panels, or reset steps.$hb$, 130)

on conflict (listing, topic) do update
  set body = excluded.body, sort = excluded.sort;

