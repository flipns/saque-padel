# SAQUE LEAGUE 2026/27

Web de la liga interna de la Escuela de Pádel Saque: inscripciones, nivelación, Race to Masters, ranking individual y Saque Masters.

Stack: Next.js 15 (App Router) + Supabase (Postgres, Auth con magic link, RLS, pg_cron), desplegado en Vercel.

## Puesta en marcha

1. **Supabase**: crea el proyecto en región EU. En *SQL Editor* ejecuta, en orden:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_player_zone.sql` (zona de jugador, permisos más estrictos y contactos entre rivales)
   - `supabase/migrations/0003_performance.sql` (índices y permisos más rápidos; no cambia el comportamiento)
   - `supabase/migrations/0004_phase1_identity.sql` (identidad del jugador y email del compañero; solo añade)
   - `supabase/migrations/0005_phase2_dates.sql` (propuestas de fecha, pista, cambio de fecha y avisos; solo añade y sustituye `submit_result`)
   - `supabase/migrations/0006_phase3_emails.sql` (emails de aviso, recordatorios y preferencias; solo añade y sustituye `respond_result` y `auto_confirm_due`)
   - `supabase/migrations/0007_phase4_chat.sql` (chat por partido; solo añade y sustituye `auto_confirm_due`)
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

## Rendimiento

- **Región de Vercel = región de Supabase.** Es lo que más pesa: *Settings → Functions → Function Region* en Vercel, igual que la región de tu proyecto de Supabase (Frankfurt = `fra1`).
- Cada petición verifica la sesión una sola vez y reutiliza temporada, categorías y fases entre las consultas de la misma pantalla (`src/lib/auth.ts`, `src/lib/data.ts`).
- El middleware ya no llama a la red en cada petición.
- La portada no consulta la base de datos para visitantes anónimos (caché de 60 s).
- `0003_performance.sql` añade índices y evalúa los permisos una vez por consulta, no una vez por fila.

## Coordinación de partidos (por fases)

Según el anexo funcional V2 (4/11/2026) y las decisiones del club:

- **Fase 1 (hecha):** toda la liga visible para los jugadores (clasificación, grupos y resultados de las 8 categorías, ranking de ambas divisiones, últimos resultados en el inicio), «¿Quién eres?», alta del email del compañero y aviso para menores.
- **Fase 2 (hecha):** propuestas de hasta 5 horarios, aceptar/rechazar, «ninguno me cuadra» (cierra los del rival y propone otros), retirar, fecha acordada → pista reservada → programado, cambio de fecha con la anterior vigente, y avisos dentro de la web. Sin representantes: quien propone queda conforme y cualquier jugador de la otra pareja acepta. Máximo 5 horarios activos por partido a la vez (anexo RF-COORD-02).
- **Fase 3 (hecha):** avisos por email con el Gmail del club (sin dominio propio), recordatorios automáticos y preferencias de cada jugador.
- **Fase 4 (hecha):** chat de cuatro por partido, también con menores (el menor entra con el email del tutor), moderado por la organización.
- **Fase 5:** calendario de disponibilidad y cruce automático 4/4.
- **Fase 6:** incidencias y administración avanzada.

Si un jugador es menor, márcalo en *Panel → Parejas → (pareja) → «Menor de edad»*. Su móvil no se muestra nunca y se tendrá en cuenta en el chat.

### Cómo funciona la coordinación de fecha (Fase 2)

Estados del partido: sin fecha → con propuestas → **fecha acordada (falta pista)** → **programado** → (cambio de fecha) → …
- Cada horario dura 90 minutos y debe caer dentro de la fase (hasta el día 5 del mes siguiente) y en el futuro.
- Aceptar un horario descarta los demás. Registrar la pista lo programa. Si no hay pista, «buscar otra fecha» reabre la negociación.
- En un cambio de fecha, la fecha y pista anteriores siguen vigentes hasta que haya un nuevo acuerdo y una nueva reserva.
- Los jugadores ya no fijan la fecha directamente (`set_schedule` queda solo para la organización desde el panel).
- Los avisos se guardan en la tabla `notifications` (con `emailed_at` listo para la Fase 3).
- Solo los cuatro jugadores del partido y la administración ven las propuestas.

### Emails de aviso (Fase 3)

Variables de entorno en Vercel (Settings → Environment Variables) y después *Redeploy*:

| Variable | Valor |
|---|---|
| `SMTP_USER` | el Gmail del club |
| `SMTP_PASS` | contraseña de aplicación del Gmail (la misma de Supabase SMTP vale) |
| `CRON_SECRET` | cualquier texto largo y aleatorio (Vercel lo envía solo a la tarea diaria) |
| `MAIL_FROM` | opcional; por defecto «SAQUE LEAGUE <SMTP_USER>» |

- Cada aviso de la web (propuesta, fecha acordada, pista, resultado, cambio de fecha, grupos publicados…) se envía también por email. Se envía justo después de la acción y, si el correo falla, se reintenta hasta 3 veces.
- **Recordatorios** (tarea diaria `/api/cron/emails`, 07:00 UTC, en `vercel.json`): horarios propuestos sin respuesta tras 48 h, y cierre de fase a los 7 días y a las 48 h para los partidos sin jugar. Cada recordatorio se envía una sola vez. La misma tarea confirma los resultados que llevan 48 h sin respuesta.
- Cada jugador puede dejar de recibir emails en *Avisos*; los avisos siguen apareciendo en la web. Panel → Ajustes → «Avisos por email» muestra el estado, permite enviar un email de prueba y reenviar pendientes.
- Gmail limita el envío (unos 500 al día en cuentas gratuitas, unos 2.000 en Google Workspace) y se comparte con los enlaces de acceso de Supabase.
- Opcional, para que los resultados autoconfirmados se envíen al momento (y no a la mañana siguiente): activar las extensiones `pg_cron` y `pg_net` en Supabase y programar una llamada cada 10 minutos a `https://TU-APP.vercel.app/api/cron/emails` con la cabecera `Authorization: Bearer <CRON_SECRET>`.

### Chat por partido (Fase 4)

- Chat de texto entre los cuatro jugadores del partido (y la organización). Sin imágenes, sin mensajes privados, 1000 caracteres por mensaje y 20 mensajes por minuto.
- Hay que haber indicado «quién eres» para escribir (el chat lo pide en el momento). Un menor entra con el email de su tutor, como en el resto de la web.
- Se actualiza solo cada 5 segundos mientras la pestaña está visible (constante `POLL_MS` en `Chat.tsx`). No usa tiempo real: así los mensajes borrados nunca llegan a los jugadores, ni siquiera por la red.
- El chat incluye avisos del sistema (propuestas, fecha acordada, pista, resultado…), generados desde la auditoría (`audit_to_chat`). Pasa a solo lectura cuando el partido se cierra (jugado, WO, no disputado).
- **Avisos:** un solo aviso (y un solo email) por ráfaga de mensajes; no se crea otro hasta que el destinatario lo lea. El email no incluye el texto del mensaje de un jugador. Los mensajes de la organización sí se envían completos.
- **Moderación** (Panel → Partidos → partido → «Chat del partido»): ver todo, eliminar con motivo (los jugadores ven «Mensaje eliminado por la organización»; el original solo lo conserva la organización), restaurar y escribir como organización. Si hay menores en el partido se muestra un aviso.
- **Retención:** los chats se borran un mes después del fin del Saque Masters (`seasons.rules.chatRetentionMonths`, por defecto 1). Lo hace la tarea diaria (`/api/cron/emails`), así que necesita `CRON_SECRET`.
- Marca a los jugadores menores en *Panel → Parejas → (pareja) → «Menor de edad»*.
