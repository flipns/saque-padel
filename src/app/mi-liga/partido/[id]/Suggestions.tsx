import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { FILTERS, type Suggestions as Data } from "@/lib/matching";
import { proposeSuggestionsAction, requestAvailabilityAction } from "../actions";

/** «Mejores horarios»: coincidencias de los calendarios de los cuatro jugadores, para proponer con un clic. */
export function Suggestions({ matchId, data, filter, theirsLive, free, rivalName, meMissing, moreDays }: {
  matchId: string; data: Data; filter: string; theirsLive: boolean; free: number; rivalName: string; meMissing: boolean; moreDays: string;
}) {
  const max = theirsLive ? 5 : free;
  const noRoom = !theirsLive && free <= 0;
  return (
    <div className="card" id="horarios" style={{ marginTop: "1rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Mejores horarios para los cuatro</h2>
      <p className="subtle" style={{ margin: "0 0 .9rem" }}>Son horarios de 90 minutos en los que los cuatro habéis marcado que podéis. No está comprobado que haya pista libre: tendréis que reservarla.</p>

      {data.missing.length > 0 ? (
        <div className="callout warn" style={{ marginBottom: 0 }}>
          <b>Faltan por rellenar su disponibilidad:</b> {data.missing.map((m) => m.name).join(", ")}.<br />
          Sin los cuatro calendarios no se puede sugerir nada. {meMissing ? "" : "Podéis pedirles que la completen, o rellenarla vosotros si es vuestro compañero/a. "}
          <div className="actions" style={{ marginTop: ".6rem" }}>
            <Link className="btn btn-navy btn-sm" href="/mi-liga/disponibilidad">Mi disponibilidad</Link>
            {!meMissing && (
              <form action={requestAvailabilityAction}><input type="hidden" name="match" value={matchId} /><SubmitButton className="btn btn-outline btn-sm">Pedir que la rellenen</SubmitButton></form>
            )}
          </div>
        </div>
      ) : data.total === 0 ? (
        <div className="callout" style={{ marginBottom: 0 }}>
          <b>No hay coincidencias completas{filter !== "todos" ? " con este filtro" : ""}.</b> No hay ningún horario de 90 minutos en el que podáis los cuatro dentro del plazo.
          <div className="actions" style={{ marginTop: ".6rem" }}>
            <form action={requestAvailabilityAction}><input type="hidden" name="match" value={matchId} /><SubmitButton className="btn btn-outline btn-sm">Pedir que actualicen su disponibilidad</SubmitButton></form>
            <Link className="btn btn-outline btn-sm" href="/mi-liga/disponibilidad">Revisar la mía</Link>
          </div>
          <p className="subtle" style={{ margin: ".6rem 0 0" }}>También podéis proponer horarios a mano más abajo o hablarlo en el chat.</p>
        </div>
      ) : (
        <>
          <nav className="chips" aria-label="Filtrar horarios" style={{ marginBottom: ".5rem" }}>
            {FILTERS.map(([v, label]) => <Link key={v} className="chip" href={`?f=${v}#horarios`} aria-current={filter === v} scroll={false}>{label}</Link>)}
          </nav>
          {noRoom ? <p className="subtle">Ya hay 5 horarios activos. Retirad alguno para proponer otros.</p> : (
            <form action={proposeSuggestionsAction}>
              <input type="hidden" name="match" value={matchId} /><input type="hidden" name="replace" value={theirsLive ? "1" : "0"} />
              {data.days.map((d) => (
                <div className="sug-day" key={d.date}>
                  <b>{d.label}</b>
                  <div className="chipbox">
                    {d.options.map((o) => (
                      <label className="chip-check" key={o.iso} title={`${o.start}–${o.end}`}>
                        <input type="checkbox" name="s" value={o.iso} aria-label={`${d.label}, ${o.start} a ${o.end}`} /><span>{o.start}</span>
                      </label>
                    ))}
                    {d.more > 0 && <span className="subtle" style={{ alignSelf: "center" }}>+{d.more} más</span>}
                  </div>
                </div>
              ))}
              {data.hiddenDays > 0 && <p style={{ margin: ".9rem 0 0" }}><Link href={moreDays} scroll={false}>Ver {data.hiddenDays} {data.hiddenDays === 1 ? "día más" : "días más"}</Link></p>}
              <p className="subtle" style={{ margin: ".9rem 0" }}>
                Elige hasta {max} horarios (pulsa la hora de inicio; cada partido dura 90 minutos).
                {theirsLive ? ` Al enviar, se cierran los horarios que os propuso ${rivalName}.` : ""}
              </p>
              <SubmitButton pendingText="Enviando…">{theirsLive ? "Proponer estos y cerrar los de mis rivales" : "Proponer los seleccionados"}</SubmitButton>
            </form>
          )}
        </>
      )}
    </div>
  );
}
