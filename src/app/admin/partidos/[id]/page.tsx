import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { loadBase, loadPairs, loadMatches, loadOpenSubmissions, loadOptions, matchWhen, pairMap, pairName } from "@/lib/data";
import { matchWinner, mergeRules } from "@/lib/engine";
import { optionsFor } from "@/lib/courts";
import { Flash, MatchPill, PageHead, Pill } from "@/components/ui";
import { ScoreInputs } from "@/components/ScoreInputs";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtDateTime, fmtRange, isoToMadridParts, timeLeft } from "@/lib/dates";
import { AdminChat, type AdminMessage } from "./AdminChat";
import { acceptDisputeVersionAction, acceptSubmittedAction, notPlayedAction, resetAction, scheduleAction, setResultAction, woAction } from "../actions";

export default async function PartidoAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const { sb } = await requireAdmin(`/admin/partidos/${id}`);
  const base = await loadBase(sb);
  if (!base) notFound();
  const { season, cats } = base;
  // Todo lo que depende solo del identificador del partido, a la vez (antes se leía primero el partido).
  const [matchRows, pairs, subs, options, chatRes, rulesRes] = await Promise.all([
    loadMatches(sb, season.id, { id }), loadPairs(sb, season.id), loadOpenSubmissions(sb, [id]), loadOptions(sb, id),
    sb.from("match_messages").select("id, kind, author_name, body, created_at, deleted_at, deleted_by, delete_reason").eq("match_id", id).order("created_at").limit(500),
    sb.from("availability_rules").select("player_id").limit(5000),
  ]);
  const m = matchRows[0];
  if (!m) notFound();
  const informed = new Set(((rulesRes.data ?? []) as { player_id: string }[]).map((r) => r.player_id));
  const pm = pairMap(pairs);
  const a = pm.get(m.pairA), b = pm.get(m.pairB);
  const cat = cats.find((c) => c.id === m.categoryId);
  const sub = subs.get(id);
  const rules = mergeRules(season.rules);
  const when = isoToMadridParts(m.scheduledAt);
  const closed = ["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status);
  const nameA = pairName(a), nameB = pairName(b);

  return (
    <>
      <PageHead title={`${cat?.label} · Grupo ${m.groupLetter}`} sub={`Fase ${m.phaseNumber}`}>
        <MatchPill status={m.status} />
        <Link className="btn btn-outline btn-sm" href={`/admin/partidos?cat=${m.categoryId}&fase=${m.phaseNumber}`}>Volver a la lista</Link>
      </PageHead>
      <Flash ok={ok} err={err} />

      <div className="card">
        <div className="matches" style={{ gridTemplateColumns: "1fr" }}>
          <div className="match" style={{ border: 0, padding: 0 }}>
            <div className="teams" style={{ fontSize: "1.15rem" }}>
              <span className={`team${m.winner === "A" ? " win" : ""}`}>{nameA}</span><span className="sets">{m.sets.map((s) => s.a).join("  ")}</span>
              <span className={`team${m.winner === "B" ? " win" : ""}`}>{nameB}</span><span className="sets">{m.sets.map((s) => s.b).join("  ")}</span>
            </div>
            <div className="when">
              {matchWhen(m) || "Sin fecha acordada"}
              {m.endedByTime && " · terminó por tiempo (90 min)"}
              {m.pointsOverride && ` · puntos de fase: ${m.pointsOverride.a} / ${m.pointsOverride.b}`}
            </div>
          </div>
        </div>
      </div>

      <div className="avail-line">
        <span>Disponibilidad informada:</span>
        {[a, b].flatMap((p) => p?.players ?? []).map((pl) => <span key={pl.id}><b>{pl.name}</b> {informed.has(pl.id) ? "✓" : "✗ sin informar"}</span>)}
      </div>

      {sub && (
        <div className="card" style={{ borderColor: sub.status === "DISPUTED" ? "#efc3c7" : "var(--line)", background: sub.status === "DISPUTED" ? "#fff8f8" : undefined }}>
          <h2 style={{ fontSize: "1.1rem" }}>{sub.status === "DISPUTED" ? "Resultado impugnado" : "Resultado enviado, pendiente de confirmar"}</h2>
          <p style={{ margin: ".4rem 0" }}>
            Enviado por <b>{pairName(pm.get(sub.submitted_by_pair))}</b>: <b>{(sub.sets as any[]).map((s) => `${s.a}-${s.b}`).join("  ")}</b>{sub.ended_by_time ? " (por tiempo)" : ""}
          </p>
          <p className="subtle" style={{ margin: "0 0 .4rem" }}>Los juegos de {nameA} van primero en cada set.</p>
          {sub.status === "DISPUTED" ? (
            <>
              <p style={{ margin: ".4rem 0" }}>Motivo de la impugnación: <i>«{sub.dispute_reason}»</i></p>
              {sub.dispute_sets ? (() => {
                const disputer = sub.submitted_by_pair === m.pairA ? nameB : nameA;
                const w = matchWinner(sub.dispute_sets, sub.dispute_ended_by_time);
                return <p style={{ margin: ".4rem 0" }}>Versión de <b>{disputer}</b>: <b>{(sub.dispute_sets as any[]).map((x) => `${x.a}-${x.b}`).join("  ")}</b>{sub.dispute_ended_by_time ? " (por tiempo)" : ""} · ganaría {w ? <b>{w === "A" ? nameA : nameB}</b> : <b>nadie (empate absoluto)</b>}.</p>;
              })() : <p className="muted" style={{ margin: ".4rem 0" }}>La pareja que impugnó no propuso ningún resultado.</p>}
            </>
          ) : <p className="muted" style={{ margin: ".4rem 0" }}>La otra pareja puede confirmarlo o impugnarlo; si no responde, se confirma solo en {timeLeft(sub.deadline_at)}.</p>}
          <div className="actions" style={{ marginTop: ".8rem" }}>
            <form action={acceptSubmittedAction}>
              <input type="hidden" name="match" value={id} />
              <SubmitButton className="btn btn-navy btn-sm" confirm="¿Dar por bueno el resultado enviado?">Dar por bueno el enviado</SubmitButton>
            </form>
            {sub.status === "DISPUTED" && sub.dispute_sets && (
              <form action={acceptDisputeVersionAction}>
                <input type="hidden" name="match" value={id} />
                <SubmitButton className="btn btn-navy btn-sm" confirm="¿Dar por buena la versión de la pareja que impugnó?">Dar por buena la de quien impugnó</SubmitButton>
              </form>
            )}
          </div>
        </div>
      )}

      {options.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: ".5rem" }}>Propuestas de fecha ({options.length})</h2>
          <ul className="proposals">
            {options.map((o) => {
              const state = ({ ACTIVE: "Activa", ACCEPTED: "Aceptada", REJECTED: "Rechazada", WITHDRAWN: "Retirada", SUPERSEDED: "Descartada", EXPIRED: "Caducada" } as Record<string, string>)[o.state] ?? o.state;
              return (
                <li key={o.id}>
                  <div className="prop-main"><span>{fmtRange(o.startsAt)}</span><Pill tone={o.state === "ACCEPTED" ? "ok" : o.state === "ACTIVE" ? "info" : undefined}>{state}</Pill></div>
                  <div className="prop-meta">Propone {o.pairId === m.pairA ? nameA : nameB} · {o.origin === "AVAILABILITY" ? "cruce de calendarios" : "a mano"}{o.decidedBy ? ` · decide ${o.decidedBy} (${fmtDateTime(o.decidedAt)})` : ""}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AdminChat matchId={id} messages={(chatRes.data ?? []) as AdminMessage[]} hasMinors={[a, b].some((p) => p?.players.some((x) => x.isMinor))} />

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>{closed || sub ? "Corregir o fijar el resultado" : "Fijar el resultado"}</h2>
        <p className="muted" style={{ margin: "0 0 1rem" }}>Introduce los juegos de cada set. El ganador se calcula solo y el resultado queda como definitivo.</p>
        <form action={setResultAction}>
          <input type="hidden" name="match" value={id} />
          <ScoreInputs left={nameA} right={nameB} initial={m.status === "COMPLETED" ? m.sets : (sub?.sets ?? [])} />
          <label className="check"><input type="checkbox" name="time" defaultChecked={m.endedByTime} /> Terminó por tiempo (90 minutos)</label>
          <div style={{ maxWidth: 380 }}>
            <label htmlFor="winner">Si hay empate absoluto, gana…</label>
            <select id="winner" name="winner" defaultValue="">
              <option value="">(no aplica)</option><option value="A">{nameA}</option><option value="B">{nameB}</option>
            </select>
          </div>
          <div style={{ marginTop: "1rem" }}><SubmitButton>Guardar resultado</SubmitButton></div>
        </form>
      </div>

      {!closed && (
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: ".25rem" }}>Fecha y pista (la fija la organización)</h2>
          <p className="muted" style={{ margin: "0 0 .75rem" }}>Sustituye cualquier negociación en curso entre las parejas.</p>
          <form action={scheduleAction}>
            <input type="hidden" name="match" value={id} />
            <div className="fields">
              <div><label htmlFor="date">Día</label><input id="date" name="date" type="date" defaultValue={when.date} /></div>
              <div><label htmlFor="time">Hora</label><input id="time" name="time" type="time" defaultValue={when.time} /></div>
              <div>
                <label htmlFor="court">Pista</label>
                <select id="court" name="court" defaultValue={m.court ?? ""}>
                  <option value="">Sin pista</option>
                  {optionsFor(m.court, mergeRules(season.rules).courts).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <p className="help">Deja el día vacío para quitar la fecha.</p>
            <SubmitButton className="btn btn-outline btn-sm">Guardar fecha</SubmitButton>
          </form>
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".75rem" }}>Otras resoluciones</h2>
        <div className="stack">
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Registrar un WO</summary>
            <form action={woAction} style={{ marginTop: "1rem" }}>
              <input type="hidden" name="match" value={id} />
              <div className="fields">
                <div className="full">
                  <label htmlFor="resp">Pareja responsable del WO</label>
                  <select id="resp" name="responsible" defaultValue=""><option value="" disabled>Elige…</option><option value="A">{nameA}</option><option value="B">{nameB}</option></select>
                </div>
                <div><label htmlFor="pa">Puntos de {nameA}</label><input id="pa" name="pointsA" type="number" step="1" defaultValue={rules.wo.otherDefault} /></div>
                <div><label htmlFor="pb">Puntos de {nameB}</label><input id="pb" name="pointsB" type="number" step="1" defaultValue={rules.wo.otherDefault} /></div>
                <div className="full"><label htmlFor="why">Motivo</label><textarea id="why" name="reason" required /></div>
              </div>
              <p className="help">Por reglamento, la pareja responsable recibe {rules.wo.responsible} punto y la otra {rules.wo.otherDefault} salvo decisión de la organización. Ajusta los puntos de cada pareja si procede.</p>
              <label className="check"><input type="checkbox" name="incident" /> Cuenta también como incumplimiento (sanción)</label>
              <SubmitButton className="btn btn-outline btn-sm">Registrar WO</SubmitButton>
            </form>
          </details>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Marcar como no disputado (0 puntos para ambas)</summary>
            <form action={notPlayedAction} style={{ marginTop: "1rem", maxWidth: 520 }}>
              <input type="hidden" name="match" value={id} />
              <label htmlFor="why2">Motivo</label><textarea id="why2" name="reason" required />
              <div style={{ marginTop: ".75rem" }}><SubmitButton className="btn btn-outline btn-sm">Marcar como no disputado</SubmitButton></div>
            </form>
          </details>
          {(closed || sub) && (
            <form action={resetAction}>
              <input type="hidden" name="match" value={id} />
              <SubmitButton className="btn btn-danger btn-sm" confirm="El partido vuelve a estar sin resultado y se recalculan clasificación y ranking. ¿Continuar?">Quitar el resultado y restablecer el partido</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
