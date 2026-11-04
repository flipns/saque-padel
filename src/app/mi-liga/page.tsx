import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadMatches, loadOpenSubmissions, loadGroups, loadPhases, categoryStandings, pairMap, pairName } from "@/lib/data";
import { CatDot, Flash, MatchPill } from "@/components/ui";
import { fmtDate, fmtDateTime, timeLeft } from "@/lib/dates";
import s from "./liga.module.css";

export default async function MiLiga({ searchParams }: { searchParams: Promise<{ p?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { sb, isAdmin, pairIds } = await requirePlayer();
  if (pairIds.length === 0) {
    return (
      <div className="card empty">
        <h1 style={{ fontSize: "1.3rem", marginBottom: ".5rem" }}>Tu email no tiene ninguna pareja inscrita</h1>
        <p>Si te inscribiste con otro email, entra con ese. Si crees que es un error, avisa a la organización de la liga.</p>
        {isAdmin && <p><Link href="/admin"><b>Ir al panel de administración</b></Link></p>}
      </div>
    );
  }
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const pid = pairIds.includes(sp.p ?? "") ? (sp.p as string) : pairIds[0];
  const [cats, mine, phases] = await Promise.all([loadCats(sb, season.id), loadPairs(sb, season.id, { ids: pairIds }), loadPhases(sb, season.id)]);
  const me = mine.find((p) => p.id === pid)!;
  const cat = cats.find((c) => c.id === me.categoryId)!;
  const published = phases.filter((p) => ["PUBLISHED", "ACTIVE", "CLOSED", "LOCKED"].includes(p.status));
  const current = published[published.length - 1];
  const [catPairs, matches, standing, groups] = await Promise.all([
    loadPairs(sb, season.id, { categoryId: me.categoryId }), loadMatches(sb, season.id, { pairIds: [pid] }), categoryStandings(sb, season, me.categoryId),
    current ? loadGroups(sb, current.id) : Promise.resolve([]),
  ]);
  const pm = pairMap(catPairs);
  const subs = await loadOpenSubmissions(sb, matches.map((m) => m.id));
  const myRow = standing.rows.find((r) => r.pairId === pid);
  const toConfirm = matches.filter((m) => m.status === "RESULT_PENDING_CONFIRMATION" && subs.get(m.id) && subs.get(m.id).submitted_by_pair !== pid);
  const byPhase = [...new Set(matches.map((m) => m.phaseNumber))].sort((a, b) => b - a);
  const groupInfo = groups.find((g) => g.pairIds.includes(pid));

  return (
    <>
      <Flash ok={sp.ok} err={sp.err} />
      {pairIds.length > 1 && (
        <nav className="chips" aria-label="Tus parejas">
          {mine.map((p) => <Link key={p.id} className="chip" href={`/mi-liga?p=${p.id}`} aria-current={p.id === pid}>{pairName(p)}</Link>)}
        </nav>
      )}
      <section className={s.hero} aria-label="Tu pareja">
        <small style={{ display: "flex", alignItems: "center", gap: ".5rem" }}><CatDot code={cat.code} /> {cat.label}</small>
        <h1>{pairName(me)}</h1>
        {myRow && matches.length > 0 ? (
          <div className={s.big}>
            <div><b>{myRow.position}.º</b><span>de {standing.rows.length} en la clasificación</span></div>
            <div><b>{myRow.points}</b><span>puntos</span></div>
            <div><b>{myRow.played}</b><span>partidos jugados</span></div>
          </div>
        ) : (
          <p style={{ color: "var(--blue-soft)", margin: 0 }}>Tu inscripción está confirmada.</p>
        )}
        {matches.length > 0 && <p style={{ margin: ".9rem 0 0" }}><Link href={`/mi-liga/clasificacion?p=${pid}`}>Ver la clasificación completa →</Link></p>}
      </section>

      {toConfirm.length > 0 && (
        <div className={s.alert} role="status">
          <span><b>{toConfirm.length === 1 ? "Un resultado espera" : `${toConfirm.length} resultados esperan`} vuestra confirmación.</b> Quedan {timeLeft(subs.get(toConfirm[0].id).deadline_at)}.</span>
          <Link href={`/mi-liga/partido/${toConfirm[0].id}`}>Revisar</Link>
        </div>
      )}

      {matches.length === 0 ? (
        <div className="card empty">
          <h2 style={{ fontSize: "1.2rem", marginBottom: ".4rem" }}>Todavía no hay grupos publicados</h2>
          <p style={{ margin: 0 }}>La liga empieza el {fmtDate(season.season_starts_at, { weekday: "long", day: "numeric", month: "long" })}. Cuando la organización publique los grupos, aquí verás tu grupo y tus partidos.</p>
        </div>
      ) : (
        <>
          {groupInfo && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.1rem" }}>Tu grupo este mes: {groupInfo.letter}</h2>
              <p className="muted" style={{ margin: ".3rem 0 .6rem" }}>{current.name}. Los grupos de la nivelación no tienen nivel: se reorganizan cada mes.</p>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {groupInfo.pairIds.map((id) => <li key={id} style={{ fontWeight: id === pid ? 800 : 400 }}>{pairName(pm.get(id))}{id === pid ? " (vosotros)" : ""}</li>)}
              </ul>
            </div>
          )}
          {byPhase.map((n) => (
            <section key={n} style={{ marginBottom: "1.5rem" }}>
              <h2 className="section-title" style={{ marginTop: 0 }}>{phases.find((p) => p.number === n)?.name ?? `Fase ${n}`}</h2>
              <div className="matches">
                {matches.filter((m) => m.phaseNumber === n).map((m) => {
                  const side = m.pairA === pid ? "A" : "B";
                  const rival = pm.get(side === "A" ? m.pairB : m.pairA);
                  const my = m.sets.map((x) => (side === "A" ? x.a : x.b)), their = m.sets.map((x) => (side === "A" ? x.b : x.a));
                  return (
                    <Link key={m.id} href={`/mi-liga/partido/${m.id}`} className="match">
                      <div className="meta"><span>Grupo {m.groupLetter}</span><MatchPill status={m.status} /></div>
                      <div className="teams">
                        <span className={`team${m.winner === side ? " win" : ""}`}>Vosotros</span><span className="sets">{my.join(" ")}</span>
                        <span className={`team${m.winner && m.winner !== side ? " win" : ""}`}>{pairName(rival)}</span><span className="sets">{their.join(" ")}</span>
                      </div>
                      <div className="when">{m.scheduledAt ? `${fmtDateTime(m.scheduledAt)}${m.court ? ` · ${m.court}` : ""}` : "Sin fecha: acordadla con vuestros rivales"}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}
