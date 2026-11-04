# SAQUE LEAGUE 2026/27

Web de la liga interna de la Escuela de Pádel Saque: inscripciones, nivelación, Race to Masters, ranking individual y Saque Masters.

Stack: Next.js 15 (App Router) + Supabase (Postgres, Auth con magic link, RLS, pg_cron), desplegado en Vercel.

## Puesta en marcha

1. **Supabase**: crea el proyecto en región EU. En *SQL Editor* ejecuta, en orden:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_player_zone.sql` (zona de jugador, permisos más estrictos y contactos entre rivales)
   - `supabase/seed.sql` (antes cambia `cambia-esto@ejemplo.com` por tu email de administrador; si ya lo ejecutaste, no hace falta repetirlo)
   - Si `create extension pg_cron` falla, actívala en *Database → Extensions* y vuelve a ejecutar las dos últimas líneas de la migración.
2. **Auth** (*Authentication*):
   - *URL Configuration*: Site URL = la URL de Vercel. En Redirect URLs añade `https://TU-APP.vercel.app/auth/callback` y `http://localhost:3000/auth/callback`.
   - *SMTP Settings*: configura un remitente propio (ver «Email»). Sin esto Supabase solo envía unos pocos emails por hora.
   - *Email Templates → Magic Link*: traduce el texto al castellano.
3. **Local**: `cp .env.example .env.local`, rellena las claves, `npm install`, `npm run dev`. Tests: `npm test`.
4. **Vercel**: importa el repo y añade las variables de `.env.example`. La `SUPABASE_SERVICE_ROLE_KEY` solo va en el servidor (sin prefijo `NEXT_PUBLIC_`). `NEXT_PUBLIC_SITE_URL` = URL pública.

## Email

Un subdominio `*.vercel.app` no permite verificar un dominio en Resend, porque no controlamos su DNS. Opciones:

- **Gmail o Google Workspace del club** como SMTP en Supabase (contraseña de aplicación, `smtp.gmail.com`, puerto 465). Suficiente para la liga.
- **Dominio propio** (unos 10–15 € al año, se puede comprar en Vercel) y Resend con ese dominio.

## Estructura

- `src/lib/engine/`: motor de reglas puro, sin base de datos, con tests en `tests/`.
  - `match.ts`: validación de marcador, sets, ganador al agotar los 90 minutos, puntos 4/2/1.
  - `standings.ts`: clasificación acumulada de nivelación y de grupo, desempates y zonas.
  - `ranking.ts`: Ranking General por diferencia de medias, bonus ±50 y ±15 sin acumular, recalculado cronológico.
  - `race.ts`: coeficientes A–G y factor por categoría, en milésimas para evitar errores de redondeo.
  - `groups.ts`: generador reproducible de grupos de 4 (y de 3 para cuadrar) que minimiza rivales repetidos.
  - `importForm.ts`: lectura del CSV del Google Form.
- `supabase/migrations/`: esquema, permisos (RLS) y acciones de jugador (`submit_result`, `respond_result`, autoaprobación a las 48 h cada 10 minutos).
- `src/app/`: landing pública, `/acceso` (enlace por email o contraseña), `/crear-contrasena` (obligatoria tras el primer acceso), `/mi-liga` (zona de jugador), `/admin` (panel: Resumen, Parejas, Grupos, Partidos, Clasificación, Ranking, Ajustes) y `/cuenta`.

## Decisiones de reglamento aplicadas

- Acceso por pareja con el email del Form; con menores, el email es del tutor. Teléfonos y emails solo los ve administración.
- Basta con que un miembro de la pareja rival confirme el resultado. Si nadie responde, se confirma solo a las 48 h.
- WO: −1 a la pareja responsable y 0 a la otra por defecto; administración puede fijar otros puntos caso a caso, con motivo.
- Ranking General separado por división (masculina y femenina).
- Fase = mes natural + 5 días de margen para resultados (mayo cierra el 23).
- Grupos de 4; el resto en grupos de 3, evitando que una pareja repita grupo de 3. En la Race, en un grupo de 3 el 3.º desciende.
- Empate a los 90 minutos: sets, juegos del set en curso y juegos totales; si persiste, decide la organización.
- Los datos de competición (parejas, resultados, clasificaciones) solo se ven con sesión iniciada, porque participan menores.

## Acceso y contraseña

- La primera vez se entra solo con enlace por email; después la web obliga a crear una contraseña. La marca «ya tiene contraseña» se guarda en `app_metadata` (solo la escribe el servidor).
- Siguientes veces: pestaña «Enlace por email» o «Contraseña». En `/cuenta` se puede cambiar la contraseña.
- En Supabase, *Authentication → Sign In / Providers → Email* debe tener activado el acceso con contraseña (viene activado por defecto).

## Flujo de la nivelación (panel)

1. **Parejas**: importar el CSV del Form (o añadir a mano) y revisar categorías.
2. **Grupos → fase de noviembre**: *Generar grupos*, revisar, mover parejas si hace falta y *Publicar fase* (crea los partidos).
3. **Partidos**: seguimiento, impugnaciones, WO y resultados.
4. **Clasificación**: cupos de ascenso y descenso por categoría.
5. Diciembre y enero: mismo flujo; el generador evita repetir rivales con el historial.

Pendiente: grupos jerárquicos de la Race (febrero), ventana de cambios de pareja, avisos por email.
