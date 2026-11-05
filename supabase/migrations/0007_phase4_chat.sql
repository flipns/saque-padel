-- SAQUE LEAGUE · 0007 · Fase 4: chat de cuatro por partido.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0006. Solo añade (y sustituye auto_confirm_due).

-- ============ Datos ============
create table if not exists match_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  kind text not null default 'USER' check (kind in ('USER', 'SYSTEM', 'ORG')),   -- jugador, aviso del sistema, mensaje de la organización
  author_pair uuid references pairs,
  author_player uuid references players,
  author_email text,
  author_name text,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,                -- moderación: el original se conserva solo para la organización
  deleted_by text,
  delete_reason text
);
create index if not exists match_messages_match_idx on match_messages (match_id, created_at);
create index if not exists match_messages_author_idx on match_messages (author_email, created_at) where kind = 'USER';

create table if not exists match_chat_reads (
  match_id uuid not null references matches on delete cascade,
  email text not null check (email = lower(email)),
  last_read_at timestamptz not null default now(),
  primary key (match_id, email)
);

-- ============ Permisos ============
-- Los jugadores NO leen la tabla directamente (un mensaje borrado no debe llegarles ni en el cuerpo): solo mediante chat_messages().
alter table match_messages enable row level security;
alter table match_chat_reads enable row level security;
drop policy if exists match_messages_admin_all on match_messages;
create policy match_messages_admin_all on match_messages for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists match_chat_reads_admin_all on match_chat_reads;
create policy match_chat_reads_admin_all on match_chat_reads for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ============ Auxiliar interno: mensaje del sistema ============
create or replace function public.chat_system(p_match uuid, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into match_messages (match_id, kind, author_name, body) values (p_match, 'SYSTEM', 'Sistema', left(p_text, 1000))
$$;
revoke execute on function public.chat_system(uuid, text) from public, anon, authenticated;

-- ============ Acciones de jugador ============

-- Escribe en el chat de su partido. Necesita haber indicado quién eres; solo texto, 1000 caracteres, 20 mensajes por minuto.
create or replace function public.send_chat_message(p_match uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m matches; me text := public.current_email(); my_pair uuid; my_player uuid; nm text; b text := trim(coalesce(p_body, '')); new_id uuid;
begin
  select * into m from matches where id = p_match;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.pair_a_id in (select public.my_pair_ids()) then my_pair := m.pair_a_id;
  elsif m.pair_b_id in (select public.my_pair_ids()) then my_pair := m.pair_b_id;
  else raise exception 'Este partido no es tuyo'; end if;
  select player_id into my_player from pair_access where pair_id = my_pair and email = me;
  if my_player is null then raise exception 'Antes de escribir, indica quién eres.'; end if;
  if m.status in ('COMPLETED', 'WO', 'NOT_PLAYED', 'CANCELLED') then raise exception 'El partido ya está cerrado: el chat queda solo de lectura.'; end if;
  if b = '' then raise exception 'Escribe un mensaje.'; end if;
  if char_length(b) > 1000 then raise exception 'El mensaje es demasiado largo (máximo 1000 caracteres).'; end if;
  if (select count(*) from match_messages where author_email = me and kind = 'USER' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Vas muy rápido: espera unos segundos.';
  end if;
  select full_name into nm from players where id = my_player;
  insert into match_messages (match_id, kind, author_pair, author_player, author_email, author_name, body)
  values (p_match, 'USER', my_pair, my_player, me, nm, b) returning id into new_id;

  -- Un solo aviso (y un solo email) por ráfaga: no se crea otro hasta que el destinatario lea el anterior.
  insert into notifications (email, match_id, kind, title, body)
  select pa.email, p_match, 'CHAT_MESSAGE', 'Nuevo mensaje en el chat del partido', nm || ' ha escrito en el chat de vuestro partido. Entra para leerlo y responder.'
    from pair_access pa
   where pa.pair_id in (m.pair_a_id, m.pair_b_id) and pa.email <> me
     and not exists (select 1 from notifications n where n.email = pa.email and n.match_id = p_match and n.kind = 'CHAT_MESSAGE' and n.read_at is null);
  return new_id;
end $$;

-- Mensajes del chat de un partido. Los borrados llegan sin texto (se enseña «eliminado por la organización»).
create or replace function public.chat_messages(p_match uuid, p_limit int default 200)
returns table (id uuid, kind text, author_name text, author_pair uuid, is_mine boolean, body text, deleted boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from matches m where m.id = p_match and (m.pair_a_id in (select public.my_pair_ids()) or m.pair_b_id in (select public.my_pair_ids()))) then
    raise exception 'Este partido no es tuyo';
  end if;
  return query
    select x.id, x.kind, x.author_name, x.author_pair, x.is_mine, x.body, x.deleted, x.created_at from (
      select mm.id, mm.kind, mm.author_name, mm.author_pair, coalesce(mm.author_email = public.current_email(), false) as is_mine,
             case when mm.deleted_at is null then mm.body else null end as body, (mm.deleted_at is not null) as deleted, mm.created_at
        from match_messages mm where mm.match_id = p_match
       order by mm.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) x order by x.created_at;
end $$;

-- Marca el chat como leído y da por leído su aviso.
create or replace function public.mark_chat_read(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.current_email();
begin
  if not exists (select 1 from matches m where m.id = p_match and (m.pair_a_id in (select public.my_pair_ids()) or m.pair_b_id in (select public.my_pair_ids()))) then
    raise exception 'Este partido no es tuyo';
  end if;
  insert into match_chat_reads (match_id, email, last_read_at) values (p_match, me, now())
  on conflict (match_id, email) do update set last_read_at = now();
  update notifications set read_at = now() where email = me and match_id = p_match and kind = 'CHAT_MESSAGE' and read_at is null;
end $$;

-- Mensajes sin leer de mis partidos (sin contar los avisos del sistema).
create or replace function public.chat_unread_counts() returns table (match_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select mm.match_id, count(*)
    from match_messages mm
    join matches m on m.id = mm.match_id
    left join match_chat_reads r on r.match_id = mm.match_id and r.email = public.current_email()
   where (m.pair_a_id in (select public.my_pair_ids()) or m.pair_b_id in (select public.my_pair_ids()))
     and mm.deleted_at is null and mm.kind <> 'SYSTEM' and coalesce(mm.author_email, '') <> public.current_email()
     and mm.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
   group by mm.match_id
$$;

-- ============ Avisos del sistema dentro del chat ============
-- Cada acción importante ya queda en la auditoría; este disparador la cuenta también en el chat del partido.
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
    when 'RESULT_CONFIRMED' then who || ' ha confirmado el resultado.'
    when 'RESULT_DISPUTED' then who || ' ha impugnado el resultado' || coalesce(': «' || new.reason || '»', '.')
    when 'RESULT_SET_BY_ADMIN' then 'La organización ha fijado el resultado.'
    when 'SUBMISSION_ACCEPTED_BY_ADMIN' then 'La organización ha validado el resultado enviado.'
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
drop trigger if exists audit_log_to_chat on audit_log;
create trigger audit_log_to_chat after insert on audit_log for each row execute function public.audit_to_chat();

-- La autoconfirmación también deja constancia en el chat.
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
    perform public.chat_system(r.match_id, 'Pasaron 48 horas sin respuesta: el resultado se ha confirmado automáticamente.');
    n := n + 1;
  end loop;
  if n > 0 then
    insert into audit_log (actor, action, entity, reason) values ('system', 'AUTO_CONFIRM', 'match', n || ' resultados');
  end if;
  return n;
end $$;
revoke execute on function public.auto_confirm_due() from public, anon, authenticated;
grant execute on function public.auto_confirm_due() to service_role;

-- ============ Retención ============
-- Los chats se conservan hasta un mes después del Saque Masters (configurable: seasons.rules.chatRetentionMonths).
create or replace function public.purge_expired_chats() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from match_messages mm using matches m, phases ph, seasons s
   where mm.match_id = m.id and ph.id = m.phase_id and s.id = ph.season_id
     and now() > ((s.masters_ends_on + make_interval(months => coalesce((s.rules ->> 'chatRetentionMonths')::int, 1)))::timestamp at time zone 'Europe/Madrid');
  get diagnostics n = row_count;
  if n > 0 then insert into audit_log (actor, action, entity, reason) values ('system', 'CHAT_PURGED', 'chat', n || ' mensajes'); end if;
  return n;
end $$;
revoke execute on function public.purge_expired_chats() from public, anon, authenticated;
grant execute on function public.purge_expired_chats() to service_role;

-- ============ Permisos de ejecución ============
revoke execute on function public.send_chat_message(uuid, text), public.chat_messages(uuid, int), public.mark_chat_read(uuid), public.chat_unread_counts() from public, anon;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
grant execute on function public.chat_messages(uuid, int) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.chat_unread_counts() to authenticated;
