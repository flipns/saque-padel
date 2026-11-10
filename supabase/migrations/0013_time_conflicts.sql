-- SAQUE LEAGUE · 0013 · Nadie puede estar en dos partidos a la vez, y rechazar un horario con motivo.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0012. Solo añade (y sustituye propose_dates, respond_option y audit_to_chat).
--
-- 1) Un partido dura 90 minutos. Una pareja que ya tiene otro partido acordado o programado no puede proponer ni aceptar
--    un horario que se solape con él, y cuando una pareja acepta una fecha, las propuestas que quedan pisadas (en los
--    otros partidos de las dos parejas) se retiran solas y se avisa. Es la base de datos la que lo garantiza, también si
--    dos aceptaciones llegan a la vez.
-- 2) Al rechazar un horario se puede elegir el motivo: «no me cuadra» o «no hay pista disponible».

alter table match_date_options add column if not exists reject_reason text check (reject_reason in ('NO_FIT', 'NO_COURT', 'CONFLICT'));

-- Hora de otro partido de la pareja que se solapa con p_start (90 minutos); null si no hay ninguno.
create or replace function public.pair_conflict(p_pair uuid, p_except uuid, p_start timestamptz) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(m.agreed_start_at, m.scheduled_at) from matches m
   where m.id <> p_except and p_pair in (m.pair_a_id, m.pair_b_id)
     and m.status in ('DATE_AGREED', 'SCHEDULED', 'RESCHEDULE_REQUESTED')
     and coalesce(m.agreed_start_at, m.scheduled_at) is not null
     and abs(extract(epoch from (coalesce(m.agreed_start_at, m.scheduled_at) - p_start))) < 5400
   order by coalesce(m.agreed_start_at, m.scheduled_at) limit 1
$$;
revoke execute on function public.pair_conflict(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Tras fijarse la hora de un partido, retira las propuestas activas de los OTROS partidos de las dos parejas que se solapan.
create or replace function public._resolve_time_conflicts(p_match uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m matches; t timestamptz; n int := 0; r record; remaining int; txt text;
begin
  select * into m from matches where id = p_match;
  t := coalesce(m.agreed_start_at, m.scheduled_at);
  if t is null then return 0; end if;
  perform 1 from matches x where x.id in (
    select o.match_id from match_date_options o join matches y on y.id = o.match_id
     where o.state = 'ACTIVE' and o.match_id <> p_match and (y.pair_a_id in (m.pair_a_id, m.pair_b_id) or y.pair_b_id in (m.pair_a_id, m.pair_b_id))
       and abs(extract(epoch from (o.starts_at - t))) < 5400) order by x.id for update;
  for r in
    select o.id as oid, o.match_id, o.starts_at, x.pair_a_id, x.pair_b_id, x.status
      from match_date_options o join matches x on x.id = o.match_id
     where o.state = 'ACTIVE' and o.match_id <> p_match
       and (x.pair_a_id in (m.pair_a_id, m.pair_b_id) or x.pair_b_id in (m.pair_a_id, m.pair_b_id))
       and abs(extract(epoch from (o.starts_at - t))) < 5400
     order by o.id
       for update of o
  loop
    update match_date_options set state = 'SUPERSEDED', reject_reason = 'CONFLICT', decided_at = now() where id = r.oid;
    n := n + 1;
    select count(*) into remaining from match_date_options where match_id = r.match_id and state = 'ACTIVE';
    if remaining = 0 and r.status = 'SCHEDULE_PROPOSED' then update matches set status = 'PENDING_SCHEDULE'::match_status, updated_at = now() where id = r.match_id; end if;
    txt := 'El horario del ' || public.fmt_madrid(r.starts_at) || ' se ha retirado porque una de las parejas ya tiene otro partido a esa hora. Proponed o aceptad otro horario.';
    perform public.notify_pair(r.pair_a_id, r.match_id, 'DATE_CONFLICT', 'Horario ya no disponible', txt);
    perform public.notify_pair(r.pair_b_id, r.match_id, 'DATE_CONFLICT', 'Horario ya no disponible', txt);
    perform public.chat_system(r.match_id, txt);
  end loop;
  return n;
end $$;
revoke execute on function public._resolve_time_conflicts(uuid) from public, anon, authenticated;

-- Para la organización: después de fijar una fecha a mano.
create or replace function public.admin_resolve_time_conflicts(p_match uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo administración'; end if;
  return public._resolve_time_conflicts(p_match);
end $$;
revoke execute on function public.admin_resolve_time_conflicts(uuid) from public, anon;
grant execute on function public.admin_resolve_time_conflicts(uuid) to authenticated;

-- ============ Proponer horarios: no se puede proponer una hora en la que alguna de las dos parejas ya juega ============
create or replace function public.propose_dates(p_match uuid, p_times timestamp with time zone[], p_replace boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  m matches; ph phases; me text := public.current_email();
  my_pair uuid; rival uuid; my_player uuid; n int; t timestamptz; active int; busy timestamptz;
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
    busy := public.pair_conflict(my_pair, p_match, t);
    if busy is not null then raise exception 'El horario del % se solapa con otro partido vuestro (el %). Un partido dura 90 minutos.', public.fmt_madrid(t), public.fmt_madrid(busy); end if;
    busy := public.pair_conflict(rival, p_match, t);
    if busy is not null then raise exception 'El horario del % no es posible: % ya tiene otro partido a esa hora. Elige otro.', public.fmt_madrid(t), public.pair_label(rival); end if;
  end loop;

  update match_date_options set state = 'EXPIRED' where match_id = p_match and state = 'ACTIVE' and starts_at <= now();
  if p_replace then
    update match_date_options set state = 'REJECTED', reject_reason = 'NO_FIT', decided_at = now(), decided_by_email = me, decided_by_pair = my_pair
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

-- ============ Responder a un horario: aceptar (con comprobación de solapes) o rechazar con motivo ============
drop function if exists public.respond_option(uuid, boolean);
create or replace function public.respond_option(p_option uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  o match_date_options; m matches; ph phases; me text := public.current_email(); my_pair uuid; rival uuid; active int; why text; busy timestamptz; pa uuid; pb uuid;
begin
  select * into o from match_date_options where id = p_option;
  if not found then raise exception 'Propuesta no encontrada'; end if;
  if p_accept then
    -- Bloqueo por pareja, siempre en el mismo orden y ANTES de bloquear filas: dos aceptaciones a la vez no pueden dejar a una
    -- pareja en dos partidos a la misma hora, y se evitan los bloqueos cruzados (deadlock).
    select pair_a_id, pair_b_id into pa, pb from matches where id = o.match_id;
    perform pg_advisory_xact_lock(hashtextextended(least(pa::text, pb::text), 0));
    perform pg_advisory_xact_lock(hashtextextended(greatest(pa::text, pb::text), 0));
  end if;
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
    busy := public.pair_conflict(my_pair, m.id, o.starts_at);
    if busy is not null then raise exception 'Ya tenéis otro partido que se solapa con ese horario (el %). Un partido dura 90 minutos: elige otro horario.', public.fmt_madrid(busy); end if;
    busy := public.pair_conflict(rival, m.id, o.starts_at);
    if busy is not null then raise exception '% ya tiene otro partido a esa hora. Proponed otro horario.', public.pair_label(rival); end if;

    update match_date_options set state = 'ACCEPTED', decided_at = now(), decided_by_email = me, decided_by_pair = my_pair where id = p_option;
    update match_date_options set state = 'SUPERSEDED' where match_id = m.id and state = 'ACTIVE' and id <> p_option;
    update matches set agreed_option_id = p_option, agreed_start_at = o.starts_at, status = 'DATE_AGREED'::match_status, updated_at = now() where id = m.id;
    perform public.notify_pair(m.pair_a_id, m.id, 'DATE_AGREED', 'Fecha acordada', 'Partido acordado para el ' || public.fmt_madrid(o.starts_at) || '. Falta reservar la pista y registrarla.', me);
    perform public.notify_pair(m.pair_b_id, m.id, 'DATE_AGREED', 'Fecha acordada', 'Partido acordado para el ' || public.fmt_madrid(o.starts_at) || '. Falta reservar la pista y registrarla.', me);
    insert into audit_log (actor, action, entity, entity_id, after) values (me, 'DATE_ACCEPTED', 'match', m.id::text, jsonb_build_object('option', p_option, 'at', o.starts_at));
    perform public._resolve_time_conflicts(m.id);   -- las propuestas que esta fecha pisa en los demás partidos de las dos parejas se retiran
  else
    why := coalesce(nullif(trim(p_reason), ''), 'NO_FIT');
    if why not in ('NO_FIT', 'NO_COURT') then raise exception 'Motivo no válido.'; end if;
    update match_date_options set state = 'REJECTED', reject_reason = why, decided_at = now(), decided_by_email = me, decided_by_pair = my_pair where id = p_option;
    select count(*) into active from match_date_options where match_id = m.id and state = 'ACTIVE';
    if active = 0 and m.status = 'SCHEDULE_PROPOSED' then update matches set status = 'PENDING_SCHEDULE'::match_status, updated_at = now() where id = m.id; end if;
    if active = 0 then
      perform public.notify_pair(rival, m.id, 'DATES_REJECTED', 'Horarios rechazados',
        public.pair_label(my_pair) || (case when why = 'NO_COURT' then ' no puede en ninguno de los horarios propuestos porque no hay pista disponible a esas horas.' else ' no puede en ninguno de los horarios propuestos.' end) || ' Proponed otros.', me);
    end if;
    insert into audit_log (actor, action, entity, entity_id, after, reason) values (me, 'DATE_REJECTED', 'match', m.id::text, jsonb_build_object('option', p_option, 'at', o.starts_at), why);
  end if;
end $$;

revoke execute on function public.respond_option(uuid, boolean, text), public.propose_dates(uuid, timestamptz[], boolean) from public, anon;
grant execute on function public.respond_option(uuid, boolean, text) to authenticated;
grant execute on function public.propose_dates(uuid, timestamptz[], boolean) to authenticated;

-- ============ Avisos del sistema en el chat (el rechazo ahora dice el motivo) ============
create or replace function public.audit_to_chat() returns trigger
language plpgsql security definer set search_path = public as $$
declare mid uuid; who text; txt text; times text; n int; is_org boolean := false;
begin
  if new.entity <> 'match' or new.entity_id is null then return new; end if;
  begin mid := new.entity_id::uuid; exception when others then return new; end;
  if not exists (select 1 from matches where id = mid) then return new; end if;
  if exists (select 1 from admins where email = new.actor) then is_org := true; who := 'La organización';
  else
    select pl.full_name into who
      from pair_access pa join players pl on pl.id = pa.player_id join matches m on pa.pair_id in (m.pair_a_id, m.pair_b_id)
     where m.id = mid and pa.email = new.actor limit 1;
    who := coalesce(who, 'Un jugador');
  end if;
  if new.action in ('DATES_PROPOSED', 'DATES_COUNTERPROPOSED') then
    select count(*), string_agg(public.fmt_madrid(e::timestamptz), ', ' order by e::timestamptz) into n, times from jsonb_array_elements_text(new.after -> 'times') e;
  end if;
  txt := case new.action
    when 'DATES_PROPOSED' then who || ' propone ' || n || (case when n = 1 then ' horario: ' else ' horarios: ' end) || times || '.'
    when 'DATES_COUNTERPROPOSED' then who || ' no puede en los horarios anteriores y propone otros: ' || times || '.'
    when 'DATE_ACCEPTED' then who || ' ha aceptado el horario del ' || public.fmt_madrid((new.after ->> 'at')::timestamptz) || '. Fecha acordada: falta reservar la pista.'
    when 'DATE_REJECTED' then who || ' ha rechazado ' || coalesce('el horario del ' || public.fmt_madrid((new.after ->> 'at')::timestamptz), 'un horario') || (case when new.reason = 'NO_COURT' then ': no hay pista disponible.' else ': no le cuadra.' end)
    when 'DATE_WITHDRAWN' then who || ' ha retirado un horario.'
    when 'BOOKING_REGISTERED' then who || ' ha registrado la pista ' || coalesce(new.after ->> 'court', '') || ' para el ' || public.fmt_madrid((new.after ->> 'at')::timestamptz) || '. Partido programado.'
    when 'COURT_CHANGED' then who || ' ha cambiado la pista a ' || coalesce(new.after ->> 'court', '') || '.'
    when 'RESCHEDULE_REQUESTED' then who || ' pide cambiar la fecha' || coalesce(': ' || new.reason, '.')
    when 'RESULT_SUBMITTED' then who || ' ha enviado el resultado. Pendiente de confirmar por la otra pareja.'
    when 'RESULT_CORRECTED' then who || ' ha corregido el resultado. Pendiente de confirmar por la otra pareja.'
    when 'RESULT_WITHDRAWN' then who || ' ha retirado el resultado que había enviado.'
    when 'RESULT_CONFIRMED' then who || ' ha confirmado el resultado.'
    when 'RESULT_DISPUTED' then who || ' ha impugnado el resultado' || coalesce(': «' || new.reason || '».', '.') || coalesce(' Su versión: ' || (new.after ->> 'version') || ' (sus juegos primero).', '')
    when 'RESULT_SET_BY_ADMIN' then 'La organización ha fijado el resultado.'
    when 'SUBMISSION_ACCEPTED_BY_ADMIN' then 'La organización ha validado el resultado enviado.'
    when 'DISPUTE_VERSION_ACCEPTED_BY_ADMIN' then 'La organización ha validado la versión de la pareja que impugnó.'
    when 'WO_APPLIED' then 'La organización ha registrado un WO.'
    when 'MATCH_NOT_PLAYED' then 'La organización ha marcado el partido como no disputado.'
    when 'SCHEDULE_SET_BY_ADMIN' then 'La organización ha fijado la fecha del partido.'
    when 'MATCH_RESET' then 'La organización ha restablecido el partido.'
    else null end;
  if txt is not null then perform public.chat_system(mid, txt); end if;
  return new;
exception when others then
  return new;   -- el chat es secundario: nunca debe romper la acción original
end $$;
revoke execute on function public.audit_to_chat() from public, anon, authenticated;
