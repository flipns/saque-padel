import { requireAdmin } from "@/lib/auth";
import { getSeasonRow } from "@/lib/data";
import { Flash, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { mergeRules } from "@/lib/engine";
import { MAX_COURTS } from "@/lib/courts";
import { isoToMadridParts } from "@/lib/dates";
import { mailConfigured, fromAddress } from "@/lib/mailer";
import { addAdminAction, flushNowAction, removeAdminAction, saveContactAction, saveCourtsAction, saveDatesAction, savePrizeAction, sendTestEmailAction } from "./actions";

export default async function Ajustes({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { sb, user } = await requireAdmin("/admin/ajustes");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const { data: admins } = await sb.from("admins").select("email").order("email");
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [pendingRes, failedRes, sentRes] = await Promise.all([
    sb.from("notifications").select("id", { count: "exact", head: true }).is("emailed_at", null).gt("created_at", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()),
    sb.from("notifications").select("id", { count: "exact", head: true }).is("emailed_at", null).gte("email_attempts", 3),
    sb.from("notifications").select("id", { count: "exact", head: true }).eq("email_status", "SENT").gte("emailed_at", since),
  ]);
  const mailOn = mailConfigured(), cronOn = Boolean(process.env.CRON_SECRET);
  const prize = season.prize ?? {};
  return (
    <>
      <PageHead title="Ajustes" sub="Fechas, premio, privacidad y administradores." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="stack">
        <div className="card">
          <h2 style={{ fontSize: "1.1rem" }}>Fechas e inscripción</h2>
          <form action={saveDatesAction} style={{ marginTop: ".75rem" }}>
            <div className="fields">
              <div><label htmlFor="deadline">Último día de inscripción</label><input id="deadline" name="deadline" type="date" defaultValue={isoToMadridParts(season.registration_deadline_at).date} required /></div>
              <div><label htmlFor="start">Comienzo de la liga</label><input id="start" name="start" type="date" defaultValue={isoToMadridParts(season.season_starts_at).date} required /></div>
              <div className="full"><label htmlFor="formUrl">Enlace del formulario de inscripción</label><input id="formUrl" name="formUrl" type="text" defaultValue={season.registration_form_url ?? ""} /></div>
            </div>
            <div style={{ marginTop: "1rem" }}><SubmitButton className="btn btn-navy btn-sm">Guardar fechas</SubmitButton></div>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem" }}>Premio del Saque Masters</h2>
          <form action={savePrizeAction} style={{ marginTop: ".75rem" }}>
            <div className="fields">
              <div><label htmlFor="amount">Importe (€) en bono monedero Playtomic</label><input id="amount" name="amount" type="number" min={0} defaultValue={prize.amount ?? 200} /></div>
              <div><label htmlFor="scope">¿A quién se entrega?</label>
                <select id="scope" name="scope" defaultValue={prize.award_scope ?? ""}>
                  <option value="">Sin decidir (la web no lo especifica)</option><option value="PAIR">Por pareja ganadora</option><option value="PLAYER">Por jugador</option>
                </select></div>
            </div>
            <div style={{ marginTop: "1rem" }}><SubmitButton className="btn btn-navy btn-sm">Guardar premio</SubmitButton></div>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem" }}>Pistas del club</h2>
          <form action={saveCourtsAction} style={{ marginTop: ".5rem" }}>
            <label htmlFor="courts">Número de pistas</label>
            <input id="courts" name="courts" type="number" min={1} max={MAX_COURTS} defaultValue={mergeRules(season.rules).courts} required style={{ maxWidth: 140 }} />
            <p className="help">Los jugadores eligen la pista de una lista: Pista 1 hasta la última. Cambiarlo no altera los partidos que ya tienen pista.</p>
            <SubmitButton className="btn btn-navy btn-sm">Guardar</SubmitButton>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem" }}>Privacidad: móviles entre rivales</h2>
          <form action={saveContactAction} style={{ marginTop: ".5rem" }}>
            <label className="check"><input type="checkbox" name="share" defaultChecked={season.share_rival_contact} /> Mostrar a cada pareja el móvil de sus rivales para acordar el partido</label>
            <p className="help">Nunca se enseña el móvil de jugadores marcados como menores. Con esto desactivado, los jugadores no ven ningún contacto.</p>
            <SubmitButton className="btn btn-navy btn-sm">Guardar</SubmitButton>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem" }}>Avisos por email</h2>
          <ul style={{ margin: ".6rem 0", paddingLeft: "1.1rem" }}>
            <li>Envío de emails: <b>{mailOn ? `configurado (remitente ${fromAddress()})` : "NO configurado"}</b></li>
            <li>Se envían por email: <b>fechas propuestas, fechas aceptadas y resultados introducidos</b>. El resto de avisos (confirmaciones, impugnaciones, pista, chat, recordatorios…) solo aparecen en la web.</li>
            <li>Tarea diaria (confirma resultados a las 48 h, crea recordatorios en la web y limpia chats): <b>{cronOn ? "configurada" : "no configurada (falta CRON_SECRET)"}</b></li>
            <li>Enviados en las últimas 24 h: <b>{sentRes.count ?? 0}</b> · Pendientes: <b>{pendingRes.count ?? 0}</b> · Con error tras 3 intentos: <b>{failedRes.count ?? 0}</b></li>
          </ul>
          {!mailOn && <p className="help">Añade <code>SMTP_USER</code> y <code>SMTP_PASS</code> (contraseña de aplicación del Gmail del club) en las variables de entorno de Vercel y vuelve a desplegar.</p>}
          <div className="actions">
            <form action={sendTestEmailAction}><SubmitButton className="btn btn-outline btn-sm" pendingText="Enviando…">Enviarme un email de prueba</SubmitButton></form>
            <form action={flushNowAction}><SubmitButton className="btn btn-outline btn-sm" pendingText="Enviando…">Enviar ahora los avisos pendientes</SubmitButton></form>
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.1rem" }}>Administradores</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: ".75rem 0" }}>
            {(admins ?? []).map((a: any) => (
              <li key={a.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: ".5rem 0", borderBottom: "1px solid var(--line)" }}>
                <span>{a.email}{a.email === user.email && <b> (tú)</b>}</span>
                {a.email !== user.email && (
                  <form action={removeAdminAction}><input type="hidden" name="email" value={a.email} /><SubmitButton className="btn btn-danger btn-sm" confirm={`¿Quitar a ${a.email} como administrador?`}>Quitar</SubmitButton></form>
                )}
              </li>
            ))}
          </ul>
          <form action={addAdminAction} style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 260px" }}><label htmlFor="email">Añadir administrador</label><input id="email" name="email" type="email" placeholder="email@ejemplo.com" required /></div>
            <SubmitButton className="btn btn-navy btn-sm">Añadir</SubmitButton>
          </form>
        </div>
      </div>
    </>
  );
}
