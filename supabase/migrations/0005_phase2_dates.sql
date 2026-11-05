-- SAQUE LEAGUE · 0005 · Fase 2: propuestas de fecha, acuerdo, reserva de pista, cambio de fecha y avisos.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0004. Solo añade (y sustituye submit_result); no borra datos.

-- Estados nuevos del partido (la fecha acordada todavía no es una pista reservada).
alter type match_status add value if not exists 'DATE_AGREED';
alter type match_status add value if not exists 'RESCHEDULE_REQUESTED';

-- ============ Datos ============
alter table matches add column if not exists agreed_option_id uuid;
alter table matches add column if not exists agreed_start_at timestamptz;   -- fecha acordada pendiente de reservar pista
alter table matches add column if not exists booking_ref text;
alter table matches add column if not exists booked_by text;
alter table matches add column if not exists booked_at timestamptz;

create table if not exists match_date_options (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  proposed_by_pair uuid not null references pairs,
  proposed_by_player uuid references players,
  proposed_by_email text,
  starts_at timestamptz not null,
  duration_min int not null default 90,
  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED', 'EXPIRED')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_email text,
  decided_by_pair uuid references pairs
);
create index if not exists match_date_options_match_idx on match_date_options (match_id, state);
create unique index if not exists match_date_options_unique_active on match_date_options (match_id, starts_at) where state = 'ACTIVE';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'matches_agreed_option_fk') then
    alter table matches add constraint matches_agreed_option_fk foreign key (agreed_option_id) references match_date_options (id) on delete set null;
  end if;
end $$;

-- Avisos dentro de la web. La Fase 3 los enviará también por email (emailed_at).
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  match_id uuid references matches on delete cascade,
  kind text not null,
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz
);
create index if not exists notifications_email_idx on notifications (email, created_at desc);
create index if not exists notifications_unread_idx on notifications (email) where read_at is null;

-- ============ Permisos ============
alter table match_date_options enable row level security;
alter table notifications enable row level security;

drop policy if exists match_date_options_admin_all on match_date_options;
create policy match_date_options_admin_all on match_date_options for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- Solo los cuatro jugadores del partido ven sus propuestas (y la administración).
drop policy if exists match_date_options_participants on match_date_options;
create policy match_date_options_participants on match_date_options for select to authenticated
  using (match_id in (select m.id from matches m where m.pair_a_id in (select public.my_pair_ids()) or m.pair_b_id in (select public.my_pair_ids())));

drop policy if exists notifications_admin_all on notifications;
create policy notifications_admin_all on notifications for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for select to authenticated using (email = (select public.current_email()));

-- ============ Auxiliares (no invocables por los jugadores) ============
create or replace function public.pair_label(p_pair uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(pl.full_name, ' / ' order by pm.slot) from pair_members pm join players pl on pl.id = pm.player_id where pm.pair_id = p_pair
$$;

create or replace function public.notify_pair(p_pair uuid, p_match uuid, p_kind text, p_title text, p_body text, p_skip text default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications (email, match_id, kind, title, body)
  select pa.email, p_match, p_kind, p_title, p_body from pair_access pa where pa.pair_id = p_pair and pa.email <> coalesce(p_skip, '')
$$;

create or replace function public.fmt_madrid(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI') $$;

revoke execute on function public.pair_label(uuid) from public, anon, authenticated;
revoke execute on function public.notify_pair(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ============ Acciones de jugador ============

-- Propone entre 1 y 5 horarios de 90 minutos. Con p_replace, cierra antes los horarios activos de la otra pareja («ninguno me cuadra»).
create or replace function public.propose_dates(p_match uuid, p_times timestamptz[], p_replace boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  m matches; ph phases; me text := public.current_email();
  my_pair uuid; rival uuid; my_player uuid; n int; t timestamptz; active int;
  phase_start timestamptz; phase_end timestamptz;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.pair_a_id in (select public.my_pair_ids()) then my_pair := m.pair_a_id; rival := m.pair_b_id;
  elsif m.pair_b_id in (select public.my_pair_ids()) then my_pair := m.pair_b_id; rival := m.pair_a_id;
  else raise exception 'Este partido no es tuyo'; end if;
  select * into ph from phases where id = m.phase_id;
  if ph.status not in ('PUBLISHED', 'ACTIVE') then raise exception 'La fase no está abierta'; end if;
  if m.status not in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'RESCHEDULE_REQUESTED') then
    raise exception 'Este partido ya tiene fecha acordada o ya no admite propuestas. Si hay que moverlo, usa «Cambiar fecha».';
  end if;

  n := coalesce(array_length(p_times, 1), 0);
  if n < 1 then raise exception 'Indica al menos un horario.'; end if;
  if n > 5 then raise exception 'Máximo 5 horarios por propuesta.'; end if;
  if (select count(distinct x) from unnest(p_times) x) <> n then raise exception 'Hay horarios repetidos.'; end if;

  phase_start := ph.starts_on::timestamp at time zone 'Europe/Madrid';
  phase_end := (ph.results_deadline + 1)::timestamp at time zone 'Europe/Madrid';
  foreach t in array p_times loop
    if t <= now() then raise exception 'Hay un horario que ya ha pasado.'; end if;
    if t < phase_start or t + interval '90 minutes' > phase_end then
      raise exception 'Hay un horario fuera del plazo de la fase (del % al %).', to_char(ph.starts_on, 'DD/MM'), to_char(ph.results_deadline, 'DD/MM');
    end if;
  end loop;

  update match_date_options set state = 'EXPIRED' where match_id = p_match and state = 'ACTIVE' and starts_at <= now();
  if p_replace then
    update match_date_options set state = 'REJECTED', decided_at = now(), decided_by_email = me, decided_by_pair = my_pair
     where match_id = p_match and state = 'ACTIVE' and proposed_by_pair = rival;
  end if;
  select count(*) into active from match_date_options where match_id = p_match and state = 'ACTIVE';
  if active + n > 5 then
    raise exception 'Ya hay % horarios activos en este partido (máximo 5 a la vez). Cierra alguno antes de proponer más.', active;
  end if;
  if exists (select 1 from match_date_options where match_id = p_match and state = 'ACTIVE' and starts_at = any (p_times)) then
    raise exception 'Alguno de esos horarios ya está propuesto.';
  end if;

  select player_id into my_player from pair_access where pair_id = my_pair and email = me;
  insert into match_date_options (match_id, proposed_by_pair, proposed_by_player, proposed_by_email, starts_at)
  select p_match, my_pair, my_player, me, x from unnest(p_times) x;
  update matches set status = case when m.status = 'RESCHEDULE_REQUESTED' then 'RESCHEDULE_REQUESTED'::match_status else 'SCHEDULE_PROPOSED'::match_status end, updated_at = now() where id = p_match;

  perform public.notify_pair(rival, p_match, 'DATES_PROPOSED', 'Nueva propuesta de fecha',
    public.pair_label(my_pair) || ' os propone ' || n || (case when n = 1 then ' horario' else ' horarios' end) || ' para vuestro partido. Entra y acepta el que os venga bien.');
  insert into audit_log (actor, action, entity, entity_id, after)
  values (me, case when p_replace then 'DATES_COUNTERPROPOSED' else 'DATES_PROPOSED' end, 'match', p_match::text, jsonb_build_object('times', p_times));
end $$;

-- La otra pareja acepta o rechaza un horario. Aceptar fija la fecha y descarta el resto.
create or replace function public.respond_option(p_option uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  o match_date_options; m matches; ph phases; me text := public.current_email(); my_pair uuid; rival uuid; active int;
begin
  select * into o from match_date_options where id = p_option;
  if not found then raise exception 'Propuesta no encontrada'; end if;
  select * into m from matches where id = o.match_id for update;
  select * into o from match_date_options where id = p_option for update;
  if m.pair_a_id in (select public.my_pair_ids()) then my_pair := m.pair_a_id; rival := m.pair_b_id;
  elsif m.pair_b_id in (select public.my_pair_ids()) then my_pair := m.pair_b_id; rival := m.pair_a_id;
  else raise exception 'Este partido no es tuyo'; end if;
  select * into ph from phases where id = m.phase_id;
  if ph.status not in ('PUBLISHED', 'ACTIVE') then raise exception 'La fase no está abierta'; end if;
  if o.proposed_by_pair = my_pair then raise exception 'No puedes responder a tus propias propuestas. Si quieres quitarla, usa «Retirar».'; end if;
  if o.state <> 'ACTIVE' then raise exception 'Esta propuesta ya no está activa. Recarga la página.'; end if;
  if m.status not in ('SCHEDULE_PROPOSED', 'RESCHEDULE_REQUESTED') then raise exception 'El partido ya no admite respuestas a propuestas.'; end if;

  if p_accept then
    if o.starts_at <= now() then raise exception 'Ese horario ya ha pasado.'; end if;
    update match_date_options set state = 'ACCEPTED', decided_at = now(), decided_by_email = me, decided_by_pair = my_pair where id = p_option;
    update match_date_options set state = 'SUPERSEDED' where match_id = m.id and state = 'ACTIVE' and id <> p_option;
    update matches set agreed_option_id = p_option, agreed_start_at = o.starts_at, status = 'DATE_AGREED'::match_status, updated_at = now() where id = m.id;
    perform public.notify_pair(m.pair_a_id, m.id, 'DATE_AGREED', 'Fecha acordada', 'Partido acordado para el ' || public.fmt_madrid(o.starts_at) || '. Falta reservar la pista y registrarla.', me);
    perform public.notify_pair(m.pair_b_id, m.id, 'DATE_AGREED', 'Fecha acordada', 'Partido acordado para el ' || public.fmt_madrid(o.starts_at) || '. Falta reservar la pista y registrarla.', me);
    insert into audit_log (actor, action, entity, entity_id, after) values (me, 'DATE_ACCEPTED', 'match', m.id::text, jsonb_build_object('option', p_option, 'at', o.starts_at));
  else
    update match_date_options set state = 'REJECTED', decided_at = now(), decided_by_email = me, decided_by_pair = my_pair where id = p_option;
    select count(*) into active from match_date_options where match_id = m.id and state = 'ACTIVE';
    if active = 0 and m.status = 'SCHEDULE_PROPOSED' then update matches set status = 'PENDING_SCHEDULE'::match_status, updated_at = now() where id = m.id; end if;
    if active = 0 then
      perform public.notify_pair(rival, m.id, 'DATES_REJECTED', 'Horarios rechazados', public.pair_label(my_pair) || ' no puede en ninguno de los horarios propuestos. Proponed otros.', me);
    end if;
    insert into audit_log (actor, action, entity, entity_id, after) values (me, 'DATE_REJECTED', 'match', m.id::text, jsonb_build_object('option', p_option));
  end if;
end $$;

-- Retira un horario propio que sigue activo.
create or replace function public.withdraw_option(p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o match_date_options; m matches; me text := public.current_email(); active int;
begin
  select * into o from match_date_options where id = p_option;
  if not found then raise exception 'Propuesta no encontrada'; end if;
  select * into m from matches where id = o.match_id for update;
  select * into o from match_date_options where id = p_option for update;
  if o.proposed_by_pair not in (select public.my_pair_ids()) then raise exception 'Solo puede retirarla la pareja que la propuso.'; end if;
  if o.state <> 'ACTIVE' then raise exception 'Esta propuesta ya no está activa.'; end if;
  update match_date_options set state = 'WITHDRAWN', decided_at = now(), decided_by_email = me, decided_by_pair = o.proposed_by_pair where id = p_option;
  select count(*) into active from match_date_options where match_id = m.id and state = 'ACTIVE';
  if active = 0 and m.status = 'SCHEDULE_PROPOSED' then update matches set status = 'PENDING_SCHEDULE'::match_status, updated_at = now() where id = m.id; end if;
  insert into audit_log (actor, action, entity, entity_id, after) values (me, 'DATE_WITHDRAWN', 'match', m.id::text, jsonb_build_object('option', p_option));
end $$;

-- Registra la pista reservada (fecha acordada -> programado) o corrige pista/referencia de un partido ya programado.
create or replace function public.register_booking(p_match uuid, p_court text, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m matches; me text := public.current_email(); v_court text := nullif(trim(coalesce(p_court, '')), ''); v_ref text := nullif(trim(coalesce(p_ref, '')), '');
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.pair_a_id not in (select public.my_pair_ids()) and m.pair_b_id not in (select public.my_pair_ids()) then raise exception 'Este partido no es tuyo'; end if;
  if v_court is null then raise exception 'Indica la pista reservada.'; end if;
  if m.status = 'DATE_AGREED' then
    update matches set scheduled_at = agreed_start_at, court = v_court, booking_ref = v_ref, booked_by = me, booked_at = now(),
           agreed_start_at = null, status = 'SCHEDULED'::match_status, updated_at = now() where id = p_match;
    perform public.notify_pair(m.pair_a_id, m.id, 'BOOKED', 'Pista reservada', 'Partido programado el ' || public.fmt_madrid(m.agreed_start_at) || ' en ' || v_court || '.', me);
    perform public.notify_pair(m.pair_b_id, m.id, 'BOOKED', 'Pista reservada', 'Partido programado el ' || public.fmt_madrid(m.agreed_start_at) || ' en ' || v_court || '.', me);
    insert into audit_log (actor, action, entity, entity_id, after) values (me, 'BOOKING_REGISTERED', 'match', p_match::text, jsonb_build_object('court', v_court, 'ref', v_ref, 'at', m.agreed_start_at));
  elsif m.status = 'SCHEDULED' then
    update matches set court = v_court, booking_ref = v_ref, booked_by = me, booked_at = now(), updated_at = now() where id = p_match;
    perform public.notify_pair(m.pair_a_id, m.id, 'COURT_CHANGED', 'Cambio de pista', 'La pista del partido del ' || public.fmt_madrid(m.scheduled_at) || ' ahora es ' || v_court || '.', me);
    perform public.notify_pair(m.pair_b_id, m.id, 'COURT_CHANGED', 'Cambio de pista', 'La pista del partido del ' || public.fmt_madrid(m.scheduled_at) || ' ahora es ' || v_court || '.', me);
    insert into audit_log (actor, action, entity, entity_id, after) values (me, 'COURT_CHANGED', 'match', p_match::text, jsonb_build_object('court', v_court, 'ref', v_ref));
  else
    raise exception 'Primero tiene que haber una fecha acordada.';
  end if;
end $$;

-- «Cambiar fecha» (p. ej. no hay pista): la fecha y pista anteriores siguen vigentes hasta que haya un nuevo acuerdo y una nueva reserva.
create or replace function public.request_new_date(p_match uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m matches; me text := public.current_email(); my_pair uuid; rival uuid; has_booking boolean; reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.pair_a_id in (select public.my_pair_ids()) then my_pair := m.pair_a_id; rival := m.pair_b_id;
  elsif m.pair_b_id in (select public.my_pair_ids()) then my_pair := m.pair_b_id; rival := m.pair_a_id;
  else raise exception 'Este partido no es tuyo'; end if;
  if m.status not in ('DATE_AGREED', 'SCHEDULED') then raise exception 'Este partido no tiene una fecha que cambiar.'; end if;
  has_booking := m.scheduled_at is not null;
  update match_date_options set state = 'SUPERSEDED' where id = m.agreed_option_id and state = 'ACCEPTED';
  update matches set agreed_option_id = null, agreed_start_at = null,
         status = case when has_booking then 'RESCHEDULE_REQUESTED'::match_status else 'PENDING_SCHEDULE'::match_status end, updated_at = now() where id = p_match;
  perform public.notify_pair(rival, p_match, 'RESCHEDULE_REQUESTED', 'Piden cambiar la fecha',
    public.pair_label(my_pair) || ' pide cambiar la fecha del partido' || coalesce(': ' || reason || '.', '.') ||
    case when has_booking then ' Hasta que haya nuevo acuerdo sigue vigente el ' || public.fmt_madrid(m.scheduled_at) || '.' else ' Proponed nuevos horarios.' end);
  insert into audit_log (actor, action, entity, entity_id, after, reason) values (me, 'RESCHEDULE_REQUESTED', 'match', p_match::text, jsonb_build_object('had_booking', has_booking), reason);
end $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where email = public.current_email() and read_at is null
$$;

-- Los jugadores ya no fijan fecha directamente: tiene que haber un acuerdo entre las dos parejas.
revoke execute on function public.set_schedule(uuid, timestamptz, text) from public, anon, authenticated;

-- El resultado puede enviarse en cualquier estado previo, también con fecha acordada o cambio en curso.
create or replace function public.submit_result(p_match uuid, p_sets jsonb, p_ended_by_time boolean, p_winner_side text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m matches; my_pair uuid; sub_id uuid; n int;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if p_winner_side not in ('A', 'B') then raise exception 'Ganador no válido'; end if;
  my_pair := case p_winner_side when 'A' then m.pair_a_id else m.pair_b_id end;
  if my_pair not in (select public.my_pair_ids()) then raise exception 'Solo la pareja ganadora puede introducir el resultado'; end if;
  if m.status not in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'SCHEDULED', 'PLAYED_PENDING_RESULT', 'RESULT_PENDING_CONFIRMATION', 'DATE_AGREED', 'RESCHEDULE_REQUESTED') then
    raise exception 'Este partido ya no admite resultados (estado %)', m.status;
  end if;
  if (select status from phases where id = m.phase_id) not in ('PUBLISHED', 'ACTIVE') then raise exception 'La fase no está abierta'; end if;
  n := jsonb_array_length(p_sets);
  if n < 1 or n > 3 or exists (
    select 1 from jsonb_array_elements(p_sets) s
    where jsonb_typeof(s->'a') <> 'number' or jsonb_typeof(s->'b') <> 'number'
       or (s->>'a')::int not between 0 and 7 or (s->>'b')::int not between 0 and 7
  ) then raise exception 'Marcador no válido'; end if;

  update result_submissions set status = 'SUPERSEDED' where match_id = p_match and status = 'SUBMITTED';
  update match_date_options set state = 'SUPERSEDED' where match_id = p_match and state = 'ACTIVE';
  insert into result_submissions (match_id, submitted_by_pair, sets, ended_by_time, winner_side, deadline_at)
  values (p_match, my_pair, p_sets, p_ended_by_time, p_winner_side, now() + make_interval(hours => public.season_confirm_hours(m.phase_id)))
  returning id into sub_id;
  update matches set status = 'RESULT_PENDING_CONFIRMATION', sets = p_sets, ended_by_time = p_ended_by_time,
    winner_side = p_winner_side, updated_at = now() where id = p_match;
  perform public.notify_pair(case p_winner_side when 'A' then m.pair_b_id else m.pair_a_id end, p_match, 'RESULT_SUBMITTED', 'Resultado por confirmar',
    public.pair_label(my_pair) || ' ha enviado el resultado. Tenéis 48 horas para confirmarlo o impugnarlo.');
  insert into audit_log (actor, action, entity, entity_id, after)
  values (public.current_email(), 'RESULT_SUBMITTED', 'match', p_match::text,
          jsonb_build_object('sets', p_sets, 'ended_by_time', p_ended_by_time, 'winner', p_winner_side));
  return sub_id;
end $$;

revoke execute on function public.propose_dates(uuid, timestamptz[], boolean), public.respond_option(uuid, boolean), public.withdraw_option(uuid),
  public.register_booking(uuid, text, text), public.request_new_date(uuid, text), public.mark_notifications_read() from public, anon;
grant execute on function public.propose_dates(uuid, timestamptz[], boolean) to authenticated;
grant execute on function public.respond_option(uuid, boolean) to authenticated;
grant execute on function public.withdraw_option(uuid) to authenticated;
grant execute on function public.register_booking(uuid, text, text) to authenticated;
grant execute on function public.request_new_date(uuid, text) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.submit_result(uuid, jsonb, boolean, text) to authenticated;
