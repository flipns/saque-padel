-- SAQUE LEAGUE · 0004 · Fase 1: identidad del jugador y alta del email del compañero.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001, 0002 y 0003. Solo añade; no borra ni cambia datos.

-- Cada email con acceso a una pareja puede vincularse a uno de sus dos jugadores (lo necesitarán el chat y el calendario).
alter table pair_access add column if not exists player_id uuid references players (id) on delete set null;
alter table pair_access add column if not exists added_by text;                       -- email de quien lo añadió (null = importado o añadido por la organización)
alter table pair_access add column if not exists added_at timestamptz not null default now();
create index if not exists pair_access_player_idx on pair_access (player_id);

-- Qué jugadores tiene mi pareja, cuál soy yo y quién ya tiene acceso. No expone emails de nadie.
create or replace function public.pair_identity(p_pair uuid)
returns table (player_id uuid, full_name text, is_me boolean, has_access boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_pair not in (select public.my_pair_ids()) then return; end if;
  return query
    select pm.player_id, pl.full_name,
           exists (select 1 from pair_access pa where pa.pair_id = p_pair and pa.player_id = pm.player_id and pa.email = public.current_email()),
           exists (select 1 from pair_access pa where pa.pair_id = p_pair and pa.player_id = pm.player_id)
      from pair_members pm
      join players pl on pl.id = pm.player_id
     where pm.pair_id = p_pair
     order by pm.slot;
end $$;

-- «¿Quién eres?»: vincula mi email con mi jugador dentro de la pareja.
create or replace function public.claim_identity(p_pair uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me text := public.current_email(); current_player uuid;
begin
  if p_pair not in (select public.my_pair_ids()) then raise exception 'Esta pareja no es tuya'; end if;
  if not exists (select 1 from pair_members where pair_id = p_pair and player_id = p_player) then
    raise exception 'Ese jugador no pertenece a tu pareja';
  end if;
  if exists (select 1 from pair_access where pair_id = p_pair and player_id = p_player and email <> me) then
    raise exception 'Ese jugador ya está vinculado a otro email. Si es un error, avisa a la organización.';
  end if;
  select player_id into current_player from pair_access where pair_id = p_pair and email = me;
  if current_player is not null and current_player <> p_player then
    raise exception 'Ya indicaste quién eres. Para cambiarlo, avisa a la organización.';
  end if;
  update pair_access set player_id = p_player where pair_id = p_pair and email = me;
  insert into audit_log (actor, action, entity, entity_id, after)
  values (me, 'IDENTITY_CLAIMED', 'pair', p_pair::text, jsonb_build_object('player_id', p_player));
end $$;

-- Añade el email de mi compañero/a para que pueda entrar. Máximo un email por jugador; queda registrado quién lo añadió.
create or replace function public.add_partner_email(p_pair uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare me text := public.current_email(); mine uuid; partner uuid; e text := lower(trim(coalesce(p_email, '')));
begin
  if p_pair not in (select public.my_pair_ids()) then raise exception 'Esta pareja no es tuya'; end if;
  select player_id into mine from pair_access where pair_id = p_pair and email = me;
  if mine is null then raise exception 'Primero indica quién eres.'; end if;
  select player_id into partner from pair_members where pair_id = p_pair and player_id <> mine limit 1;
  if partner is null then raise exception 'No se encuentra a tu compañero/a en la pareja.'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un email válido.'; end if;
  if e = me then raise exception 'Ese es tu propio email: escribe el de tu compañero/a.'; end if;
  if exists (select 1 from pair_access where pair_id = p_pair and player_id = partner) then
    raise exception 'Tu compañero/a ya tiene un email de acceso. Para cambiarlo, avisa a la organización.';
  end if;
  if exists (select 1 from pair_access where pair_id = p_pair and email = e) then
    update pair_access set player_id = partner where pair_id = p_pair and email = e and player_id is null;
  else
    insert into pair_access (pair_id, email, player_id, added_by) values (p_pair, e, partner, me);
  end if;
  insert into audit_log (actor, action, entity, entity_id, after)
  values (me, 'PARTNER_EMAIL_ADDED', 'pair', p_pair::text, jsonb_build_object('email', e, 'player_id', partner));
end $$;

grant execute on function public.pair_identity(uuid) to authenticated;
grant execute on function public.claim_identity(uuid, uuid) to authenticated;
grant execute on function public.add_partner_email(uuid, text) to authenticated;
