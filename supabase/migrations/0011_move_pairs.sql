-- SAQUE LEAGUE · 0011 · Mover una pareja de grupo y cambiarla de categoría.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0010. Solo añade funciones; no toca datos.
--
-- Regla de seguridad común: NO se mueve ni se cambia de categoría a una pareja que ya tiene partidos con resultado
-- (jugados, pendientes de confirmar, impugnados, WO o no disputados). El motor de clasificación solo cuenta un partido
-- si las dos parejas están en la tabla de la categoría; si una pareja se fuera, sus rivales perderían los puntos que
-- ganaron contra ella. Los partidos sin resultado sí se pueden retirar (se borran junto con sus propuestas y chat).
-- Cada operación es atómica: o se hace entera o no se hace nada.

-- ============ Mover una pareja a otro grupo de la misma categoría y fase ============
create or replace function public.admin_move_pair(p_phase uuid, p_pair uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ph phases; cur groups; tgt groups; pair_cat uuid; committed int;
  removed int := 0; created int := 0; v_rivals uuid[]; v_n int; rivals uuid[] := '{}'; r record; moved_name text;
  old_size int; live boolean;
begin
  if not public.is_admin() then raise exception 'Solo administración'; end if;
  select * into ph from phases where id = p_phase;
  if not found then raise exception 'Fase no encontrada'; end if;
  if ph.kind <> 'LEVELING' then raise exception 'Por ahora solo se mueven parejas en las fases de nivelación.'; end if;
  if ph.status not in ('GENERATED', 'PUBLISHED', 'ACTIVE') then raise exception 'La fase no admite cambios de grupo (estado %).', ph.status; end if;

  select g.* into cur from groups g join group_pairs gp on gp.group_id = g.id where gp.phase_id = p_phase and gp.pair_id = p_pair;
  if not found then raise exception 'La pareja no está en ningún grupo de esta fase.'; end if;
  select * into tgt from groups where id = p_to and phase_id = p_phase;
  if not found then raise exception 'El grupo de destino no existe en esta fase.'; end if;
  if tgt.id = cur.id then raise exception 'La pareja ya está en ese grupo.'; end if;
  select category_id into pair_cat from pairs where id = p_pair;
  if tgt.category_id <> pair_cat or cur.category_id <> pair_cat then raise exception 'Solo se puede mover a un grupo de la misma categoría.'; end if;

  select count(*) into committed from matches m
   where m.phase_id = p_phase and p_pair in (m.pair_a_id, m.pair_b_id)
     and m.status in ('COMPLETED', 'RESULT_PENDING_CONFIRMATION', 'DISPUTED', 'WO', 'NOT_PLAYED', 'PLAYED_PENDING_RESULT');
  if committed > 0 then
    raise exception 'Esta pareja ya tiene % partido(s) con resultado en esta fase: no se puede mover sin que sus rivales pierdan lo que han ganado.', committed;
  end if;

  live := ph.status in ('PUBLISHED', 'ACTIVE');
  -- Partidos sin resultado de la pareja en el grupo actual: se retiran.
  with del as (
    delete from matches m where m.phase_id = p_phase and p_pair in (m.pair_a_id, m.pair_b_id)
    returning case when m.pair_a_id = p_pair then m.pair_b_id else m.pair_a_id end as rival
  ) select coalesce(array_agg(rival), '{}'::uuid[]), count(*) into v_rivals, v_n from del;
  rivals := v_rivals; removed := v_n;

  update group_pairs set group_id = p_to where phase_id = p_phase and pair_id = p_pair;
  if live then
    insert into matches (phase_id, group_id, pair_a_id, pair_b_id)
    select p_phase, p_to, p_pair, gp.pair_id from group_pairs gp where gp.group_id = p_to and gp.pair_id <> p_pair;
    get diagnostics created = row_count;
  end if;
  select count(*) into old_size from group_pairs where group_id = cur.id;

  if live then
    moved_name := public.pair_label(p_pair);
    for r in select distinct x as pair_id from unnest(rivals) x loop
      perform public.notify_pair(r.pair_id, null, 'MATCH_CANCELLED', 'Partido cancelado',
        'Tu partido contra ' || moved_name || ' se ha cancelado: la organización ha cambiado a esa pareja de grupo. Si te corresponde algún rival nuevo, lo verás en tu inicio.');
    end loop;
    for r in select gp.pair_id from group_pairs gp where gp.group_id = p_to and gp.pair_id <> p_pair loop
      perform public.notify_pair(r.pair_id, null, 'GROUP_NEW_RIVAL', 'Nuevo rival en tu grupo',
        moved_name || ' se ha incorporado a tu grupo ' || tgt.letter || '. Tienes un partido nuevo contra ellos.');
    end loop;
    perform public.notify_pair(p_pair, null, 'GROUP_CHANGED', 'Nuevo grupo',
      'La organización os ha movido al grupo ' || tgt.letter || '. Se han cancelado ' || removed || ' partidos sin jugar y tenéis ' || created || ' partidos nuevos. Míralos en tu inicio.');
  end if;

  insert into audit_log (actor, action, entity, entity_id, after)
  values (public.current_email(), 'GROUP_PAIR_MOVED', 'phase', p_phase::text,
          jsonb_build_object('pair', p_pair, 'from', cur.letter, 'to', tgt.letter, 'cancelled', removed, 'created', created));
  return jsonb_build_object('from', cur.letter, 'to', tgt.letter, 'cancelled', removed, 'created', created, 'fromSize', old_size, 'live', live);
end $$;

-- ============ Cambiar una pareja de categoría (dentro de la misma división) ============
-- La pareja sale de sus grupos de las fases abiertas (se retiran sus partidos sin resultado) y queda SIN GRUPO en la
-- categoría nueva: la organización la coloca después en un grupo. El Ranking General individual no cambia y no hay bonus
-- (un reajuste administrativo nunca puntúa).
create or replace function public.admin_change_pair_category(p_pair uuid, p_category uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr pairs; oldc categories; newc categories; old_label text; new_label text; committed int;
  ph record; removed int := 0; v_rivals uuid[]; v_n int; rivals uuid[] := '{}'; r record; phases_out int[] := '{}'; pair_name text;
begin
  if not public.is_admin() then raise exception 'Solo administración'; end if;
  select * into pr from pairs where id = p_pair;
  if not found then raise exception 'Pareja no encontrada'; end if;
  select * into oldc from categories where id = pr.category_id;
  select * into newc from categories where id = p_category;
  if not found or not newc.active then raise exception 'Categoría no válida'; end if;
  if newc.id = oldc.id then raise exception 'La pareja ya está en esa categoría.'; end if;
  if newc.division_id <> oldc.division_id then
    raise exception 'No se puede pasar una pareja entre divisiones masculina y femenina. Crea una pareja nueva en la otra división.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo del cambio de categoría.'; end if;

  select count(*) into committed from matches m
   where p_pair in (m.pair_a_id, m.pair_b_id)
     and m.status in ('COMPLETED', 'RESULT_PENDING_CONFIRMATION', 'DISPUTED', 'WO', 'NOT_PLAYED', 'PLAYED_PENDING_RESULT');
  if committed > 0 then
    raise exception 'Esta pareja ya tiene % partido(s) con resultado: no se puede cambiar de categoría sin que sus rivales pierdan lo que han ganado.', committed;
  end if;

  select oldc.name || ' ' || lower(d.name) into old_label from divisions d where d.id = oldc.division_id;
  select newc.name || ' ' || lower(d.name) into new_label from divisions d where d.id = newc.division_id;
  pair_name := public.pair_label(p_pair);

  for ph in
    select p.id, p.number from phases p join group_pairs gp on gp.phase_id = p.id
     where gp.pair_id = p_pair and p.status in ('GENERATED', 'PUBLISHED', 'ACTIVE') order by p.number
  loop
    with del as (
      delete from matches m where m.phase_id = ph.id and p_pair in (m.pair_a_id, m.pair_b_id)
      returning case when m.pair_a_id = p_pair then m.pair_b_id else m.pair_a_id end as rival
    ) select coalesce(array_agg(rival), '{}'::uuid[]), count(*) into v_rivals, v_n from del;
    rivals := rivals || v_rivals; removed := removed + v_n;
    delete from group_pairs where phase_id = ph.id and pair_id = p_pair;
    phases_out := phases_out || ph.number;
  end loop;

  update pairs set category_id = p_category where id = p_pair;

  for r in select distinct x as pair_id from unnest(rivals) x loop
    perform public.notify_pair(r.pair_id, null, 'MATCH_CANCELLED', 'Partido cancelado',
      'Tu partido contra ' || pair_name || ' se ha cancelado: esa pareja ha cambiado de categoría. Si te corresponde algún rival nuevo, lo verás en tu inicio.');
  end loop;
  perform public.notify_pair(p_pair, null, 'CATEGORY_CHANGED', 'Cambio de categoría',
    'La organización ha cambiado vuestra categoría de ' || old_label || ' a ' || new_label || '.'
    || case when array_length(phases_out, 1) > 0 then ' Se han cancelado ' || removed || ' partidos sin jugar. Os asignará un grupo nuevo en breve.' else '' end);

  insert into audit_log (actor, action, entity, entity_id, after, reason)
  values (public.current_email(), 'PAIR_CATEGORY_CHANGED', 'pair', p_pair::text,
          jsonb_build_object('from', old_label, 'to', new_label, 'cancelled', removed, 'phases', to_jsonb(phases_out)), trim(p_reason));
  return jsonb_build_object('from', old_label, 'to', new_label, 'cancelled', removed, 'phases', to_jsonb(phases_out));
end $$;

revoke execute on function public.admin_move_pair(uuid, uuid, uuid), public.admin_change_pair_category(uuid, uuid, text) from public, anon;
grant execute on function public.admin_move_pair(uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_change_pair_category(uuid, uuid, text) to authenticated;
