import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { loadNotifications } from "@/lib/data";
import { fmtDateTime } from "@/lib/dates";
import { MarkRead } from "./MarkRead";

export default async function Avisos() {
  const { sb } = await requirePlayer("/mi-liga/avisos");
  const list = await loadNotifications(sb, 60);
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>Avisos</h1>
      <p className="muted" style={{ margin: ".3rem 0 1rem" }}>Propuestas de fecha, fechas acordadas, pistas y resultados de tus partidos.</p>
      <MarkRead unread={unread} />
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
