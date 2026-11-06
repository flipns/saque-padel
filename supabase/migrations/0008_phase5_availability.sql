-- SAQUE LEAGUE · 0008 · Fase 5 (primera parte): disponibilidad semanal de cada jugador.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0007. Solo añade (y sustituye notify_phase_published).

-- ============ Datos ============
-- Franjas semanales en las que el jugador PUEDE jugar (hora de Madrid). Lo no marcado es «desconocido», nunca «libre».
-- weekday: 1 = lunes … 7 = domingo. Minutos desde las 00:00, en bloques de 30 (1440 = 24:00).
create table if not exists availability_rules (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_min int not null check (start_min between 0 and 1410 and start_min % 30 = 0),
  end_min int not null check (end_min between 30 and 1440 and end_min % 30 = 0),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (end_min > start_min)
);
create index if not exists availability_rules_player_idx on availability_rules (player_id, weekday);

-- Origen de cada horario propuesto: escrito a mano o sugerido por el cruce de calendarios.
alter table match_date_options add column if not exists origin text not null default 'MANUAL' check (origin in ('MANUAL', 'AVAILABILITY'));

-- ============ Permisos ============
-- Cada jugador ve su calendario y el de su compañero/a. Los rivales NO ven el calendario del otro lado:
-- solo ven las coincidencias que calcula el servidor (RF-DISP-08).
alter table availability_rules enable row level security;
drop policy if exists availability_rules_admin_all on availability_rules;
create policy availability_rules_admin_all on availability_rules for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists availability_rules_own_pair on availability_rules;
create policy availability_rules_own_pair on availability_rules for select to authenticated
  using (player_id in (select pm.player_id from pair_members pm where pm.pair_id in (select public.my_pair_ids())));

-- ============ Acciones de jugador ============

-- Sustituye todas las franjas semanales de un jugador (el propio o su compañero/a).
-- p_slots: [{"weekday":1,"start":1080,"end":1320}, ...]
create or replace function public.save_availability(p_player uuid, p_slots jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me text := public.current_email(); n int;
begin
  if p_player not in (select pm.player_id from pair_members pm where pm.pair_id in (select public.my_pair_ids())) then
    raise exception 'Solo puedes editar tu disponibilidad o la de tu compañero/a.';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then raise exception 'Formato de franjas no válido.'; end if;
  n := jsonb_array_length(p_slots);
  if n > 56 then raise exception 'Demasiadas franjas (máximo 56).'; end if;

  create temp table if not exists _slots (weekday int, start_min int, end_min int) on commit drop;
  truncate _slots;
  insert into _slots select (s ->> 'weekday')::int, (s ->> 'start')::int, (s ->> 'end')::int from jsonb_array_elements(p_slots) s;
  if exists (select 1 from _slots where weekday not between 1 and 7 or start_min is null or end_min is null
                or start_min < 0 or end_min > 1440 or end_min <= start_min or start_min % 30 <> 0 or end_min % 30 <> 0) then
    raise exception 'Hay una franja no válida: usa tramos de 30 minutos y que la hora de fin sea posterior a la de inicio.';
  end if;
  if exists (select 1 from _slots a join _slots b on a.weekday = b.weekday and (a.start_min, a.end_min) < (b.start_min, b.end_min) and a.end_min > b.start_min) then
    raise exception 'Hay franjas que se solapan en un mismo día.';
  end if;
  if exists (select 1 from _slots group by weekday, start_min, end_min having count(*) > 1) then raise exception 'Hay franjas repetidas.'; end if;
  if exists (select 1 from _slots group by weekday having count(*) > 8) then raise exception 'Máximo 8 franjas por día.'; end if;

  delete from availability_rules where player_id = p_player;
  insert into availability_rules (player_id, weekday, start_min, end_min, updated_by) select p_player, weekday, start_min, end_min, me from _slots;
  insert into audit_log (actor, action, entity, entity_id, after) values (me, 'AVAILABILITY_SAVED', 'player', p_player::text, jsonb_build_object('slots', n));
  return n;
end $$;

-- «Pedir que actualicen su disponibilidad»: avisa a los otros tres jugadores (como mucho una vez al día por partido).
create or replace function public.request_availability_update(p_match uuid)
returns int language plpgsql security definer set search_path = public as $$
declare m matches; me text := public.current_email(); my_pair uuid; who text; c int;
begin
  select * into m from matches where id = p_match;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.pair_a_id in (select public.my_pair_ids()) then my_pair := m.pair_a_id;
  elsif m.pair_b_id in (select public.my_pair_ids()) then my_pair := m.pair_b_id;
  else raise exception 'Este partido no es tuyo'; end if;
  select coalesce((select pl.full_name from pair_access pa join players pl on pl.id = pa.player_id where pa.pair_id = my_pair and pa.email = me), 'Un jugador') into who;
  insert into notifications (email, match_id, kind, title, body, dedupe_key)
  select pa.email, p_match, 'AVAILABILITY_REQUEST', 'Actualizad vuestra disponibilidad',
         who || ' pide que reviséis vuestra disponibilidad: ahora mismo no hay horarios en los que podáis los cuatro. Entrad en «Disponibilidad» y actualizadla.',
         'availreq:' || p_match || ':' || current_date
    from pair_access pa where pa.pair_id in (m.pair_a_id, m.pair_b_id) and pa.email <> me
  on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics c = row_count;
  return c;
end $$;

-- El aviso de «grupos publicados» anima a rellenar la disponibilidad.
create or replace function public.notify_phase_published(p_phase uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c int; ph phases;
begin
  if not public.is_admin() then raise exception 'Solo administración'; end if;
  select * into ph from phases where id = p_phase;
  if not found then raise exception 'Fase no encontrada'; end if;
  insert into notifications (email, match_id, kind, title, body, dedupe_key)
  select distinct on (pa.email) pa.email, null, 'PHASE_PUBLISHED',
         'Ya están publicados los grupos de ' || coalesce(nullif(split_part(ph.name, '· ', 2), ''), ph.name),
         'Entra para ver tu grupo y tus rivales. Rellena tu disponibilidad y el sistema te sugerirá horarios en los que podéis los cuatro. El plazo para jugar termina el ' || to_char(ph.results_deadline, 'DD/MM') || '.',
         'phase_published:' || ph.id
    from group_pairs gp join pair_access pa on pa.pair_id = gp.pair_id
   where gp.phase_id = p_phase
  on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics c = row_count;
  return c;
end $$;
revoke execute on function public.notify_phase_published(uuid) from public, anon;
grant execute on function public.notify_phase_published(uuid) to authenticated;

revoke execute on function public.save_availability(uuid, jsonb), public.request_availability_update(uuid) from public, anon;
grant execute on function public.save_availability(uuid, jsonb) to authenticated;
grant execute on function public.request_availability_update(uuid) to authenticated;
