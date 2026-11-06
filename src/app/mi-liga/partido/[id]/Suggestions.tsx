import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { FILTERS, type SuggestionDay, type Suggestions as Data } from "@/lib/matching";
import { proposeSuggestionsAction, requestAvailabilityAction } from "../actions";

const first = (name?: string) => (name ?? "").split(" ")[0];

function Days({ days, alt }: { days: SuggestionDay[]; alt?: boolean }) {
  return (
    <>
      {days.map((d) => (
        <div className="sug-day" key={d.date}>
          <b>{d.label}</b>
          <div className="chipbox">
            {d.options.map((o) => (
              <label className={`chip-check${alt ? " alt" : ""}`} key={o.iso} title={alt ? `${o.start}–${o.end} · falta confirmar a ${o.unknownName ?? "una persona"}` : `${o.start}–${o.end}${o.preferredBy ? ` · preferente para ${o.preferredBy}` : ""}`}>
                <input type="checkbox" name="s" value={o.iso} aria-label={`${d.label}, ${o.start} a ${o.end}${alt ? `, falta confirmar a ${o.unknownName ?? "una persona"}` : ""}`} />
                <span>{o.start}{o.preferredBy >= 2 && !alt ? " ★" : ""}{alt ? ` · falta ${first(o.unknownName)}` : ""}</span>
              </label>
            ))}
            {d.more > 0 && <span className="subtle" style={{ alignSelf: "center" }}>+{d.more} más</span>}
          </div>
        </div>
      ))}
    </>
  );
}

/** «Mejores horarios»: coincidencias de los calendarios de los cuatro jugadores, para proponer con un clic. */
export function Suggestions({ matchId, data, filter, theirsLive, free, rivalName, meMissing, moreDays }: {
  matchId: string; data: Data; filter: string; theirsLive: boolean; free: number; rivalName: string; meMissing: boolean; moreDays: string;
}) {
  const max = theirsLive ? 5 : free;
  const noRoom = !theirsLive && free <= 0;
  const nothing = data.total4 === 0 && data.total3 === 0;
  return (
    <div className="card" id="horarios" style={{ marginTop: "1rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Mejores horarios para los cuatro</h2>
      <p className="subtle" style={{ margin: "0 0 .9rem" }}>Son horarios de 90 minutos según los calendarios de los cuatro. No está comprobado que haya pista libre: tendréis que reservarla.</p>

      {data.missing.length > 0 && (
        <div className="callout warn">
          <b>Faltan por rellenar su disponibilidad:</b> {data.missing.map((m) => m.name).join(", ")}.<br />
          {data.missing.length === 1 ? "Mientras tanto verás alternativas en las que falta confirmarle. " : "Con dos o más sin calendario no se pueden sugerir horarios. "}
          Podéis rellenarla vosotros si es vuestro compañero/a, o pedírselo.
          <div className="actions" style={{ marginTop: ".6rem" }}>
            <Link className="btn btn-navy btn-sm" href="/mi-liga/disponibilidad">Mi disponibilidad</Link>
            {!meMissing && <form action={requestAvailabilityAction}><input type="hidden" name="match" value={matchId} /><SubmitButton className="btn btn-outline btn-sm">Pedir que la rellenen</SubmitButton></form>}
          </div>
        </div>
      )}

      {nothing ? (
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

              {data.best.length > 0 && (
                <div className="sug-best">
                  <b>Recomendados</b> <span className="subtle">(los cuatro podéis; antes los preferidos y los más próximos)</span>
                  <div className="chipbox">
                    {data.best.map((o) => (
                      <label className="chip-check" key={o.iso} title={`${o.start}–${o.end}`}>
                        <input type="checkbox" name="s" value={o.iso} aria-label={`Recomendado: ${o.label}, ${o.start} a ${o.end}`} /><span>{o.label}{o.preferredBy >= 2 ? " ★" : ""}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {data.days.length > 0 && <h3 className="sug-h">Los cuatro podéis (4 de 4)</h3>}
              <Days days={data.days} />
              {data.hiddenDays > 0 && <p style={{ margin: ".9rem 0 0" }}><Link href={moreDays} scroll={false}>Ver {data.hiddenDays} {data.hiddenDays === 1 ? "día más" : "días más"}</Link></p>}

              {data.alt.length > 0 && (
                <details className="sug-alt" open={data.total4 === 0}>
                  <summary>Alternativas a consultar (3 de 4): {data.total3} {data.total3 === 1 ? "horario" : "horarios"}</summary>
                  <p className="subtle" style={{ margin: ".4rem 0 0" }}>Aquí tres podéis y a una persona no le consta (no ha marcado ese horario ni ha dicho que no puede). No son compatibles seguro: proponedlos solo si podéis consultárselo.</p>
                  <Days days={data.alt} alt />
                </details>
              )}

              <p className="subtle" style={{ margin: ".9rem 0" }}>
                Elige hasta {max} horarios (pulsa la hora de inicio; cada partido dura 90 minutos; ★ = preferido por varios).
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
