import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { loadNotifications } from "@/lib/data";
import { fmtDateTime } from "@/lib/dates";
import { MarkRead } from "./MarkRead";
import { Flash } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { setEmailPrefAction } from "./actions";
import { EMAIL_SCOPE_TEXT } from "@/lib/emailPolicy";

export default async function Avisos({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requirePlayer("/mi-liga/avisos");
  const [list, prefRes] = await Promise.all([loadNotifications(sb, 60), sb.from("notification_prefs").select("email_enabled").maybeSingle()]);
  const emailOn = (prefRes.data as any)?.email_enabled !== false;
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>Avisos</h1>
      <p className="muted" style={{ margin: ".3rem 0 1rem" }}>Propuestas de fecha, fechas acordadas, pistas y resultados de tus partidos.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <MarkRead unread={unread} />
      <div className="card" style={{ marginBottom: "1rem" }}>
        <form action={setEmailPrefAction} style={{ display: "flex", flexWrap: "wrap", gap: ".75rem 1.25rem", alignItems: "center", justifyContent: "space-between" }}>
          <span><b>Avisos por email: {emailOn ? "activados" : "desactivados"}</b><br /><span className="subtle">{emailOn ? `Te escribimos por email ${EMAIL_SCOPE_TEXT}. El resto de avisos los ves aquí, en la web.` : "Los avisos solo aparecerán aquí, en la web."}</span></span>
          <input type="hidden" name="enabled" value={emailOn ? "0" : "1"} />
          <SubmitButton className="btn btn-outline btn-sm">{emailOn ? "Dejar de recibir emails" : "Volver a recibir emails"}</SubmitButton>
        </form>
      </div>
      {list.length === 0 ? <p className="card empty">Todavía no tienes avisos.</p> : (
        <div className="stack">
          {list.map((n) => {
            const body = (
              <>
                <h3>{n.title}</h3>
                {n.body && <p>{n.body}</p>}
                <small>{fmtDateTime(n.created_at)}{!n.read_at && " · nuevo"}</small>
              </>
            );
            return n.match_id
              ? <Link key={n.id} href={`/mi-liga/partido/${n.match_id}`} className={`notif${n.read_at ? "" : " unread"}`}>{body}</Link>
              : <div key={n.id} className={`notif${n.read_at ? "" : " unread"}`}>{body}</div>;
          })}
        </div>
      )}
    </>
  );
}
