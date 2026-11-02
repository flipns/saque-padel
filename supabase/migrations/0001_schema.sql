-- SAQUE LEAGUE 2026/27 · Esquema inicial
-- Ejecutar en Supabase (SQL Editor o `supabase db push`). Después, ejecutar supabase/seed.sql.

create extension if not exists pgcrypto;

-- ============ Tipos ============
create type division_code as enum ('MASCULINA', 'FEMENINA');
create type phase_kind as enum ('LEVELING', 'RACE');
create type phase_status as enum ('DRAFT', 'GENERATED', 'REVIEWED', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED');
create type pair_status as enum ('ACTIVE', 'INACTIVE', 'WITHDRAWN');
create type registration_status as enum ('PENDING', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'DUPLICATE');
create type match_status as enum (
  'PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'SCHEDULED', 'PLAYED_PENDING_RESULT',
  'RESULT_PENDING_CONFIRMATION', 'DISPUTED', 'COMPLETED', 'WO', 'NOT_PLAYED', 'CANCELLED'
);
create type submission_status as enum ('SUBMITTED', 'CONFIRMED', 'AUTO_CONFIRMED', 'DISPUTED', 'ADMIN_RESOLVED', 'SUPERSEDED');
create type ranking_event_kind as enum ('INITIAL', 'BONUS', 'ADJUSTMENT');
create type quota_status as enum ('PLANNED', 'CONFIRMED');

-- ============ Configuración ============
create table admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  timezone text not null default 'Europe/Madrid',
  registration_deadline_at timestamptz not null,
  season_starts_at timestamptz not null,
  may_results_deadline_at timestamptz not null,
  masters_starts_on date not null,
  masters_ends_on date not null,
  registration_form_url text,
  entry_fee_per_player numeric(8,2) not null default 10,
  prize jsonb not null default '{}'::jsonb,       -- {amount, currency, type, provider, award_scope, status}
  rules jsonb not null default '{}'::jsonb,       -- se mezcla con DEFAULT_RULES en src/lib/engine/rules.ts
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index seasons_one_current on seasons (is_current) where is_current;

create table divisions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons on delete cascade,
  code division_code not null,
  name text not null,
  display_order int not null,
  unique (season_id, code)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions on delete cascade,
  code text not null,                 -- PREMIER, ORO, PLATA, BRONCE, ROOKIE
  name text not null,                 -- «Oro», la división se muestra aparte
  level_order int not null,           -- 1 = más alta dentro de la división
  active boolean not null default true,
  unique (division_id, code),
  unique (division_id, level_order)
);

create table phases (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons on delete cascade,
  number int not null check (number between 1 and 7),
  kind phase_kind not null,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  results_deadline date not null,     -- fin de mes + margen (5 días por defecto)
  status phase_status not null default 'DRAFT',
  generator_seed int,
  published_at timestamptz,
  unique (season_id, number)
);

-- ============ Personas y parejas ============
create table players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  is_minor boolean not null default false,
  created_at timestamptz not null default now()
);

-- Datos de contacto: solo administración. Nunca se exponen a otros jugadores.
create table player_contacts (
  player_id uuid primary key references players on delete cascade,
  phone text,
  email text,
  guardian_name text,                 -- para menores: el contacto es el del tutor
  notes text
);

create table registrations (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons on delete cascade,
  source text not null default 'FORM_IMPORT',
  import_batch uuid,
  row_number int,
  submitted_at timestamptz,
  email text not null,
  category_raw text,
  category_id uuid references categories,
  raw jsonb not null default '{}'::jsonb,
  status registration_status not null default 'PENDING',
  issues text[] not null default '{}',
  pair_id uuid,
  created_at timestamptz not null default now()
);
create index on registrations (season_id, status);

create table pairs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons on delete cascade,
  category_id uuid not null references categories,
  status pair_status not null default 'ACTIVE',
  registration_id uuid references registrations,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);
alter table registrations add constraint registrations_pair_fk foreign key (pair_id) references pairs;
create index on pairs (season_id, category_id, status);

create table pair_members (
  pair_id uuid not null references pairs on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  player_id uuid not null references players,
  primary key (pair_id, slot),
  unique (pair_id, player_id)
);

-- Acceso por pareja: el email del Form (o el del tutor) entra con magic link y actúa por la pareja.
create table pair_access (
  pair_id uuid not null references pairs on delete cascade,
  email text not null check (email = lower(email)),
  primary key (pair_id, email)
);
create index on pair_access (email);

-- ============ Grupos y partidos ============
create table groups (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phases on delete cascade,
  category_id uuid not null references categories,
  letter text not null,
  rank_index int,                     -- null en nivelación (sin jerarquía); 0 = A en Race
  unique (phase_id, category_id, letter)
);

create table group_pairs (
  group_id uuid not null references groups on delete cascade,
  phase_id uuid not null references phases on delete cascade,
  pair_id uuid not null references pairs,
  primary key (group_id, pair_id),
  unique (phase_id, pair_id)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phases on delete cascade,
  group_id uuid not null references groups on delete cascade,
  pair_a_id uuid not null references pairs,
  pair_b_id uuid not null references pairs,
  status match_status not null default 'PENDING_SCHEDULE',
  scheduled_at timestamptz,
  court text,
  sets jsonb not null default '[]'::jsonb,         -- [{"a":6,"b":4}, ...]
  ended_by_time boolean not null default false,
  winner_side char(1) check (winner_side in ('A', 'B')),
  points_override jsonb,                           -- {"a":-1,"b":0} para WO / decisiones
  confirmed_at timestamptz,
  ruleset jsonb,                                   -- reglas vigentes al confirmar (auditoría)
  updated_at timestamptz not null default now(),
  check (pair_a_id <> pair_b_id)
);
create unique index matches_unique_pairing on matches (phase_id, least(pair_a_id, pair_b_id), greatest(pair_a_id, pair_b_id));
create index on matches (pair_a_id);
create index on matches (pair_b_id);

create table schedule_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  proposed_by_pair uuid not null references pairs,
  proposed_at timestamptz not null,
  court text,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table result_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  submitted_by_pair uuid not null references pairs,
  submitted_by uuid default auth.uid(),
  sets jsonb not null,
  ended_by_time boolean not null default false,
  winner_side char(1) not null check (winner_side in ('A', 'B')),
  status submission_status not null default 'SUBMITTED',
  submitted_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  responded_at timestamptz,
  responded_by uuid,
  dispute_reason text,
  resolution_note text
);
create index on result_submissions (status, deadline_at);

create table wo_resolutions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references matches on delete cascade,
  responsible_pair_id uuid references pairs,
  points_a numeric not null,
  points_b numeric not null,
  counts_as_incident boolean not null default false, -- el WO justificado no cuenta como incumplimiento salvo decisión expresa
  reason text not null,
  decided_by text,
  decided_at timestamptz not null default now()
);

create table penalties (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references pairs,
  phase_id uuid references phases,
  kind text not null check (kind in ('INCIDENT', 'RACE_DEDUCTION', 'NO_PROMOTION', 'DISCIPLINARY')),
  race_points numeric not null default 0,
  reason text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table category_quotas (
  season_id uuid not null references seasons on delete cascade,
  category_id uuid not null references categories,
  up int not null default 0,
  down int not null default 0,
  status quota_status not null default 'PLANNED',
  updated_at timestamptz not null default now(),
  primary key (season_id, category_id)
);

-- Eventos de ranking que no salen de partidos (puntos iniciales, bonus, ajustes).
-- Los partidos se leen de matches y el ledger completo se recalcula en orden (src/lib/engine/ranking.ts).
create table ranking_events (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions,
  player_id uuid not null references players,
  kind ranking_event_kind not null,
  points numeric not null,
  movement text,
  reason text,
  at timestamptz not null default now(),
  idempotency_key text not null unique,
  created_by text
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text
);

-- ============ Helpers de permisos ============
create or replace function public.current_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = public.current_email())
$$;

create or replace function public.my_pair_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select pair_id from pair_access where email = public.current_email()
$$;

-- ============ RLS ============
do $$
declare t text;
begin
  foreach t in array array['admins','seasons','divisions','categories','phases','players','player_contacts',
    'registrations','pairs','pair_members','pair_access','groups','group_pairs','matches','schedule_proposals',
    'result_submissions','wo_resolutions','penalties','category_quotas','ranking_events','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
  end loop;
end $$;

-- Información pública de la temporada (landing).
create policy seasons_public on seasons for select to anon, authenticated using (true);
create policy divisions_public on divisions for select to anon, authenticated using (true);
create policy categories_public on categories for select to anon, authenticated using (true);
create policy phases_public on phases for select to anon, authenticated using (true);

-- Datos de competición: solo jugadores con sesión (hay menores; no se publican en abierto).
create policy players_read on players for select to authenticated using (true);
create policy pairs_read on pairs for select to authenticated using (true);
create policy pair_members_read on pair_members for select to authenticated using (true);
create policy groups_read on groups for select to authenticated using (true);
create policy group_pairs_read on group_pairs for select to authenticated using (true);
create policy matches_read on matches for select to authenticated using (true);
create policy proposals_read on schedule_proposals for select to authenticated using (true);
create policy submissions_read on result_submissions for select to authenticated using (true);
create policy wo_read on wo_resolutions for select to authenticated using (true);
create policy penalties_read on penalties for select to authenticated using (true);
create policy quotas_read on category_quotas for select to authenticated using (true);
create policy ranking_events_read on ranking_events for select to authenticated using (true);
create policy pair_access_self on pair_access for select to authenticated using (email = public.current_email());
-- player_contacts, registrations, admins y audit_log: solo administración (política _admin_all).

-- ============ Acciones de jugador (RPC) ============
create or replace function public.season_confirm_hours(p_phase uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((s.rules ->> 'resultConfirmHours')::int, 48)
  from phases p join seasons s on s.id = p.season_id where p.id = p_phase
$$;

-- La pareja ganadora envía el resultado. La rival tiene 48 h para confirmar o impugnar.
create or replace function public.submit_result(p_match uuid, p_sets jsonb, p_ended_by_time boolean, p_winner_side text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m matches;
  my_pair uuid;
  sub_id uuid;
  n int;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if p_winner_side not in ('A', 'B') then raise exception 'Ganador no válido'; end if;
  my_pair := case p_winner_side when 'A' then m.pair_a_id else m.pair_b_id end;
  if my_pair not in (select public.my_pair_ids()) then
    raise exception 'Solo la pareja ganadora puede introducir el resultado';
  end if;
  if m.status not in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'SCHEDULED', 'PLAYED_PENDING_RESULT', 'RESULT_PENDING_CONFIRMATION') then
    raise exception 'Este partido ya no admite resultados (estado %)', m.status;
  end if;
  if (select status from phases where id = m.phase_id) not in ('PUBLISHED', 'ACTIVE') then
    raise exception 'La fase no está abierta';
  end if;
  n := jsonb_array_length(p_sets);
  if n < 1 or n > 3 or exists (
    select 1 from jsonb_array_elements(p_sets) s
    where jsonb_typeof(s->'a') <> 'number' or jsonb_typeof(s->'b') <> 'number'
       or (s->>'a')::int not between 0 and 7 or (s->>'b')::int not between 0 and 7
  ) then raise exception 'Marcador no válido'; end if;

  update result_submissions set status = 'SUPERSEDED' where match_id = p_match and status = 'SUBMITTED';
  insert into result_submissions (match_id, submitted_by_pair, sets, ended_by_time, winner_side, deadline_at)
  values (p_match, my_pair, p_sets, p_ended_by_time, p_winner_side, now() + make_interval(hours => public.season_confirm_hours(m.phase_id)))
  returning id into sub_id;
  update matches set status = 'RESULT_PENDING_CONFIRMATION', sets = p_sets, ended_by_time = p_ended_by_time,
    winner_side = p_winner_side, updated_at = now() where id = p_match;
  insert into audit_log (actor, action, entity, entity_id, after)
  values (public.current_email(), 'RESULT_SUBMITTED', 'match', p_match::text,
          jsonb_build_object('sets', p_sets, 'ended_by_time', p_ended_by_time, 'winner', p_winner_side));
  return sub_id;
end $$;

-- Basta con que un miembro de la pareja rival confirme o impugne.
create or replace function public.respond_result(p_submission uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s result_submissions;
  m matches;
  rival uuid;
begin
  select * into s from result_submissions where id = p_submission for update;
  if not found or s.status <> 'SUBMITTED' then raise exception 'Este resultado ya no está pendiente'; end if;
  select * into m from matches where id = s.match_id for update;
  rival := case when s.submitted_by_pair = m.pair_a_id then m.pair_b_id else m.pair_a_id end;
  if rival not in (select public.my_pair_ids()) then raise exception 'Solo la pareja rival puede responder'; end if;

  if p_accept then
    update result_submissions set status = 'CONFIRMED', responded_at = now(), responded_by = auth.uid() where id = s.id;
    update matches set status = 'COMPLETED', confirmed_at = now(), updated_at = now(),
      ruleset = (select rules from seasons se join phases p on p.season_id = se.id where p.id = m.phase_id)
      where id = m.id;
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la impugnación'; end if;
    update result_submissions set status = 'DISPUTED', responded_at = now(), responded_by = auth.uid(), dispute_reason = p_reason where id = s.id;
    update matches set status = 'DISPUTED', updated_at = now() where id = m.id;
  end if;
  insert into audit_log (actor, action, entity, entity_id, reason)
  values (public.current_email(), case when p_accept then 'RESULT_CONFIRMED' else 'RESULT_DISPUTED' end, 'match', m.id::text, p_reason);
end $$;

-- Autoaprobación a las 48 h. Idempotente: solo toca envíos SUBMITTED vencidos.
create or replace function public.auto_confirm_due() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update result_submissions set status = 'AUTO_CONFIRMED', responded_at = now()
    where status = 'SUBMITTED' and deadline_at <= now()
    returning match_id
  )
  update matches m set status = 'COMPLETED', confirmed_at = now(), updated_at = now()
  from due where m.id = due.match_id and m.status = 'RESULT_PENDING_CONFIRMATION';
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_log (actor, action, entity, reason) values ('system', 'AUTO_CONFIRM', 'match', n || ' resultados');
  end if;
  return n;
end $$;

revoke all on function public.auto_confirm_due() from public, anon, authenticated;
grant execute on function public.submit_result(uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.respond_result(uuid, boolean, text) to authenticated;

-- Tarea programada cada 10 minutos (requiere la extensión pg_cron, disponible en Supabase).
create extension if not exists pg_cron;
select cron.schedule('saque-auto-confirm', '*/10 * * * *', $$select public.auto_confirm_due()$$);
