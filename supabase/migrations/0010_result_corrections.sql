-- SAQUE LEAGUE · 0010 · Impugnar proponiendo el resultado exacto, y corregir o retirar un resultado enviado.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0009. Solo añade (y sustituye submit_result, respond_result y audit_to_chat).

-- ============ Datos ============
-- Versión del resultado que propone la pareja que impugna (orientada como el resto: pareja A – pareja B).
alter table result_submissions add column if not exists dispute_sets jsonb;
alter table result_submissions add column if not exists dispute_ended_by_time boolean not null default false;

-- Texto «6-4 3-6» de unos sets, con los juegos de la pareja indicada primero (p_first_is_a = true: la pareja A).
create or replace function public.sets_text(p_sets jsonb, p_first_is_a boolean) returns text
language sql immutable as $$
  select string_agg(case when p_first_is_a then (s ->> 'a') || '-' || (s ->> 'b') else (s ->> 'b') || '-' || (s ->> 'a') end, ' ' order by ord)
    from jsonb_array_elements(p_sets) with ordinality as t(s, ord)
$$;

-- ============ Impugnar (ahora puede proponer el resultado exacto) ============
drop function if exists public.respond_result(uuid, boolean, text);
create or replace function public.respond_result(p_submission uuid, p_accept boolean, p_reason text default null, p_sets jsonb default null, p_ended_by_time boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare s result_submissions; m matches; rival uuid; version text; n int;
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
    perform public.notify_pair(s.submitted_by_pair, m.id, 'RESULT_CONFIRMED', 'Resultado confirmado',
      public.pair_label(rival) || ' ha confirmado el resultado. Ya cuenta para la clasificación y el ranking.', public.current_email());
    insert into audit_log (actor, action, entity, entity_id, reason) values (public.current_email(), 'RESULT_CONFIRMED', 'match', m.id::text, p_reason);
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la impugnación'; end if;
    if p_sets is not null then
      if jsonb_typeof(p_sets) <> 'array' then raise exception 'Marcador no válido'; end if;
      n := jsonb_array_length(p_sets);
      if n < 1 or n > 3 or exists (
        select 1 from jsonb_array_elements(p_sets) x
        where jsonb_typeof(x -> 'a') <> 'number' or jsonb_typeof(x -> 'b') <> 'number' or (x ->> 'a')::int not between 0 and 7 or (x ->> 'b')::int not between 0 and 7
      ) then raise exception 'Marcador no válido'; end if;
      version := public.sets_text(p_sets, rival = m.pair_a_id);   -- los juegos de quien impugna, primero
    end if;
    update result_submissions set status = 'DISPUTED', responded_at = now(), responded_by = auth.uid(), dispute_reason = p_reason,
           dispute_sets = p_sets, dispute_ended_by_time = coalesce(p_ended_by_time, false) where id = s.id;
    update matches set status = 'DISPUTED', updated_at = now() where id = m.id;
    perform public.notify_pair(s.submitted_by_pair, m.id, 'RESULT_DISPUTED', 'Resultado impugnado',
      public.pair_label(rival) || ' ha impugnado el resultado: «' || trim(p_reason) || '».'
      || coalesce(' Su versión: ' || version || ' (sus juegos primero).', '') || ' La organización decidirá.', public.current_email());
    insert into audit_log (actor, action, entity, entity_id, after, reason)
    values (public.current_email(), 'RESULT_DISPUTED', 'match', m.id::text, case when version is null then null else jsonb_build_object('version', version) end, p_reason);
  end if;
end $$;

-- ============ Corregir un resultado enviado ============
-- La pareja ganadora puede volver a enviarlo mientras la otra no lo haya confirmado (también si lo ha impugnado).
-- Reinicia las 48 horas y avisa a la otra pareja. Máximo 5 envíos por partido: después, decide la organización.
create or replace function public.submit_result(p_match uuid, p_sets jsonb, p_ended_by_time boolean, p_winner_side text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m matches; my_pair uuid; sub_id uuid; n int; prior int; fixing boolean;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if p_winner_side not in ('A', 'B') then raise exception 'Ganador no válido'; end if;
  my_pair := case p_winner_side when 'A' then m.pair_a_id else m.pair_b_id end;
  if my_pair not in (select public.my_pair_ids()) then raise exception 'Solo la pareja ganadora puede introducir el resultado'; end if;
  if m.status not in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'SCHEDULED', 'PLAYED_PENDING_RESULT', 'RESULT_PENDING_CONFIRMATION', 'DISPUTED', 'DATE_AGREED', 'RESCHEDULE_REQUESTED') then
    raise exception 'Este partido ya no admite resultados (estado %)', m.status;
  end if;
  if (select status from phases where id = m.phase_id) not in ('PUBLISHED', 'ACTIVE') then raise exception 'La fase no está abierta'; end if;
  n := jsonb_array_length(p_sets);
  if n < 1 or n > 3 or exists (
    select 1 from jsonb_array_elements(p_sets) s
    where jsonb_typeof(s->'a') <> 'number' or jsonb_typeof(s->'b') <> 'number'
       or (s->>'a')::int not between 0 and 7 or (s->>'b')::int not between 0 and 7
  ) then raise exception 'Marcador no válido'; end if;

  select count(*) into prior from result_submissions where match_id = p_match and coalesce(resolution_note, '') <> 'Restablecido por la organización';
  if prior >= 5 then raise exception 'Este resultado se ha enviado demasiadas veces: la organización decidirá.'; end if;
  fixing := prior > 0;

  update result_submissions set status = 'SUPERSEDED' where match_id = p_match and status in ('SUBMITTED', 'DISPUTED');
  update match_date_options set state = 'SUPERSEDED' where match_id = p_match and state = 'ACTIVE';
  insert into result_submissions (match_id, submitted_by_pair, sets, ended_by_time, winner_side, deadline_at)
  values (p_match, my_pair, p_sets, p_ended_by_time, p_winner_side, now() + make_interval(hours => public.season_confirm_hours(m.phase_id)))
  returning id into sub_id;
  update matches set status = 'RESULT_PENDING_CONFIRMATION', sets = p_sets, ended_by_time = p_ended_by_time,
    winner_side = p_winner_side, updated_at = now() where id = p_match;
  perform public.notify_pair(case p_winner_side when 'A' then m.pair_b_id else m.pair_a_id end, p_match, 'RESULT_SUBMITTED',
    case when fixing then 'Resultado corregido' else 'Resultado por confirmar' end,
    public.pair_label(my_pair) || case when fixing then ' ha corregido el resultado. ' else ' ha enviado el resultado. ' end || 'Tenéis 48 horas para confirmarlo o impugnarlo.');
  insert into audit_log (actor, action, entity, entity_id, after)
  values (public.current_email(), case when fixing then 'RESULT_CORRECTED' else 'RESULT_SUBMITTED' end, 'match', p_match::text,
          jsonb_build_object('sets', p_sets, 'ended_by_time', p_ended_by_time, 'winner', p_winner_side));
  return sub_id;
end $$;

-- ============ Retirar un resultado enviado ============
-- Solo la pareja que lo envió y mientras no esté confirmado. El partido vuelve al estado en el que estaba.
create or replace function public.withdraw_result(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches; s result_submissions; other uuid;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.status not in ('RESULT_PENDING_CONFIRMATION', 'DISPUTED') then raise exception 'No hay ningún resultado pendiente que retirar.'; end if;
  select * into s from result_submissions where match_id = p_match and status in ('SUBMITTED', 'DISPUTED') order by submitted_at desc limit 1 for update;
  if not found then raise exception 'No hay ningún resultado pendiente que retirar.'; end if;
  if s.submitted_by_pair not in (select public.my_pair_ids()) then raise exception 'Solo puede retirarlo la pareja que lo envió.'; end if;
  other := case when s.submitted_by_pair = m.pair_a_id then m.pair_b_id else m.pair_a_id end;

  update result_submissions set status = 'SUPERSEDED', responded_at = now(), resolution_note = 'Retirado por la pareja que lo envió' where id = s.id;
  update matches set sets = '[]'::jsonb, winner_side = null, ended_by_time = false, updated_at = now(),
    status = case when m.scheduled_at is not null then 'SCHEDULED'::match_status when m.agreed_start_at is not null then 'DATE_AGREED'::match_status else 'PENDING_SCHEDULE'::match_status end
   where id = p_match;
  perform public.notify_pair(other, p_match, 'RESULT_WITHDRAWN', 'Resultado retirado',
    public.pair_label(s.submitted_by_pair) || ' ha retirado el resultado que había enviado. Esperad a que envíen el correcto.', public.current_email());
  insert into audit_log (actor, action, entity, entity_id) values (public.current_email(), 'RESULT_WITHDRAWN', 'match', p_match::text);
end $$;

-- ============ Avisos del sistema en el chat ============
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
    when 'DATE_REJECTED' then who || ' ha rechazado un horario.'
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

-- ============ Permisos de ejecución ============
revoke execute on function public.respond_result(uuid, boolean, text, jsonb, boolean), public.submit_result(uuid, jsonb, boolean, text), public.withdraw_result(uuid) from public, anon;
grant execute on function public.respond_result(uuid, boolean, text, jsonb, boolean) to authenticated;
grant execute on function public.submit_result(uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.withdraw_result(uuid) to authenticated;
