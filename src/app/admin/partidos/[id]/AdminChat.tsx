import { SubmitButton } from "@/components/SubmitButton";
import { fmtDateTime } from "@/lib/dates";
import { deleteMessageAction, orgMessageAction, restoreMessageAction } from "../chat-actions";

export interface AdminMessage {
  id: string; kind: string; author_name: string | null; body: string; created_at: string;
  deleted_at: string | null; deleted_by: string | null; delete_reason: string | null;
}

/** Chat completo de un partido para la organización: moderación y mensajes de la organización. */
export function AdminChat({ matchId, messages, hasMinors }: { matchId: string; messages: AdminMessage[]; hasMinors: boolean }) {
  const user = messages.filter((m) => m.kind === "USER").length;
  return (
    <div className="card">
      <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Chat del partido ({user} {user === 1 ? "mensaje" : "mensajes"} de jugadores)</h2>
      <p className="muted" style={{ margin: "0 0 .75rem" }}>Lo ven solo los cuatro jugadores y la organización. Al eliminar un mensaje, los jugadores ven que lo ha retirado la organización.</p>
      {hasMinors && <p className="callout warn">En este partido participan menores. Revisa el chat con especial atención.</p>}
      {messages.length === 0 ? <p className="subtle">Todavía no hay mensajes.</p> : (
        <ul className="optlist" style={{ maxHeight: 420, overflowY: "auto" }}>
          {messages.map((m) => (
            <li key={m.id} className={`optrow${m.deleted_at ? " dim" : ""}`} style={m.kind === "SYSTEM" ? { background: "var(--mist)" } : m.kind === "ORG" ? { background: "#fff1d6" } : undefined}>
              <span style={{ flex: "1 1 260px", overflowWrap: "anywhere" }}>
                <b>{m.kind === "SYSTEM" ? "Sistema" : m.author_name}</b> <span className="subtle">· {fmtDateTime(m.created_at)}</span><br />
                <span style={{ whiteSpace: "pre-wrap", textDecoration: m.deleted_at ? "line-through" : undefined }}>{m.body}</span>
                {m.deleted_at && <><br /><span className="subtle">Eliminado por {m.deleted_by}: {m.delete_reason}</span></>}
              </span>
              {m.kind === "USER" && (m.deleted_at ? (
                <form action={restoreMessageAction}>
                  <input type="hidden" name="match" value={matchId} /><input type="hidden" name="message" value={m.id} />
                  <SubmitButton className="btn btn-outline btn-sm">Restaurar</SubmitButton>
                </form>
              ) : (
                <form action={deleteMessageAction} style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                  <input type="hidden" name="match" value={matchId} /><input type="hidden" name="message" value={m.id} />
                  <input name="reason" type="text" required placeholder="Motivo" aria-label="Motivo de la eliminación" style={{ width: 150, padding: ".4rem .6rem" }} />
                  <SubmitButton className="btn btn-danger btn-sm" confirm="El mensaje dejará de verse para los jugadores. ¿Eliminarlo?">Eliminar</SubmitButton>
                </form>
              ))}
            </li>
          ))}
        </ul>
      )}
      <form action={orgMessageAction} style={{ marginTop: "1rem" }}>
        <input type="hidden" name="match" value={matchId} />
        <label htmlFor="org-body">Escribir como organización</label>
        <textarea id="org-body" name="body" maxLength={1000} required placeholder="Aparecerá destacado en el chat y se avisará a los cuatro jugadores." />
        <div style={{ marginTop: ".6rem" }}><SubmitButton className="btn btn-navy btn-sm">Enviar al chat</SubmitButton></div>
      </form>
    </div>
  );
}
