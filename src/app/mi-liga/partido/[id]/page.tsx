import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlayer } from "@/lib/auth";
import { getSeasonRow, loadBase, loadPairs, loadMatches, loadOpenSubmissions, loadOptions, matchWhen, pairMap, pairName } from "@/lib/data";
import { Flash, MatchPill } from "@/components/ui";
import { ScoreInputs } from "@/components/ScoreInputs";
import { SubmitButton } from "@/components/SubmitButton";
import { isoToMadridParts, timeLeft } from "@/lib/dates";
import { claimHereAction, respondAction, submitResultAction } from "../actions";
import { Chat } from "./Chat";
import { CHAT_CLOSED, loadChat } from "@/lib/chat";
import { Scheduling } from "./Scheduling";

export default async function Partido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer(`/mi-liga/partido/${id}`);
  const season = await getSeasonRow(sb);
  if (!season) notFound();
  const m = (await loadMatches(sb, season.id, { id }))[0];
  if (!m || !(pairIds.includes(m.pairA) || pairIds.includes(m.pairB))) notFound();
  const side = pairIds.includes(m.pairA) ? "A" : "B";
  const base = await loadBase(sb);
  const cats = base?.cats ?? [];
  const phase = base?.phases.find((p) => p.id === m.phaseId);
  const myPairId = side === "A" ? m.pairA : m.pairB;
  const [pairs, subs, contacts, options, bookRes, chatMsgs, identityRes] = await Promise.all([
    loadPairs(sb, season.id, { ids: [m.pairA, m.pairB] }), loadOpenSubmissions(sb, [id]),
    sb.rpc("rival_contacts", { p_match: id }), loadOptions(sb, id),
    sb.from("matches").select("booking_ref").eq("id", id).maybeSingle(),
    loadChat(sb, id), sb.rpc("pair_identity", { p_pair: myPairId }),
  ]);
  const identityRows = ((identityRes.data ?? []) as { player_id: string; full_name: string; is_me: boolean }[]);
  const needsIdentity = !identityRows.some((r) => r.is_me);
  const negotiable = !["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status) && m.status !== "DISPUTED" && m.status !== "RESULT_PENDING_CONFIRMATION";
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

      {negotiable && (
        <>
          {(contacts.data as any[] | null)?.length ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <p style={{ margin: 0 }}>Contacto de vuestros rivales:{" "}
                {(contacts.data as any[]).map((c) => (
                  <span key={c.phone} style={{ marginRight: "1rem", whiteSpace: "nowrap" }}>{c.player_name}{" "}
                    <a href={`https://wa.me/${String(c.phone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"><b>WhatsApp</b></a>{" · "}<a href={`tel:${c.phone}`}>llamar</a></span>
                ))}
              </p>
            </div>
          ) : null}
          <Scheduling m={m} options={options} myPairId={side === "A" ? m.pairA : m.pairB} rivalName={pairName(rival)} minDay={minDay} maxDay={maxDay} bookingRef={(bookRes.data as any)?.booking_ref ?? null} />
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
