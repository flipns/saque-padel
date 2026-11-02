-- Datos base de la temporada 2026/27. Idempotente salvo el bloque de admins.
-- Cambia el email del administrador antes de ejecutarlo.

insert into admins (email) values ('cambia-esto@ejemplo.com') on conflict do nothing;

with s as (
  insert into seasons (code, name, registration_deadline_at, season_starts_at, may_results_deadline_at,
    masters_starts_on, masters_ends_on, registration_form_url, entry_fee_per_player, prize, rules, is_current)
  values (
    '2026-27', 'SAQUE LEAGUE 2026/27',
    '2026-11-01 23:59:59 Europe/Madrid', '2026-11-06 00:00:00 Europe/Madrid', '2027-05-23 23:59:59 Europe/Madrid',
    '2027-05-28', '2027-05-30',
    'https://forms.gle/aZ264rTFJippxzH88', 10,
    '{"amount":200,"currency":"EUR","type":"BONO_MONEDERO","provider":"Playtomic","award_scope":null,"status":"PENDING_CONFIRMATION"}',
    '{"resultConfirmHours":48,"phaseMarginDays":5}',
    true)
  on conflict (code) do update set name = excluded.name
  returning id
),
d as (
  insert into divisions (season_id, code, name, display_order)
  select s.id, x.code::division_code, x.name, x.ord from s,
    (values ('MASCULINA', 'Masculina', 1), ('FEMENINA', 'Femenina', 2)) as x(code, name, ord)
  on conflict (season_id, code) do update set name = excluded.name
  returning id, code
)
insert into categories (division_id, code, name, level_order)
select d.id, c.code, c.name, c.lvl from d join (values
  ('MASCULINA', 'PREMIER', 'Premier', 1),
  ('MASCULINA', 'ORO', 'Oro', 2),
  ('MASCULINA', 'PLATA', 'Plata', 3),
  ('MASCULINA', 'BRONCE', 'Bronce', 4),
  ('MASCULINA', 'ROOKIE', 'Rookie', 5),
  ('FEMENINA', 'ORO', 'Oro', 1),
  ('FEMENINA', 'PLATA', 'Plata', 2),
  ('FEMENINA', 'BRONCE', 'Bronce', 3)
) as c(div, code, name, lvl) on d.code::text = c.div
on conflict (division_id, code) do nothing;

-- Fases: mes natural + 5 días de margen para resultados. Mayo cierra el 23/05 (Masters el 28).
insert into phases (season_id, number, kind, name, starts_on, ends_on, results_deadline)
select s.id, p.n, p.kind::phase_kind, p.name, p.s::date, p.e::date, p.r::date
from seasons s, (values
  (1, 'LEVELING', 'Nivelación 1 · Noviembre', '2026-11-06', '2026-11-30', '2026-12-05'),
  (2, 'LEVELING', 'Nivelación 2 · Diciembre', '2026-12-01', '2026-12-31', '2027-01-05'),
  (3, 'LEVELING', 'Nivelación 3 · Enero',     '2027-01-01', '2027-01-31', '2027-02-05'),
  (4, 'RACE',     'Race 1 · Febrero',         '2027-02-01', '2027-02-28', '2027-03-05'),
  (5, 'RACE',     'Race 2 · Marzo',           '2027-03-01', '2027-03-31', '2027-04-05'),
  (6, 'RACE',     'Race 3 · Abril',           '2027-04-01', '2027-04-30', '2027-05-05'),
  (7, 'RACE',     'Race 4 · Mayo',            '2027-05-01', '2027-05-23', '2027-05-23')
) as p(n, kind, name, s, e, r)
where s.code = '2026-27'
on conflict (season_id, number) do nothing;
