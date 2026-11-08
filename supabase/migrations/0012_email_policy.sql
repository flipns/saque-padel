-- SAQUE LEAGUE · 0012 · Solo se envían por email tres tipos de aviso.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001–0011. No borra ni modifica avisos de la web.
--
-- Todos los avisos siguen apareciendo en la web (pestaña Avisos). Por email solo salen:
--   DATES_PROPOSED   → fechas propuestas (también las contrapropuestas)
--   DATE_AGREED      → fecha aceptada
--   RESULT_SUBMITTED → resultado introducido (también cuando se corrige)
-- Para cambiar la lista, edita email_kinds() y src/lib/emailPolicy.ts (un test comprueba que coinciden).

create or replace function public.email_kinds() returns text[]
language sql immutable as $$ select array['DATES_PROPOSED', 'DATE_AGREED', 'RESULT_SUBMITTED'] $$;

-- Los avisos de cualquier otro tipo nacen ya resueltos para el correo: no entran en la cola de envío
-- ni cuentan como «pendientes» en el panel.
create or replace function public.notifications_email_policy() returns trigger
language plpgsql as $$
begin
  if new.emailed_at is null and not (new.kind = any (public.email_kinds())) then
    new.emailed_at := now();
    new.email_status := 'SKIPPED_POLICY';
  end if;
  return new;
end $$;
drop trigger if exists notifications_email_policy on notifications;
create trigger notifications_email_policy before insert on notifications for each row execute function public.notifications_email_policy();

-- Avisos de otros tipos que estaban pendientes de enviar: ya no se enviarán (siguen visibles en la web).
update notifications set emailed_at = now(), email_status = 'SKIPPED_POLICY'
 where emailed_at is null and not (kind = any (public.email_kinds()));

-- Doble seguro: la cola de envío solo reserva los tipos permitidos.
create or replace function public.claim_pending_emails(p_limit int default 50)
returns table (id uuid, email text, match_id uuid, kind text, title text, body text, created_at timestamptz)
language sql security definer set search_path = public as $$
  update notifications n
     set email_attempts = n.email_attempts + 1, email_claimed_at = now()
   where n.id in (
     select x.id from notifications x
      where x.emailed_at is null and x.email_attempts < 3
        and x.kind = any (public.email_kinds())
        and (x.email_claimed_at is null or x.email_claimed_at < now() - interval '10 minutes')
        and x.created_at > now() - interval '3 days'
      order by x.created_at
      limit greatest(1, least(coalesce(p_limit, 50), 500))
      for update skip locked)
  returning n.id, n.email, n.match_id, n.kind, n.title, n.body, n.created_at
$$;
revoke execute on function public.claim_pending_emails(int) from public, anon, authenticated;
grant execute on function public.claim_pending_emails(int) to service_role;
