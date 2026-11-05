-- SAQUE LEAGUE · 0006 · Fase 3: avisos por email, preferencias, recordatorios y avisos de resultado.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0005. Solo añade (y sustituye respond_result y auto_confirm_due).

-- ============ Cola de emails ============
alter table notifications add column if not exists email_status text;           -- SENT | SKIPPED_OPTOUT | SKIPPED_BACKLOG
alter table notifications add column if not exists email_attempts int not null default 0;
alter table notifications add column if not exists email_claimed_at timestamptz;
alter table notifications add column if not exists email_error text;
alter table notifications add column if not exists dedupe_key text;              -- evita repetir un mismo recordatorio

create unique index if not exists notifications_dedupe_idx on notifications (email, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_pending_idx on notifications (created_at) where emailed_at is null;

-- Lo anterior a esta migración no se envía por email (ya se vio dentro de la web).
update notifications set emailed_at = now(), email_status = 'SKIPPED_BACKLOG' where emailed_at is null;

-- ============ Preferencias ============
create table if not exists notification_prefs (
  email text primary key check (email = lower(email)),
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table notification_prefs enable row level security;
drop policy if exists notification_prefs_admin_all on notification_prefs;
create policy notification_prefs_admin_all on notification_prefs for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists notification_prefs_own on notification_prefs;
create policy notification_prefs_own on notification_prefs for select to authenticated using (email = (select public.current_email()));

create or replace function public.set_email_pref(p_enabled boolean) returns void
language sql security definer set search_path = public as $$
  insert into notification_prefs (email, email_enabled, updated_at) values (public.current_email(), p_enabled, now())
  on conflict (email) do update set email_enabled = excluded.email_enabled, updated_at = now()
$$;
revoke execute on function public.set_email_pref(boolean) from public, anon;
grant execute on function public.set_email_pref(boolean) to authenticated;

-- ============ Reserva atómica de emails pendientes (solo servidor) ============
-- Varias ejecuciones a la vez nunca se reparten la misma fila. Máximo 3 intentos; un intento «colgado» se reintenta a los 10 minutos.
create or replace function public.claim_pending_emails(p_limit int default 50)
returns table (id uuid, email text, match_id uuid, kind text, title text, body text, created_at timestamptz)
language sql security definer set search_path = public as $$
  update notifications n
     set email_attempts = n.email_attempts + 1, email_claimed_at = now()
   where n.id in (
     select x.id from notifications x
      where x.emailed_at is null and x.email_attempts < 3
        and (x.email_claimed_at is null or x.email_claimed_at < now() - interval '10 minutes')
        and x.created_at > now() - interval '3 days'
      order by x.created_at
      limit greatest(1, least(coalesce(p_limit, 50), 500))
      for update skip locked)
  returning n.id, n.email, n.match_id, n.kind, n.title, n.body, n.created_at
$$;
revoke execute on function public.claim_pending_emails(int) from public, anon, authenticated;
grant execute on function public.claim_pending_emails(int) to service_role;

-- ============ Recordatorios automáticos (solo servidor / tarea programada) ============
-- 1) Horarios propuestos hace más de 48 h sin respuesta -> a la pareja que tiene que responder.
-- 2) Cierre de fase: aviso a los 7 días y a las 48 h para los partidos aún sin jugar.
-- Es idempotente: cada recordatorio se crea una sola vez (dedupe_key).
create or replace function public.generate_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; c int; total int := 0; tag text; msg text; dl text;
begin
  for r in
    select o.match_id, o.proposed_by_pair, max(o.created_at) as last_at, m.pair_a_id, m.pair_b_id
      from match_date_options o join matches m on m.id = o.match_id
     where o.state = 'ACTIVE' and o.starts_at > now() and o.created_at <= now() - interval '48 hours'
       and m.status in ('SCHEDULE_PROPOSED', 'RESCHEDULE_REQUESTED')
     group by o.match_id, o.proposed_by_pair, m.pair_a_id, m.pair_b_id
  loop
    insert into notifications (email, match_id, kind, title, body, dedupe_key)
    select pa.email, r.match_id, 'REMINDER_NO_RESPONSE', 'Os esperan una respuesta',
           public.pair_label(r.proposed_by_pair) || ' os propuso horarios hace más de 2 días y siguen sin respuesta. Entra y acepta uno, o proponed otros.',
           'resp48:' || r.match_id || ':' || floor(extract(epoch from r.last_at))::bigint
      from pair_access pa
     where pa.pair_id = case when r.proposed_by_pair = r.pair_a_id then r.pair_b_id else r.pair_a_id end
    on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics c = row_count; total := total + c;
  end loop;

  for r in
    select m.id as match_id, m.pair_a_id, m.pair_b_id, m.status, m.scheduled_at, ph.results_deadline,
           ((ph.results_deadline + 1)::timestamp at time zone 'Europe/Madrid') as deadline_end
      from matches m join phases ph on ph.id = m.phase_id
     where ph.status in ('PUBLISHED', 'ACTIVE')
       and m.status in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'DATE_AGREED', 'RESCHEDULE_REQUESTED', 'SCHEDULED', 'PLAYED_PENDING_RESULT')
       and now() < ((ph.results_deadline + 1)::timestamp at time zone 'Europe/Madrid')
       and now() >= ((ph.results_deadline + 1)::timestamp at time zone 'Europe/Madrid') - interval '7 days'
  loop
    tag := case when now() >= r.deadline_end - interval '48 hours' then 'DEADLINE_48H' else 'DEADLINE_7D' end;
    dl := to_char(r.results_deadline, 'DD/MM');
    msg := 'El plazo de la fase termina el ' || dl || '. ' || case
      when r.status in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED') then 'Todavía no tenéis fecha acordada: proponed o aceptad un horario cuanto antes.'
      when r.status = 'DATE_AGREED' then 'Tenéis fecha acordada pero falta reservar la pista y apuntarla.'
      when r.status = 'RESCHEDULE_REQUESTED' then 'Hay un cambio de fecha en curso: acordad un nuevo horario a tiempo.'
      else 'Vuestro partido está programado' || coalesce(' el ' || public.fmt_madrid(r.scheduled_at), '') || '. Recordad subir el resultado.' end;
    insert into notifications (email, match_id, kind, title, body, dedupe_key)
    select pa.email, r.match_id, tag,
           case when tag = 'DEADLINE_48H' then 'Quedan 48 horas para el cierre de la fase' else 'Se acerca el cierre de la fase' end,
           msg, lower(tag) || ':' || r.match_id
      from pair_access pa where pa.pair_id in (r.pair_a_id, r.pair_b_id)
    on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics c = row_count; total := total + c;
  end loop;
  return total;
end $$;
revoke execute on function public.generate_reminders() from public, anon, authenticated;
grant execute on function public.generate_reminders() to service_role;

-- ============ Avisos de resultado ============
create or replace function public.respond_result(p_submission uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s result_submissions; m matches; rival uuid;
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
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la impugnación'; end if;
    update result_submissions set status = 'DISPUTED', responded_at = now(), responded_by = auth.uid(), dispute_reason = p_reason where id = s.id;
    update matches set status = 'DISPUTED', updated_at = now() where id = m.id;
    perform public.notify_pair(s.submitted_by_pair, m.id, 'RESULT_DISPUTED', 'Resultado impugnado',
      public.pair_label(rival) || ' ha impugnado el resultado: «' || trim(p_reason) || '». La organización decidirá.', public.current_email());
  end if;
  insert into audit_log (actor, action, entity, entity_id, reason)
  values (public.current_email(), case when p_accept then 'RESULT_CONFIRMED' else 'RESULT_DISPUTED' end, 'match', m.id::text, p_reason);
end $$;

create or replace function public.auto_confirm_due() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    select s.id as sid, s.match_id, m.pair_a_id, m.pair_b_id
      from result_submissions s join matches m on m.id = s.match_id
     where s.status = 'SUBMITTED' and s.deadline_at <= now()
       for update of s, m skip locked
  loop
    update result_submissions set status = 'AUTO_CONFIRMED', responded_at = now() where id = r.sid;
    update matches set status = 'COMPLETED', confirmed_at = now(), updated_at = now() where id = r.match_id and status = 'RESULT_PENDING_CONFIRMATION';
    perform public.notify_pair(r.pair_a_id, r.match_id, 'RESULT_AUTO_CONFIRMED', 'Resultado confirmado', 'Pasaron 48 horas sin respuesta y el resultado se ha dado por bueno. Ya cuenta para la clasificación.');
    perform public.notify_pair(r.pair_b_id, r.match_id, 'RESULT_AUTO_CONFIRMED', 'Resultado confirmado', 'Pasaron 48 horas sin respuesta y el resultado se ha dado por bueno. Ya cuenta para la clasificación.');
    n := n + 1;
  end loop;
  if n > 0 then
    insert into audit_log (actor, action, entity, reason) values ('system', 'AUTO_CONFIRM', 'match', n || ' resultados');
  end if;
  return n;
end $$;
revoke execute on function public.auto_confirm_due() from public, anon, authenticated;

-- ============ Aviso al publicar una fase (solo administración) ============
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
         'Entra para ver tu grupo y tus rivales. Proponed fechas cuanto antes: el plazo para jugar termina el ' || to_char(ph.results_deadline, 'DD/MM') || '.',
         'phase_published:' || ph.id
    from group_pairs gp join pair_access pa on pa.pair_id = gp.pair_id
   where gp.phase_id = p_phase
  on conflict (email, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics c = row_count;
  return c;
end $$;
revoke execute on function public.notify_phase_published(uuid) from public, anon;
grant execute on function public.notify_phase_published(uuid) to authenticated;

-- La tarea diaria también confirma automáticamente los resultados vencidos (copia de seguridad de pg_cron).
grant execute on function public.auto_confirm_due() to service_role;
