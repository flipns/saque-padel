import type { MatchView, OptionView } from "@/lib/data";
import type { Hint } from "@/lib/matching";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtDateTime, fmtRange } from "@/lib/dates";
import { bookingAction, changeDateAction, proposeAction, respondOptionAction, withdrawOptionAction } from "../actions";

const STATE_LABEL: Record<string, string> = {
  ACTIVE: "Activa", ACCEPTED: "Aceptada", REJECTED: "Rechazada", WITHDRAWN: "Retirada", SUPERSEDED: "Descartada", EXPIRED: "Caducada",
};

function DateRows({ count, min, max }: { count: number; min: string; max: string }) {
  return (
    <div className="daterows" role="group" aria-label="Horarios">
      {Array.from({ length: count }, (_, i) => (
        <div className="daterow" key={i}>
          <span>{i + 1}</span>
          <input type="date" name={`d${i + 1}`} min={min} max={max} aria-label={`Día del horario ${i + 1}`} />
          <input type="time" name={`t${i + 1}`} step={900} aria-label={`Hora del horario ${i + 1}`} />
        </div>
      ))}
    </div>
  );
}

/** Coordinación de fecha de un partido: proponer, aceptar, acordar, registrar pista y cambiar fecha. */
export function Scheduling({ m, options, hints, myPairId, rivalName, minDay, maxDay, bookingRef }: {
  m: MatchView; options: OptionView[]; hints?: Record<string, Hint>; myPairId: string; rivalName: string; minDay: string; maxDay: string; bookingRef: string | null;
}) {
  const tag = (id: string) => { const h = hints?.[id]; return h ? <span className={`pill${h.tone === "muted" ? "" : ` pill-${h.tone}`}`}>{h.text}</span> : null; };
  const now = Date.now();
  const live = options.filter((o) => o.state === "ACTIVE" && new Date(o.startsAt).getTime() > now);
  const mineLive = live.filter((o) => o.pairId === myPairId);
  const theirsLive = live.filter((o) => o.pairId !== myPairId);
  const negotiating = ["PENDING_SCHEDULE", "SCHEDULE_PROPOSED", "RESCHEDULE_REQUESTED"].includes(m.status);
  const hasBooking = Boolean(m.scheduledAt);
  const free = 5 - live.length;

  const stateOf = (o: OptionView) => (o.state === "ACTIVE" && new Date(o.startsAt).getTime() <= now ? "EXPIRED" : o.state);

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: ".75rem" }}>Fecha y pista</h2>
      <p className="subtle" style={{ margin: "-.4rem 0 1rem" }}>Cada horario dura 90 minutos y tiene que caer dentro del plazo de la fase. Hasta que la pista esté reservada y apuntada, el partido no está programado.</p>

      {m.status === "SCHEDULED" && (
        <div className="callout ok">
          <b>Programado: {fmtRange(m.scheduledAt!)}</b><br />
          Pista: {m.court}{bookingRef ? ` · referencia ${bookingRef}` : ""}
        </div>
      )}
      {m.status === "DATE_AGREED" && (
        <div className="callout ok">
          <b>Fecha acordada: {fmtRange(m.agreedStartAt!)}</b><br />
          Falta reservar la pista y apuntarla aquí.
          {hasBooking && <><br /><span style={{ color: "var(--ink)" }}>Mientras tanto sigue vigente: {fmtRange(m.scheduledAt!)} · {m.court}.</span></>}
        </div>
      )}
      {m.status === "RESCHEDULE_REQUESTED" && (
        <div className="callout warn">
          <b>Cambio de fecha en curso.</b>{hasBooking && <> Sigue vigente: {fmtRange(m.scheduledAt!)} · {m.court}.</>}
        </div>
      )}
      {m.status === "PENDING_SCHEDULE" && <div className="callout"><b>Todavía no hay fecha.</b> Proponed hasta 5 horarios: vuestros rivales aceptarán el que les venga bien.</div>}

      {negotiating && theirsLive.length > 0 && (
        <section aria-label="Propuestas de vuestros rivales">
          <h3 style={{ fontSize: "1rem" }}>{rivalName} os propone</h3>
          <ul className="optlist">
            {theirsLive.map((o) => (
              <li className="optrow" key={o.id}>
                <span><span className="when">{fmtRange(o.startsAt)}</span> {tag(o.id)}</span>
                <span className="actions">
                  <form action={respondOptionAction}>
                    <input type="hidden" name="match" value={m.id} /><input type="hidden" name="option" value={o.id} /><input type="hidden" name="decision" value="accept" />
                    <SubmitButton className="btn btn-mint btn-sm" confirm={`¿Aceptáis jugar el ${fmtDateTime(o.startsAt)}? Quedará acordado para las dos parejas.`}>Aceptar</SubmitButton>
                  </form>
                  <form action={respondOptionAction}>
                    <input type="hidden" name="match" value={m.id} /><input type="hidden" name="option" value={o.id} /><input type="hidden" name="decision" value="reject" />
                    <SubmitButton className="btn btn-outline btn-sm">No me cuadra</SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Ninguno nos cuadra: proponer otros</summary>
            <form action={proposeAction} style={{ marginTop: ".5rem" }}>
              <input type="hidden" name="match" value={m.id} /><input type="hidden" name="replace" value="1" />
              <p className="subtle" style={{ margin: 0 }}>Al enviar, se cierran los horarios de {rivalName} y quedan los vuestros (hasta 5).</p>
              <DateRows count={5} min={minDay} max={maxDay} />
              <SubmitButton className="btn btn-navy btn-sm" confirm="Se cerrarán los horarios de vuestros rivales. ¿Enviar vuestra propuesta?">Enviar propuesta</SubmitButton>
            </form>
          </details>
        </section>
      )}

      {negotiating && mineLive.length > 0 && (
        <section aria-label="Vuestras propuestas">
          <h3 style={{ fontSize: "1rem" }}>Vuestras propuestas, esperando respuesta</h3>
          <ul className="optlist">
            {mineLive.map((o) => (
              <li className="optrow" key={o.id}>
                <span><span className="when">{fmtRange(o.startsAt)}</span> {tag(o.id)}</span>
                <form action={withdrawOptionAction}>
                  <input type="hidden" name="match" value={m.id} /><input type="hidden" name="option" value={o.id} />
                  <SubmitButton className="btn btn-outline btn-sm">Retirar</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {negotiating && theirsLive.length === 0 && (
        free > 0 ? (
          <form action={proposeAction}>
            <input type="hidden" name="match" value={m.id} /><input type="hidden" name="replace" value="0" />
            <h3 style={{ fontSize: "1rem" }}>{mineLive.length ? `Añadir más horarios (hasta ${free} más)` : "Proponer horarios"}</h3>
            <DateRows count={free} min={minDay} max={maxDay} />
            <p className="subtle" style={{ margin: "0 0 .75rem" }}>Plazo de la fase: hasta el {maxDay.split("-").reverse().join("/")}. Rellena los que quieras; las filas vacías se ignoran.</p>
            <SubmitButton>Enviar propuesta</SubmitButton>
          </form>
        ) : <p className="subtle">Ya hay 5 horarios activos. Retirad alguno para añadir otros.</p>
      )}

      {m.status === "DATE_AGREED" && (
        <form action={bookingAction}>
          <input type="hidden" name="match" value={m.id} />
          <h3 style={{ fontSize: "1rem" }}>¿Ya tenéis la pista?</h3>
          <div className="fields" style={{ maxWidth: 520 }}>
            <div><label htmlFor="court">Pista</label><input id="court" name="court" type="text" required placeholder="Ej. Pista 3" /></div>
            <div><label htmlFor="ref">Referencia (opcional)</label><input id="ref" name="ref" type="text" /></div>
          </div>
          <p className="subtle" style={{ margin: ".5rem 0 .75rem" }}>Reservad la pista en el sistema del club para ese día y hora, y apuntadla aquí. Al registrarla, el partido queda programado y se avisa a los cuatro.</p>
          <SubmitButton>Pista reservada</SubmitButton>
        </form>
      )}

      {(m.status === "DATE_AGREED" || m.status === "SCHEDULED") && (
        <div className="stack" style={{ marginTop: "1rem" }}>
          {m.status === "SCHEDULED" && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 800 }}>Cambiar pista o referencia (misma hora)</summary>
              <form action={bookingAction} style={{ marginTop: ".6rem" }}>
                <input type="hidden" name="match" value={m.id} />
                <div className="fields" style={{ maxWidth: 520 }}>
                  <div><label htmlFor="court2">Pista</label><input id="court2" name="court" type="text" required defaultValue={m.court ?? ""} /></div>
                  <div><label htmlFor="ref2">Referencia</label><input id="ref2" name="ref" type="text" defaultValue={bookingRef ?? ""} /></div>
                </div>
                <div style={{ marginTop: ".6rem" }}><SubmitButton className="btn btn-outline btn-sm">Guardar</SubmitButton></div>
              </form>
            </details>
          )}
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>{m.status === "DATE_AGREED" ? "No hay pista: buscar otra fecha" : "Cambiar la fecha"}</summary>
            <form action={changeDateAction} style={{ marginTop: ".6rem", maxWidth: 520 }}>
              <input type="hidden" name="match" value={m.id} />
              <label htmlFor="reason">Motivo (opcional)</label><textarea id="reason" name="reason" placeholder="Ej. No hay pista libre a esa hora" />
              <p className="subtle" style={{ margin: ".4rem 0 .6rem" }}>{hasBooking ? "La fecha y pista actuales siguen vigentes hasta que haya un nuevo acuerdo y una nueva reserva." : "Se anula la fecha acordada y se empieza de nuevo con las propuestas."}</p>
              <SubmitButton className="btn btn-outline btn-sm" confirm="Se avisará a vuestros rivales. ¿Buscar otra fecha?">Buscar otra fecha</SubmitButton>
            </form>
          </details>
        </div>
      )}

      {options.length > 0 && (
        <details style={{ marginTop: "1.25rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>Historial de propuestas ({options.length})</summary>
          <ul className="optlist">
            {options.map((o) => (
              <li className={`optrow${stateOf(o) === "ACTIVE" ? "" : " dim"}`} key={o.id}>
                <span>{fmtRange(o.startsAt)}</span>
                <span className="subtle">{o.pairId === myPairId ? "Vosotros" : rivalName} · {STATE_LABEL[stateOf(o)]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
