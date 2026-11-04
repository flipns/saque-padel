-- SAQUE LEAGUE · 0003 · Rendimiento: índices y permisos evaluados una vez por consulta.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001 y 0002. No cambia ningún comportamiento.

-- 1) Las políticas de administración llamaban a is_admin() una vez por FILA. Con (select ...) se evalúa una vez por consulta.
do $$
declare t text;
begin
  foreach t in array array['admins','seasons','divisions','categories','phases','players','player_contacts',
    'registrations','pairs','pair_members','pair_access','groups','group_pairs','matches','schedule_proposals',
    'result_submissions','wo_resolutions','penalties','category_quotas','ranking_events','audit_log']
  loop
    execute format('drop policy if exists %I on %I', t || '_admin_all', t);
    execute format('create policy %I on %I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_all', t);
  end loop;
end $$;

drop policy if exists pair_access_self on pair_access;
create policy pair_access_self on pair_access for select to authenticated using (email = (select public.current_email()));

-- 2) Lectura de grupos y partidos publicados: subconsulta no correlacionada (se calcula una vez).
drop policy if exists groups_read on groups;
create policy groups_read on groups for select to authenticated
  using (phase_id in (select p.id from phases p where p.status in ('PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED')));
drop policy if exists group_pairs_read on group_pairs;
create policy group_pairs_read on group_pairs for select to authenticated
  using (phase_id in (select p.id from phases p where p.status in ('PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED')));
drop policy if exists matches_read on matches;
create policy matches_read on matches for select to authenticated
  using (phase_id in (select p.id from phases p where p.status in ('PUBLISHED', 'ACTIVE', 'CLOSED', 'LOCKED')));

-- 3) Índices en las columnas por las que se filtra y se cruza (Postgres no indexa las claves foráneas solo).
create index if not exists matches_phase_idx on matches (phase_id);
create index if not exists matches_group_idx on matches (group_id);
create index if not exists groups_phase_cat_idx on groups (phase_id, category_id);
create index if not exists group_pairs_phase_idx on group_pairs (phase_id);
create index if not exists group_pairs_pair_idx on group_pairs (pair_id);
create index if not exists pair_members_player_idx on pair_members (player_id);
create index if not exists ranking_events_division_idx on ranking_events (division_id);
create index if not exists result_submissions_match_idx on result_submissions (match_id);
create index if not exists categories_division_idx on categories (division_id);
create index if not exists phases_season_idx on phases (season_id);
create index if not exists schedule_proposals_match_idx on schedule_proposals (match_id);
create index if not exists penalties_pair_idx on penalties (pair_id);
create index if not exists wo_resolutions_pair_idx on wo_resolutions (responsible_pair_id);
