-- SAQUE LEAGUE · 0009 · Fase 5 (segunda parte): preferencias, excepciones por fecha y avisos de cambios.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0008. Solo añade (y sustituye save_availability).

-- ============ Datos ============
-- Una franja puede marcarse como «preferente» (además de disponible).
alter table availability_rules add column if not exists preferred boolean not null default false;

-- Excepciones por fecha concreta: vacaciones, lesión, festivos, bloqueo de un día o disponibilidad extraordinaria.
-- UNAVAILABLE gana siempre sobre la pauta semanal y sobre cualquier disponibilidad extra; AVAILABLE añade disponibilidad.
create table if not exists availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players on delete cascade,
  on_date date not null,
  start_min int not null check (start_min between 0 and 1410 and start_min % 30 = 0),
  end_min int not null check (end_min between 30 and 1440 and end_min % 30 = 0),
  status text not null check (status in ('AVAILABLE', 'UNAVAILABLE')),
  preferred boolean not null default false,
  note text check (char_length(note) <= 80),         -- privada: solo la ven el jugador, su compañero/a y la organización
  updated_at timestamptz not null default now(),
  updated_by text,
  check (end_min > start_min),
  check (not (preferred and status = 'UNAVAILABLE'))
);
create index if not exists availability_exceptions_player_idx on availability_exceptions (player_id, on_date);

-- ============ Permisos ============
alter table availability_exceptions enable row level security;
drop policy if exists availability_exceptions_admin_all on availability_exceptions;
create policy availability_exceptions_admin_all on availability_exceptions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists availability_exceptions_own_pair on availability_exceptions;
create policy availability_exceptions_own_pair on availability_exceptions for select to authenticated
  using (player_id in (select pm.player_id from pair_members pm where pm.pair_id in (select public.my_pair_ids())));

-- ============ Avisos de cambios relevantes (RF-DISP-07 y RF-DISP-20) ============
-- 1) Primera vez que un jugador rellena su disponibilidad: se avisa a los demás de sus partidos abiertos.
-- 2) Un bloqueo explícito que pisa un horario propuesto o la fecha acordada: aviso de posible conflicto.
--    No se borra ni se revoca nada: los jugadores lo hablan y, si hace falta, cambian la fecha.
create or replace function public.availability_changed(p_player uuid, p_actor text, p_first boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r record; c record; who text; mins int;
begin
  select full_name into who from players where id = p_player;
  -- Un solo aviso por persona (aunque comparta varios partidos con el jugador), sin avisar al propio jugador ni a quien lo ha guardado.
  if p_first then
    insert into notifications (email, match_id, kind, title, body, dedupe_key)
    select distinct pa.email, null::uuid, 'AVAILABILITY_FILLED', who || ' ha rellenado su disponibilidad',
           'Entra en tus partidos y mira los mejores horarios: el cruce de calendarios ya tiene más información.', 'availfilled:' || p_player
      from matches m join phases ph on ph.id = m.phase_id
      join pair_access pa on pa.pair_id in (m.pair_a_id, m.pair_b_id)
     where ph.status in ('PUBLISHED', 'ACTIVE')
       and m.status in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'RESCHEDULE_REQUESTED', 'DATE_AGREED')
       and exists (select 1 from pair_members pm where pm.player_id = p_player and pm.pair_id in (m.pair_a_id, m.pair_b_id))
       and pa.email <> coalesce(p_actor, '') and coalesce(pa.player_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_player
    on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  for r in
    select m.id as match_id, m.pair_a_id, m.pair_b_id, m.agreed_start_at
      from matches m join phases ph on ph.id = m.phase_id
     where ph.status in ('PUBLISHED', 'ACTIVE')
       and m.status in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'RESCHEDULE_REQUESTED', 'DATE_AGREED')
       and exists (select 1 from pair_members pm where pm.player_id = p_player and pm.pair_id in (m.pair_a_id, m.pair_b_id))
  loop
    for c in
      select s.t, s.agreed from (
        select o.starts_at as t, false as agreed from match_date_options o where o.match_id = r.match_id and o.state = 'ACTIVE' and o.starts_at > now()
        union
        select r.agreed_start_at, true where r.agreed_start_at is not null and r.agreed_start_at > now()
      ) s
    loop
      mins := (extract(hour from c.t at time zone 'Europe/Madrid') * 60 + extract(minute from c.t at time zone 'Europe/Madrid'))::int;
      if exists (select 1 from availability_exceptions e where e.player_id = p_player and e.status = 'UNAVAILABLE'
                  and e.on_date = (c.t at time zone 'Europe/Madrid')::date and e.start_min < mins + 90 and e.end_min > mins) then
        insert into notifications (email, match_id, kind, title, body, dedupe_key)
        select pa.email, r.match_id, 'AVAILABILITY_CONFLICT', 'Posible conflicto con un horario',
               who || ' ha marcado que no puede el ' || public.fmt_madrid(c.t) || ', que es ' || (case when c.agreed then 'la fecha acordada' else 'uno de los horarios propuestos' end)
               || '. No se ha cambiado nada: hablad en el chat si hay que mover el partido.',
               'availconf:' || p_player || ':' || r.match_id || ':' || floor(extract(epoch from c.t))::bigint
          from pair_access pa where pa.pair_id in (r.pair_a_id, r.pair_b_id) and pa.email <> coalesce(p_actor, '')
        on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end loop;
  end loop;
end $$;
revoke execute on function public.availability_changed(uuid, text, boolean) from public, anon, authenticated;

-- ============ Acciones de jugador ============

-- Franjas semanales (ahora con «preferente»). p_slots: [{"weekday":1,"start":1080,"end":1320,"preferred":true}, ...]
-- Una franja preferente puede solaparse con una normal (la preferente también cuenta como disponible), pero no dos del mismo tipo.
create or replace function public.save_availability(p_player uuid, p_slots jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me text := public.current_email(); n int; was_empty boolean;
begin
  if p_player not in (select pm.player_id from pair_members pm where pm.pair_id in (select public.my_pair_ids())) then
    raise exception 'Solo puedes editar tu disponibilidad o la de tu compañero/a.';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then raise exception 'Formato de franjas no válido.'; end if;
  n := jsonb_array_length(p_slots);
  if n > 56 then raise exception 'Demasiadas franjas (máximo 56).'; end if;

  create temp table if not exists _slots (weekday int, start_min int, end_min int, preferred boolean) on commit drop;
  truncate _slots;
  insert into _slots select (s ->> 'weekday')::int, (s ->> 'start')::int, (s ->> 'end')::int, coalesce((s ->> 'preferred')::boolean, false) from jsonb_array_elements(p_slots) s;
  if exists (select 1 from _slots where weekday not between 1 and 7 or start_min is null or end_min is null
                or start_min < 0 or end_min > 1440 or end_min <= start_min or start_min % 30 <> 0 or end_min % 30 <> 0) then
    raise exception 'Hay una franja no válida: usa tramos de 30 minutos y que la hora de fin sea posterior a la de inicio.';
  end if;
  if exists (select 1 from _slots a join _slots b on a.weekday = b.weekday and a.preferred = b.preferred and (a.start_min, a.end_min) < (b.start_min, b.end_min) and a.end_min > b.start_min) then
    raise exception 'Hay franjas que se solapan en un mismo día.';
  end if;
  if exists (select 1 from _slots group by weekday, start_min, end_min, preferred having count(*) > 1) then raise exception 'Hay franjas repetidas.'; end if;
  if exists (select 1 from _slots group by weekday having count(*) > 8) then raise exception 'Máximo 8 franjas por día.'; end if;

  was_empty := not exists (select 1 from availability_rules where player_id = p_player)
           and not exists (select 1 from availability_exceptions where player_id = p_player and status = 'AVAILABLE');
  delete from availability_rules where player_id = p_player;
  insert into availability_rules (player_id, weekday, start_min, end_min, preferred, updated_by) select p_player, weekday, start_min, end_min, preferred, me from _slots;
  insert into audit_log (actor, action, entity, entity_id, after) values (me, 'AVAILABILITY_SAVED', 'player', p_player::text, jsonb_build_object('slots', n));
  if was_empty and n > 0 then perform public.availability_changed(p_player, me, true); end if;
  return n;
end $$;

-- Excepciones por fecha. Sustituye todas las del jugador desde hoy en adelante (las pasadas no se tocan).
-- p_items: [{"date":"2026-11-12","start":0,"end":1440,"status":"UNAVAILABLE","note":"Viaje"}, ...]
create or replace function public.save_exceptions(p_player uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me text := public.current_email(); n int; today date := (now() at time zone 'Europe/Madrid')::date; was_empty boolean; has_extra boolean;
begin
  if p_player not in (select pm.player_id from pair_members pm where pm.pair_id in (select public.my_pair_ids())) then
    raise exception 'Solo puedes editar tu disponibilidad o la de tu compañero/a.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Formato de excepciones no válido.'; end if;
  n := jsonb_array_length(p_items);
  if n > 200 then raise exception 'Demasiadas excepciones (máximo 200).'; end if;

  create temp table if not exists _exc (on_date date, start_min int, end_min int, status text, preferred boolean, note text) on commit drop;
  truncate _exc;
  begin
    insert into _exc select (x ->> 'date')::date, (x ->> 'start')::int, (x ->> 'end')::int, x ->> 'status', coalesce((x ->> 'preferred')::boolean, false), nullif(left(trim(coalesce(x ->> 'note', '')), 81), '')
      from jsonb_array_elements(p_items) x;
  exception when others then raise exception 'Hay una fecha u hora no válida.';
  end;
  if exists (select 1 from _exc where on_date is null or start_min is null or end_min is null or status not in ('AVAILABLE', 'UNAVAILABLE')) then raise exception 'Hay una excepción incompleta.'; end if;
  if exists (select 1 from _exc where end_min <= start_min or start_min < 0 or end_min > 1440 or start_min % 30 <> 0 or end_min % 30 <> 0) then
    raise exception 'Hay una franja no válida: usa tramos de 30 minutos y que la hora de fin sea posterior a la de inicio.';
  end if;
  if exists (select 1 from _exc where on_date < today) then raise exception 'No se pueden añadir excepciones en fechas pasadas.'; end if;
  if exists (select 1 from _exc where on_date > today + 150) then raise exception 'Solo se admiten fechas de los próximos 150 días.'; end if;
  if exists (select 1 from _exc where preferred and status = 'UNAVAILABLE') then raise exception 'Una franja de «no disponible» no puede ser preferente.'; end if;
  if exists (select 1 from _exc where char_length(coalesce(note, '')) > 80) then raise exception 'La nota admite como máximo 80 caracteres.'; end if;
  if exists (select 1 from _exc a join _exc b on a.on_date = b.on_date and a.status = b.status and a.preferred = b.preferred and (a.start_min, a.end_min) < (b.start_min, b.end_min) and a.end_min > b.start_min) then
    raise exception 'Hay excepciones que se solapan el mismo día.';
  end if;
  if exists (select 1 from _exc group by on_date, start_min, end_min, status, preferred having count(*) > 1) then raise exception 'Hay excepciones repetidas.'; end if;

  was_empty := not exists (select 1 from availability_rules where player_id = p_player)
           and not exists (select 1 from availability_exceptions where player_id = p_player and status = 'AVAILABLE');
  has_extra := exists (select 1 from _exc where status = 'AVAILABLE');
  delete from availability_exceptions where player_id = p_player and on_date >= today;
  insert into availability_exceptions (player_id, on_date, start_min, end_min, status, preferred, note, updated_by)
  select p_player, on_date, start_min, end_min, status, preferred, note, me from _exc;
  insert into audit_log (actor, action, entity, entity_id, after) values (me, 'AVAILABILITY_EXCEPTIONS_SAVED', 'player', p_player::text, jsonb_build_object('items', n));
  perform public.availability_changed(p_player, me, was_empty and has_extra);
  return n;
end $$;

revoke execute on function public.save_availability(uuid, jsonb), public.save_exceptions(uuid, jsonb) from public, anon;
grant execute on function public.save_availability(uuid, jsonb) to authenticated;
grant execute on function public.save_exceptions(uuid, jsonb) to authenticated;
