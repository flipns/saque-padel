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
   - `supabase/migrations/0008_phase5_availability.sql` (disponibilidad semanal; solo añade y sustituye `notify_phase_published`)
   - `supabase/migrations/0009_phase5b_exceptions.sql` (preferencias, excepciones por fecha y avisos de cambios; solo añade y sustituye `save_availability`)
   - `supabase/migrations/0010_result_corrections.sql` (impugnar con resultado exacto, corregir y retirar resultados; solo añade y sustituye `submit_result`, `respond_result` y `audit_to_chat`). **Ejecútala antes de desplegar el código nuevo.**
   - `supabase/migrations/0011_move_pairs.sql` (mover parejas entre grupos y cambiar de categoría; solo añade dos funciones). **Ejecútala antes de desplegar el código nuevo.**
   - `supabase/migrations/0012_email_policy.sql` (solo se envían por email fechas propuestas, aceptadas y resultados introducidos; solo añade y sustituye `claim_pending_emails`).
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

### Qué avisos llegan por email

Todos los avisos aparecen siempre en la web (pestaña **Avisos**, con su contador). Por email solo salen tres tipos:

- **Fechas propuestas** (también cuando contraproponen otras).
- **Fechas aceptadas.**
- **Resultados introducidos** (también cuando se corrigen).

El resto (resultado confirmado o impugnado, pista reservada, horarios rechazados, chat, recordatorios, cambios de grupo o categoría, resultados fijados por la organización…) solo se ve en la web. La lista está en `src/lib/emailPolicy.ts` y en la función `email_kinds()` de la migración 0012; para cambiarla hay que cambiar las dos (un test comprueba que coinciden). Cada jugador puede además dejar de recibir esos tres emails desde Avisos. Los enlaces de acceso (magic link) los envía Supabase y no dependen de esto.

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
- **Fase 5a y 5b (hechas):** calendario de disponibilidad de cada jugador (semana tipo con franjas preferentes, y excepciones por fecha) y cruce automático de los cuatro calendarios (4 de 4 y alternativas 3 de 4), con avisos de cambios relevantes.
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

### Disponibilidad y cruce de horarios (Fase 5a)

- **Mi disponibilidad** (`/mi-liga/disponibilidad`): franjas semanales en las que el jugador PUEDE jugar, en tramos de 30 minutos (hora de Madrid). Lo no marcado es «desconocido», nunca «libre». Cada jugador puede editar también la de su compañero/a (útil si este no tiene cuenta).
- **Mejores horarios** (en cada partido sin fecha): el servidor cruza los calendarios de los cuatro jugadores y sugiere inicios de 90 minutos completos, dentro de la fase, en el futuro y sin pisar otro partido de las dos parejas. Filtros: entre semana, fin de semana, mañanas y tardes. Desde ahí se proponen horarios con un clic; quedan marcados como «sugeridos» (`origin = AVAILABILITY`).
- **Privacidad:** los rivales no ven el calendario de nadie del otro lado, solo las coincidencias (se calculan en servidor; `availability_rules` solo la leen el propio jugador, su compañero/a y la organización).
- Si falta algún calendario se dice quién; si no hay coincidencias se puede pedir a los demás que lo actualicen (un aviso al día por partido).
- Panel → Resumen → «Jugadores sin disponibilidad» lleva a una lista de quién ha informado y quién no.
- La lógica de cruce es una función pura (`src/lib/availability.ts`) con tests, incluido el ejemplo del anexo y el cambio de hora.

### Disponibilidad, segunda parte (Fase 5b)

- **Semana tipo con preferencias:** cada franja puede marcarse ★ preferente (puede ir dentro de una normal: 18:00–22:00 y 19:00–21:00 ★).
- **Días en los que no puedes** (paso 2 de la misma pantalla): calendario de 6 semanas para añadir **bloqueos** (vacaciones, lesión, festivos; un día entero o un tramo) o **disponibilidad extra**. Un bloqueo prevalece siempre sobre la semana tipo y sobre la disponibilidad extra. Atajos: bloquear semana, vaciar semana, copiar una semana a otra y bloquear un periodo. La nota de un bloqueo es privada y no sale en ningún aviso.
- **Tres niveles** en «Mejores horarios»: *Recomendados* y *4 de 4* (los cuatro disponibles los 90 minutos), y *alternativas 3 de 4* (tres disponibles y a una persona no le consta el horario; nunca si esa persona ha marcado que NO puede). Orden: antes los preferidos por más jugadores y los más próximos; los 3/4 siempre después de los 4/4.
- **Cada horario propuesto lleva una indicación** de cómo encaja con los calendarios (encaja con los 4, falta confirmar a alguien, posible conflicto, o no consta disponibilidad completa). Solo orienta: nunca borra una propuesta ni revoca una aceptación.
- **Avisos de cambios relevantes:** la primera vez que un jugador rellena su disponibilidad (un aviso por persona), y un posible conflicto cuando alguien bloquea una fecha que es uno de los horarios propuestos o la fecha acordada. No incluyen el motivo.
- El panel (Resumen → «Jugadores sin disponibilidad») cuenta a quien tiene semana tipo; quien solo ha puesto excepciones figura como «sin informar».

### Resultados: impugnar con versión, corregir y retirar

- **Impugnar:** además del motivo, la pareja que impugna puede escribir el **resultado exacto** que cree correcto (opcional). Queda guardado junto al enviado (`dispute_sets`) y se avisa a la otra pareja y en el chat.
- **Corregir:** la pareja que envió el resultado puede **corregirlo** mientras la otra no lo haya confirmado, también si lo han impugnado. Se reinician las 48 horas y se avisa a la otra pareja. Máximo 5 envíos por partido; después decide la organización.
- **Retirar:** la pareja que lo envió puede retirarlo; el partido vuelve a estar sin resultado.
- **Panel:** en un partido impugnado se ven las dos versiones con el ganador que saldría de cada una. Se puede dar por bueno el enviado, **dar por buena la de quien impugnó**, o fijar otro a mano.
- Una vez confirmado el resultado solo lo corrige la organización.

### Grupos

- Panel → Grupos y fases → cada categoría tiene «**+ Crear grupo nuevo**» (primera letra libre: A, B, C, D…). Funciona con la fase generada o publicada.
- Las parejas **sin grupo** (altas tardías) se añaden desde esa misma categoría al grupo nuevo; en una fase publicada se crean los partidos contra las parejas del grupo.
- Un grupo de 2 parejas se permite (juegan 1 partido cada una) con un aviso. Los grupos vacíos se pueden eliminar; con parejas o partidos, no.
- Por ahora no se mueven parejas ya agrupadas entre grupos de una fase publicada.

### Mover una pareja de grupo y cambiarla de categoría

- **Mover de grupo** (Panel → Grupos y fases): junto a cada pareja hay un desplegable «Mover…» y el botón «Mover». Sirve en fases generadas y publicadas, siempre dentro de la misma categoría y fase. En una fase publicada se retiran los partidos sin jugar de la pareja (con sus propuestas de fecha y su chat), cambia de grupo y se crean los partidos contra las parejas del grupo nuevo. Se avisa a la pareja, a los rivales de los partidos cancelados y a los del grupo nuevo.
- **Cambiar de categoría** (Panel → Parejas → ficha de la pareja → «Cambiar de categoría»): dentro de su división (no se pasa de masculina a femenina). Pide un motivo, que queda en el registro. La pareja sale de sus grupos de las fases abiertas, se retiran sus partidos sin jugar y queda **sin grupo** en la categoría nueva; la ficha avisa de en qué fases y enlaza a «Grupos y fases», donde se coloca desde «Parejas sin grupo». El Ranking General individual no cambia y no hay bonus.
- **Regla de seguridad:** solo se puede mover o cambiar de categoría a una pareja que **no tenga ningún partido con resultado** (jugado, pendiente de confirmar, impugnado, WO o no disputado). El motivo es que la clasificación de una categoría solo cuenta un partido si las dos parejas están en su tabla; si una pareja con resultados se fuera, sus rivales perderían los puntos que ganaron contra ella.
- Ambas operaciones se hacen en la base de datos en una sola transacción (`admin_move_pair`, `admin_change_pair_category`): o se hacen enteras o no se hace nada.
- Cada fase tiene sus propios grupos: mover una pareja en la fase 1 no la mueve en la fase 2.
- Por ahora solo en fases de nivelación; los grupos jerárquicos de la Race se tratarán cuando se desarrollen.

### Disponibilidad: una sola pantalla en dos pasos

`/mi-liga/disponibilidad` ya no tiene pestañas ni dos guardados. Paso 1, **semana habitual**: cada día muestra sus horas de «desde» a «hasta» (de 30 en 30 minutos; un día puede tener varios tramos, y cada uno se puede marcar ★ preferente); un día sin horas se considera sin información. Paso 2, **días concretos** (opcional): un calendario de 6 semanas en el que **tocar un día abre una ventana encima** con ese día (título con la fecha, su semana habitual y sus cambios): «No puedo en todo el día», «No puedo en unas horas» o «Sí puedo en unas horas (extra)», con ★ preferente y nota privada. La ventana tiene su propio botón **«Guardar este día»** (guarda solo los días, no la semana habitual) y «Cancelar»; se cierra también con Esc o tocando fuera, y el calendario no cambia de sitio. Debajo hay bloqueo de periodos (vacaciones) y, en «Más opciones», herramientas por semana (bloquear, vaciar, copiar a otra), que se guardan con el botón general. El botón general guarda la semana habitual y los días a la vez (solo escribe la parte que ha cambiado). (Se quitaron los botones Mañana/Tarde/Noche y los atajos por ser redundantes con el selector de horas.)

### Pistas

Las pistas se eligen de un desplegable («Pista 1» … «Pista N»). El número de pistas (por defecto 10) se cambia en Panel → Ajustes → «Pistas del club» (1 a 30). El servidor valida la elección; una pista antigua escrita a mano se conserva al editar.

### Rendimiento

- La temporada activa se recuerda un minuto por instancia del servidor (solo su identificador) para pedir a la vez temporada, categorías y fases; las consultas que dependen del email se lanzan mientras se verifica la sesión.
- Las pantallas de inicio, partido, liga, ranking, clasificación y las del panel de partidos piden sus datos de una sola vez (la categoría de cada pareja se conoce desde la sesión).
- En la ficha del partido, «Mejores horarios» se calcula en paralelo y se envía en diferido (Suspense): la ficha aparece sin esperarlo.
- Una barra de progreso (`NavProgress`) aparece al pulsar un enlace o un botón que guarda.
- Medido con 80 ms simulados por consulta: la suma de 13 pantallas pasó de 5,8 a 4,2 segundos. Lo más probable en producción es que pese más que esto que la región de Vercel no coincida con la de Supabase (Vercel → Settings → Functions → Region).

### Botones que guardan (acciones de servidor)

- Antes, cada acción guardaba y **redirigía** a la misma pantalla con `?ok=`: Next calculaba la pantalla nueva dentro de la acción y el navegador la volvía a pedir, así que el trabajo se hacía dos veces seguidas (proponer horarios: 1,4 s y 48 consultas → 0,9 s y 28 con 80 ms simulados por consulta).
- Ahora `run()` (`src/lib/flash.ts`) **no redirige si el botón se pulsó en la misma pantalla** a la que se vuelve (comprobado con la cabecera `Referer`): guarda, deja el mensaje en la cookie `flash` (30 s) y llama a `revalidatePath`; Next devuelve la pantalla actualizada en la propia respuesta, una sola vez, sin recargar la página y conservando el scroll y los filtros. Si el destino es otra pantalla (p. ej. crear una pareja) o falta la cabecera, redirige con `?ok=` / `?err=` como antes.
- El mensaje es un **aviso flotante** (`Flash` → `FlashToast`) visible estés donde estés: los éxitos se cierran solos a los 7 s, los errores a los 15 s, y hay una ×. Borra la cookie y quita `?ok=`/`?err=` de la dirección para que no reaparezca al recargar. Cualquier pantalla con un botón que guarde debe incluir `<Flash ok={…} err={…} />`.
- `React.cache` no evita consultas repetidas **dentro de las acciones** (solo al pintar pantallas), así que las consultas compartidas (temporada, categorías, fases, parejas del usuario, ¿admin?) se guardan en una memoria atada a la conexión de cada petición (`src/lib/memo.ts`).

### Agenda de partidos programados y mensaje para WhatsApp

- Panel → Partidos → **Programados**: los partidos con fecha y pista, **por día y hora, del más cercano al más lejano**, con el día como título y la hora destacada. Un partido sigue siendo «próximo» hasta que acaba su turno de 90 minutos (así uno que se está jugando aún sale). Los programados cuya hora ya pasó y siguen sin resultado están en la pestaña **Ya pasados, sin resultado**. Respeta los filtros de fase y categoría.
- Botón **Compartir los próximos partidos**: genera el texto del grupo de WhatsApp de la liga con, por cada partido, día, hora, pista, categoría y las dos parejas, más un mensaje final animando a ir al club. Se puede elegir cuántos días incluir (7, 14 o todos), **editar el texto** antes de enviarlo y usar **Compartir…** (menú nativo del móvil, que incluye WhatsApp), **Copiar texto** o **Abrir WhatsApp** (`wa.me`). Usa las *negritas* de WhatsApp (`*así*`); si se pega en otro sitio se ven los asteriscos.
- La lógica del texto está en `src/lib/share.ts` (horas y días de Madrid, con tests).
- El texto lleva los nombres completos de las parejas, incluidos los menores. Conviene revisarlo antes de enviarlo a un grupo.
