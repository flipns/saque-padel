import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlayer } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadMatches, loadOpenSubmissions, pairMap, pairName } from "@/lib/data";
import { Flash, MatchPill } from "@/components/ui";
import { ScoreInputs } from "@/components/ScoreInputs";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtDateTime, isoToMadridParts, timeLeft } from "@/lib/dates";
import { respondAction, scheduleAction, submitResultAction } from "../actions";

export default async function Partido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer(`/mi-liga/partido/${id}`);
  const season = await getSeasonRow(sb);
  if (!season) notFound();
  const m = (await loadMatches(sb, season.id, { id }))[0];
  if (!m || !(pairIds.includes(m.pairA) || pairIds.includes(m.pairB))) notFound();
  const side = pairIds.includes(m.pairA) ? "A" : "B";
  const [cats, pairs, subs, contacts] = await Promise.all([
    loadCats(sb, season.id), loadPairs(sb, season.id, { ids: [m.pairA, m.pairB] }), loadOpenSubmissions(sb, [id]),
    sb.rpc("rival_contacts", { p_match: id }),
  ]);
  const pm = pairMap(pairs);
  const me = pm.get(side === "A" ? m.pairA : m.pairB), rival = pm.get(side === "A" ? m.pairB : m.pairA);
  const cat = cats.find((c) => c.id === m.categoryId);
  const sub = subs.get(id);
  const closed = ["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status);
  const mySets = m.sets.map((s) => (side === "A" ? s.a : s.b)), theirSets = m.sets.map((s) => (side === "A" ? s.b : s.a));
  const iWon = m.winner === side, theyWon = m.winner && m.winner !== side;
  const when = isoToMadridParts(m.scheduledAt);
  const iSubmitted = sub && sub.submitted_by_pair === (side === "A" ? m.pairA : m.pairB);

  return (
    <>
      <p style={{ margin: "0 0 1rem" }}><Link href="/mi-liga">← Mi liga</Link></p>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <div className="match" style={{ border: 0, padding: 0 }}>
          <div className="meta"><span>{cat?.label} · Grupo {m.groupLetter} · Fase {m.phaseNumber}</span><MatchPill status={m.status} /></div>
          <div className="teams" style={{ fontSize: "1.15rem" }}>
            <span className={`team${iWon ? " win" : ""}`}>{pairName(me)} <small className="muted">(vosotros)</small></span><span className="sets">{mySets.join("  ")}</span>
            <span className={`team${theyWon ? " win" : ""}`}>{pairName(rival)}</span><span className="sets">{theirSets.join("  ")}</span>
          </div>
          <div className="when">{m.scheduledAt ? `${fmtDateTime(m.scheduledAt)}${m.court ? ` · ${m.court}` : ""}` : "Sin fecha acordada todavía"}{m.endedByTime && " · terminó por tiempo"}</div>
        </div>
      </div>

      {m.status === "WO" && <p className="hint" style={{ marginTop: "1rem" }}>Este partido se resolvió por WO. Puntos de fase: {side === "A" ? m.pointsOverride?.a : m.pointsOverride?.b}.</p>}
      {m.status === "NOT_PLAYED" && <p className="hint" style={{ marginTop: "1rem" }}>La organización ha marcado este partido como no disputado.</p>}

      {m.status === "DISPUTED" && (
        <div className="card" style={{ marginTop: "1rem" }}><h2 style={{ fontSize: "1.1rem" }}>Resultado impugnado</h2><p className="muted" style={{ margin: ".4rem 0 0" }}>La organización revisará el caso y fijará el resultado definitivo.</p></div>
      )}

      {m.status === "RESULT_PENDING_CONFIRMATION" && sub && (
        <div className="card" style={{ marginTop: "1rem" }}>
          {iSubmitted ? (
            <>
              <h2 style={{ fontSize: "1.1rem" }}>Esperando a vuestros rivales</h2>
              <p className="muted" style={{ margin: ".4rem 0 0" }}>Tienen {timeLeft(sub.deadline_at)} para confirmar o impugnar. Si no responden, el resultado se da por bueno automáticamente.</p>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "1.1rem" }}>¿Es correcto este resultado?</h2>
              <p style={{ margin: ".4rem 0" }}>Vuestros rivales han enviado <b>{theirSets.map((t, i) => `${t}-${mySets[i]}`).join("  ")}</b> a su favor. Tenéis {timeLeft(sub.deadline_at)} para responder; si no, se confirma solo.</p>
              <div className="actions" style={{ alignItems: "flex-start" }}>
                <form action={respondAction}>
                  <input type="hidden" name="match" value={id} /><input type="hidden" name="submission" value={sub.id} /><input type="hidden" name="decision" value="accept" />
                  <SubmitButton className="btn btn-mint">Confirmar resultado</SubmitButton>
                </form>
                <details>
                  <summary className="btn btn-outline" style={{ listStyle: "none" }}>Impugnar</summary>
                  <form action={respondAction} style={{ marginTop: ".75rem", maxWidth: 420 }}>
                    <input type="hidden" name="match" value={id} /><input type="hidden" name="submission" value={sub.id} /><input type="hidden" name="decision" value="dispute" />
                    <label htmlFor="reason">¿Qué no es correcto?</label><textarea id="reason" name="reason" required />
                    <div style={{ marginTop: ".6rem" }}><SubmitButton className="btn btn-danger btn-sm">Enviar impugnación</SubmitButton></div>
                  </form>
                </details>
              </div>
            </>
          )}
        </div>
      )}

      {!closed && m.status !== "DISPUTED" && m.status !== "RESULT_PENDING_CONFIRMATION" && (
        <>
          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Fecha y pista</h2>
            <p className="muted" style={{ margin: "0 0 .75rem" }}>Cuando os pongáis de acuerdo, apuntadlo aquí (cualquiera de las dos parejas). Recordad reservar la pista de 90 minutos.</p>
            {(contacts.data as any[] | null)?.length ? (
              <p style={{ margin: "0 0 1rem" }}>Contacto de vuestros rivales:{" "}
                {(contacts.data as any[]).map((c) => (
                  <span key={c.phone} style={{ marginRight: "1rem", whiteSpace: "nowrap" }}>{c.player_name}{" "}
                    <a href={`https://wa.me/${String(c.phone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"><b>WhatsApp</b></a>{" · "}<a href={`tel:${c.phone}`}>llamar</a></span>
                ))}
              </p>
            ) : null}
            <form action={scheduleAction}>
              <input type="hidden" name="match" value={id} />
              <div className="fields">
                <div><label htmlFor="date">Día</label><input id="date" name="date" type="date" defaultValue={when.date} /></div>
                <div><label htmlFor="time">Hora</label><input id="time" name="time" type="time" defaultValue={when.time} /></div>
                <div><label htmlFor="court">Pista</label><input id="court" name="court" type="text" defaultValue={m.court ?? ""} placeholder="Ej. Pista 3" /></div>
              </div>
              <div style={{ marginTop: "1rem" }}><SubmitButton className="btn btn-outline btn-sm">Guardar fecha</SubmitButton></div>
            </form>
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Introducir el resultado</h2>
            <p className="muted" style={{ margin: "0 0 1rem" }}>Lo introduce la pareja <b>ganadora</b>. Vuestros rivales tendrán 48 horas para confirmarlo.</p>
            <form action={submitResultAction}>
              <input type="hidden" name="match" value={id} />
              <ScoreInputs left="Nosotros" right="Ellos" />
              <label className="check"><input type="checkbox" name="time" /> Se acabó el tiempo (90 min) y el partido quedó sin terminar</label>
              <SubmitButton>Enviar resultado</SubmitButton>
            </form>
          </div>
        </>
      )}
    </>
  );
}
