import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlayer } from "@/lib/auth";
import { loadBase, loadPairs, loadMatches, loadOpenSubmissions, loadOptions, matchWhen, pairMap, pairName } from "@/lib/data";
import { Flash, MatchPill } from "@/components/ui";
import { ScoreInputs } from "@/components/ScoreInputs";
import { SubmitButton } from "@/components/SubmitButton";
import { isoToMadridParts, timeLeft } from "@/lib/dates";
import { mergeRules } from "@/lib/engine";
import { claimHereAction, respondAction, submitResultAction, withdrawResultAction } from "../actions";
import { Chat } from "./Chat";
import { CHAT_CLOSED, loadChat } from "@/lib/chat";
import { FILTERS } from "@/lib/matching";

const FILTER_KEYS: string[] = FILTERS.map((f) => f[0]);
import { Scheduling } from "./Scheduling";
import { SuggestionsDeferred } from "./Deferred";
import { loadMatchSuggestions } from "@/lib/matching";

function SetsLine({ mine, their }: { mine: number[]; their: number[] }) {
  return (
    <div className="match" style={{ border: 0, padding: 0 }}>
      <div className="teams"><span className="team">Vosotros</span><span className="sets">{mine.join("  ")}</span><span className="team">Rivales</span><span className="sets">{their.join("  ")}</span></div>
    </div>
  );
}

export default async function Partido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; f?: string; n?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer(`/mi-liga/partido/${id}`);
  const base = await loadBase(sb);
  if (!base) notFound();
  const { season, cats, phases } = base;
  // Todo lo que depende solo del identificador del partido se pide a la vez (antes eran 4 pasos seguidos).
  // Si el partido no es tuyo, algunas de estas consultas no devuelven nada y más abajo se responde «no encontrado».
  const [matchRows, allPairs, subs, contacts, options, bookRes, chatMsgs, identities] = await Promise.all([
    loadMatches(sb, season.id, { id }),
    loadPairs(sb, season.id),
    loadOpenSubmissions(sb, [id]),
    sb.rpc("rival_contacts", { p_match: id }),
    loadOptions(sb, id).catch(() => []),
    sb.from("matches").select("booking_ref").eq("id", id).maybeSingle(),
    loadChat(sb, id).catch(() => []),
    Promise.all(pairIds.map((pid) => sb.rpc("pair_identity", { p_pair: pid }))),
  ]);
  const m = matchRows[0];
  if (!m || !(pairIds.includes(m.pairA) || pairIds.includes(m.pairB))) notFound();
  const side = pairIds.includes(m.pairA) ? "A" : "B";
  const phase = phases.find((p) => p.id === m.phaseId);
  const myPairId = side === "A" ? m.pairA : m.pairB;
  const pairs = allPairs.filter((p) => p.id === m.pairA || p.id === m.pairB);
  const identityRes = identities[pairIds.indexOf(myPairId)];
  const identityRows = ((identityRes.data ?? []) as { player_id: string; full_name: string; is_me: boolean }[]);
  const needsIdentity = !identityRows.some((r) => r.is_me);
  const negotiable = !["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status) && m.status !== "DISPUTED" && m.status !== "RESULT_PENDING_CONFIRMATION";
  // Horarios sugeridos por el cruce de calendarios (solo mientras se puede proponer fecha).
  const canPropose = ["PENDING_SCHEDULE", "SCHEDULE_PROPOSED", "RESCHEDULE_REQUESTED"].includes(m.status);
  const filter = FILTER_KEYS.includes(sp.f ?? "") ? (sp.f as string) : "todos";
  const maxDays = sp.n === "30" ? 30 : 8;
  const liveOptions = options.filter((o) => o.state === "ACTIVE" && new Date(o.startsAt).getTime() > Date.now());
  // Se calcula en paralelo y se envía en diferido: la pantalla no espera a este bloque.
  const suggestionsP = canPropose && phase
    ? loadMatchSuggestions(sb, season.id, m, pairs, phase, { filter, maxDays, excludeMs: liveOptions.map((o) => Date.parse(o.startsAt)), options: liveOptions.map((o) => ({ id: o.id, startsAt: o.startsAt })) })
        .catch((e) => { console.error("suggestions failed", e); return null; })
    : null;
  const meIdentity = identityRows.find((r) => r.is_me);
  const today = isoToMadridParts(new Date().toISOString()).date;
  const minDay = phase && phase.starts_on > today ? phase.starts_on : today;
  const maxDay = phase?.results_deadline ?? today;
  const pm = pairMap(pairs);
  const me = pm.get(side === "A" ? m.pairA : m.pairB), rival = pm.get(side === "A" ? m.pairB : m.pairA);
  const cat = cats.find((c) => c.id === m.categoryId);
  const sub = subs.get(id);
  const closed = ["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status);
  const mySets = m.sets.map((s) => (side === "A" ? s.a : s.b)), theirSets = m.sets.map((s) => (side === "A" ? s.b : s.a));
  const iWon = m.winner === side, theyWon = m.winner && m.winner !== side;
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
          <div className="when">{matchWhen(m)}{m.endedByTime && " · terminó por tiempo"}</div>
        </div>
      </div>

      {m.status === "WO" && <p className="hint" style={{ marginTop: "1rem" }}>Este partido se resolvió por WO. Puntos de fase: {side === "A" ? m.pointsOverride?.a : m.pointsOverride?.b}.</p>}
      {m.status === "NOT_PLAYED" && <p className="hint" style={{ marginTop: "1rem" }}>La organización ha marcado este partido como no disputado.</p>}

      {(m.status === "RESULT_PENDING_CONFIRMATION" || m.status === "DISPUTED") && sub && (
        <div className="card" style={{ marginTop: "1rem" }}>
          {m.status === "DISPUTED" ? (
            <>
              <h2 style={{ fontSize: "1.1rem" }}>Resultado impugnado</h2>
              <p className="muted" style={{ margin: ".4rem 0 .75rem" }}>La organización revisará las versiones y fijará el resultado definitivo.{iSubmitted ? " Si te has equivocado, puedes corregir el tuyo o retirarlo." : ""}</p>
              <div className="stack">
                <div><p className="subtle" style={{ margin: 0 }}>Enviado por {iSubmitted ? "vosotros" : pairName(rival)}</p><SetsLine mine={mySets} their={theirSets} /></div>
                {sub.dispute_sets && (
                  <div>
                    <p className="subtle" style={{ margin: 0 }}>Versión de {iSubmitted ? pairName(rival) : "vosotros"}</p>
                    <SetsLine mine={(sub.dispute_sets as { a: number; b: number }[]).map((x) => (side === "A" ? x.a : x.b))} their={(sub.dispute_sets as { a: number; b: number }[]).map((x) => (side === "A" ? x.b : x.a))} />
                  </div>
                )}
                {sub.dispute_reason && <p style={{ margin: 0 }}><b>Motivo:</b> {sub.dispute_reason}</p>}
              </div>
            </>
          ) : iSubmitted ? (
            <>
              <h2 style={{ fontSize: "1.1rem" }}>Esperando a vuestros rivales</h2>
              <p className="muted" style={{ margin: ".4rem 0 0" }}>Tienen {timeLeft(sub.deadline_at)} para confirmar o impugnar. Si no responden, el resultado se da por bueno automáticamente. ¿Te has equivocado? Puedes corregirlo o retirarlo mientras no lo hayan confirmado.</p>
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
                  <form action={respondAction} style={{ marginTop: ".75rem", maxWidth: 460 }}>
                    <input type="hidden" name="match" value={id} /><input type="hidden" name="submission" value={sub.id} /><input type="hidden" name="decision" value="dispute" />
                    <label htmlFor="reason">¿Qué no es correcto?</label><textarea id="reason" name="reason" required />
                    <p className="subtle" style={{ margin: ".75rem 0 .25rem" }}><b>Si sabes cuál fue el resultado exacto, escríbelo</b> (opcional): la organización lo revisará junto con el enviado.</p>
                    <ScoreInputs left="Nosotros" right="Ellos" />
                    <label className="check"><input type="checkbox" name="time" /> Se acabó el tiempo (90 min) y quedó sin terminar</label>
                    <div style={{ marginTop: ".6rem" }}><SubmitButton className="btn btn-danger btn-sm">Enviar impugnación</SubmitButton></div>
                  </form>
                </details>
              </div>
            </>
          )}

          {iSubmitted && (
            <div className="stack" style={{ marginTop: "1rem" }}>
              <details>
                <summary className="btn btn-outline btn-sm" style={{ listStyle: "none", display: "inline-flex" }}>Corregir el resultado</summary>
                <form action={submitResultAction} style={{ marginTop: ".75rem" }}>
                  <input type="hidden" name="match" value={id} />
                  <p className="subtle" style={{ margin: "0 0 .5rem" }}>Escribe el resultado correcto. Vuestros rivales tendrán de nuevo 48 horas para confirmarlo.</p>
                  <ScoreInputs left="Nosotros" right="Ellos" initial={m.sets.map((x) => (side === "A" ? { a: x.a, b: x.b } : { a: x.b, b: x.a }))} />
                  <label className="check"><input type="checkbox" name="time" defaultChecked={m.endedByTime} /> Se acabó el tiempo (90 min) y quedó sin terminar</label>
                  <SubmitButton>Enviar resultado corregido</SubmitButton>
                </form>
              </details>
              <form action={withdrawResultAction}>
                <input type="hidden" name="match" value={id} />
                <SubmitButton className="btn btn-danger btn-sm" confirm="El resultado se retira y el partido vuelve a estar sin resultado. ¿Retirarlo?">Retirar el resultado</SubmitButton>
              </form>
            </div>
          )}
        </div>
      )}

      {negotiable && (
        <>
          {(contacts.data as any[] | null)?.length ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <p style={{ margin: "0 0 .6rem", fontWeight: 800 }}>Contacto de vuestros rivales</p>
              <ul className="contacts-list">
                {(contacts.data as any[]).map((c) => (
                  <li key={c.phone}>
                    <span className="cname">{c.player_name}</span>
                    <span className="cactions">
                      <a className="btn btn-outline btn-sm" href={`https://wa.me/${String(c.phone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp a ${c.player_name}`}>WhatsApp</a>
                      <a className="btn btn-outline btn-sm" href={`tel:${c.phone}`} aria-label={`Llamar a ${c.player_name}`}>Llamar</a>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {suggestionsP && (
            <SuggestionsDeferred promise={suggestionsP} matchId={id} filter={filter} theirsLive={liveOptions.some((o) => o.pairId !== myPairId)} free={5 - liveOptions.length}
              rivalName={pairName(rival)} meId={meIdentity?.player_id} moreDays={`?f=${filter}&n=30#horarios`} />
          )}
          <Scheduling m={m} options={options} hintsPromise={suggestionsP} myPairId={side === "A" ? m.pairA : m.pairB} rivalName={pairName(rival)} minDay={minDay} maxDay={maxDay} bookingRef={(bookRes.data as any)?.booking_ref ?? null} courts={mergeRules(season.rules).courts} />
        </>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Chat del partido</h2>
        <p className="chat-note">Lo ven solo los cuatro jugadores y la organización, que puede moderarlo. Usadlo para acordar el partido. Si eres menor, participas con la autorización de tu tutor.</p>
        <Chat matchId={id} initial={chatMsgs} myPairId={myPairId} canWrite={!CHAT_CLOSED.includes(m.status)}
          closedNote="El partido está cerrado: el chat queda solo de lectura."
          identity={needsIdentity && !CHAT_CLOSED.includes(m.status) ? (
            <div className="callout" style={{ marginTop: ".75rem", marginBottom: 0 }}>
              <b>Para escribir en el chat, indica quién eres.</b>
              <div className="actions" style={{ marginTop: ".6rem" }}>
                {identityRows.map((r) => (
                  <form key={r.player_id} action={claimHereAction}>
                    <input type="hidden" name="match" value={id} /><input type="hidden" name="pair" value={myPairId} /><input type="hidden" name="player" value={r.player_id} />
                    <SubmitButton className="btn btn-outline btn-sm" confirm={`¿Confirmas que eres ${r.full_name}? Solo se puede cambiar avisando a la organización.`}>Soy {r.full_name}</SubmitButton>
                  </form>
                ))}
              </div>
            </div>
          ) : undefined} />
      </div>

      {negotiable && (
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
      )}
    </>
  );
}
