-- SAQUE LEAGUE · 0002 · Zona de jugador, permisos más estrictos y contactos entre rivales.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001_schema.sql.

-- Los teléfonos de los rivales solo se muestran si la organización lo activa (Ajustes). Nunca los de menores.
alter table seasons add column if not exists share_rival_contact boolean not null default false;

-- Los jugadores solo ven grupos y partidos de fases ya publicadas (los borradores son solo de administración).
drop policy if exists groups_read on groups;
create policy groups_read on groups for select to authenticated
  using (exists (select 1 from phases p where p.id = groups.phase_id and p.status in ('PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED')));

drop policy if exists group_pairs_read on group_pairs;
create policy group_pairs_read on group_pairs for select to authenticated
  using (exists (select 1 from phases p where p.id = group_pairs.phase_id and p.status in ('PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED')));

drop policy if exists matches_read on matches;
create policy matches_read on matches for select to authenticated
  using (exists (select 1 from phases p where p.id = matches.phase_id and p.status in ('PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED')));

-- Cualquiera de las dos parejas fija fecha y pista. Sin fecha (null) vuelve a «pendiente de fecha».
create or replace function public.set_schedule(p_match uuid, p_at timestamptz, p_court text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if m.pair_a_id not in (select public.my_pair_ids()) and m.pair_b_id not in (select public.my_pair_ids()) then
    raise exception 'Este partido no es tuyo';
  end if;
  if m.status not in ('PENDING_SCHEDULE', 'SCHEDULE_PROPOSED', 'SCHEDULED') then
    raise exception 'El partido ya no admite cambios de fecha';
  end if;
  update matches
     set scheduled_at = p_at,
         court = nullif(trim(coalesce(p_court, '')), ''),
         status = case when p_at is null then 'PENDING_SCHEDULE'::match_status else 'SCHEDULED'::match_status end,
         updated_at = now()
   where id = p_match;
  insert into audit_log (actor, action, entity, entity_id, after)
  values (public.current_email(), 'SCHEDULE_SET', 'match', p_match::text, jsonb_build_object('at', p_at, 'court', p_court));
end $$;

-- Contactos de la pareja rival: solo si la organización lo permite y solo de jugadores adultos.
create or replace function public.rival_contacts(p_match uuid)
returns table (player_name text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare m matches; rival uuid; share boolean;
begin
  select * into m from matches where id = p_match;
  if not found then return; end if;
  if m.pair_a_id in (select public.my_pair_ids()) then rival := m.pair_b_id;
  elsif m.pair_b_id in (select public.my_pair_ids()) then rival := m.pair_a_id;
  else return;
  end if;
  select s.share_rival_contact into share from phases ph join seasons s on s.id = ph.season_id where ph.id = m.phase_id;
  if not coalesce(share, false) then return; end if;
  return query
    select pl.full_name, pc.phone
      from pair_members pm
      join players pl on pl.id = pm.player_id
      join player_contacts pc on pc.player_id = pl.id
     where pm.pair_id = rival and not pl.is_minor and pc.phone is not null
     order by pm.slot;
end $$;

grant execute on function public.set_schedule(uuid, timestamptz, text) to authenticated;
grant execute on function public.rival_contacts(uuid) to authenticated;
