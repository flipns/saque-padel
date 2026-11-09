import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { loadBase, loadPairs, loadMatches, matchWhen, pairMap, pairName } from "@/lib/data";
import { CategoryChips, MatchPill, PageHead } from "@/components/ui";
import { dayLabel, groupByDay, isUpcoming, type ShareMatch } from "@/lib/share";
import { isoToMadridParts } from "@/lib/dates";
import { ShareUpcoming } from "./ShareUpcoming";

const STATES = [
  ["", "Todos"], ["PENDING_SCHEDULE,SCHEDULE_PROPOSED", "Sin fecha"], ["DATE_AGREED", "Falta pista"], ["RESCHEDULE_REQUESTED", "Cambio de fecha"],
  ["SCHEDULED", "Programados"], ["RESULT_PENDING_CONFIRMATION", "Por confirmar"], ["DISPUTED", "Impugnados"], ["COMPLETED", "Jugados"],
] as const;
const LIMIT = 150;

export default async function Partidos({ searchParams }: { searchParams: Promise<{ fase?: string; cat?: string; estado?: string; ver?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdmin("/admin/partidos");
  const base = await loadBase(sb);
  if (!base) return null;
  const { season, cats, phases } = base;
  const published = phases.filter((p) => ["PUBLISHED", "ACTIVE", "CLOSED", "LOCKED"].includes(p.status));
  const phase = published.find((p) => String(p.number) === sp.fase);
  // Parejas y partidos a la vez (antes uno detrás de otro).
  const [pairs, matches] = await Promise.all([
    loadPairs(sb, season.id),
    loadMatches(sb, season.id, { phaseId: phase?.id, categoryId: sp.cat || undefined, statuses: sp.estado ? sp.estado.split(",") : undefined }),
  ]);
  const pm = pairMap(pairs);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const href = (o: { fase?: string | null; cat?: string | null; estado?: string | null; ver?: string | null }) => {
    const q = new URLSearchParams();
    const v = { fase: sp.fase, cat: sp.cat, estado: sp.estado, ver: sp.ver, ...o };
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    const s = q.toString();
    return `/admin/partidos${s ? `?${s}` : ""}`;
  };
  // «Programados»: agenda por fecha, de la más cercana a la más lejana. Lo ya pasado (sin resultado) va en otra vista.
  const agenda = sp.estado === "SCHEDULED";
  const nowD = new Date();
  const dated = agenda ? matches.filter((m) => m.scheduledAt).sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!)) : [];
  const upcoming = dated.filter((m) => isUpcoming(m.scheduledAt!, nowD));
  const past = dated.filter((m) => !isUpcoming(m.scheduledAt!, nowD));
  const view = sp.ver === "pasados" ? "pasados" : "proximos";
  const listed = agenda ? (view === "pasados" ? past : upcoming) : matches;
  const shown = listed.slice(0, agenda ? 400 : LIMIT);
  const shareList: ShareMatch[] = upcoming.map((m) => ({ startsAt: m.scheduledAt!, court: m.court, category: catById.get(m.categoryId)?.label ?? "", a: pairName(pm.get(m.pairA)), b: pairName(pm.get(m.pairB)) }));
  const scope = `${sp.cat ? catById.get(sp.cat)?.label ?? "la categoría elegida" : "todas las categorías"}${phase ? ` · ${phase.name.split("·")[1]?.trim() ?? "una fase"}` : " · todas las fases"}`;
  const courtText = (c: string) => { const t = c.trim(); const u = t.charAt(0).toUpperCase() + t.slice(1); return /^pista/i.test(t) ? u : `Pista ${t}`; };
  const card = (m: (typeof matches)[number], withSets: boolean) => {
    const a = pm.get(m.pairA), b = pm.get(m.pairB), c = catById.get(m.categoryId);
    const sa = m.winner === "A", sb2 = m.winner === "B";
    return (
      <Link key={m.id} href={`/admin/partidos/${m.id}`} className="match">
        <div className="meta"><span>{agenda && m.scheduledAt && <b className="agenda-time">{isoToMadridParts(m.scheduledAt).time}</b>}{agenda && " · "}{c?.label} · Grupo {m.groupLetter}</span><MatchPill status={m.status} /></div>
        <div className="teams">
          <span className={`team${sa ? " win" : ""}`}>{pairName(a)}</span>
          {withSets && <span className="sets">{m.sets.map((s) => s.a).join(" ")}</span>}
          <span className={`team${sb2 ? " win" : ""}`}>{pairName(b)}</span>
          {withSets && <span className="sets">{m.sets.map((s) => s.b).join(" ")}</span>}
        </div>
        <div className="when">{agenda ? (m.court ? courtText(m.court) : "Sin pista") : (matchWhen(m) || "Sin fecha acordada")}</div>
      </Link>
    );
  };

  return (
    <>
      <PageHead title="Partidos" sub="Abre un partido para fijar el resultado, resolver una impugnación, registrar un WO o cambiar la fecha." />
      {published.length === 0 ? (
        <div className="card empty">Todavía no hay ninguna fase publicada. <Link href="/admin/fases"><b>Genera y publica los grupos</b></Link> para crear los partidos.</div>
      ) : (
        <>
          <nav className="chips" aria-label="Fase">
            <Link className="chip" href={href({ fase: null })} aria-current={!phase}>Todas las fases</Link>
            {published.map((p) => <Link key={p.id} className="chip" href={href({ fase: String(p.number) })} aria-current={phase?.id === p.id}>{p.name.split("·")[1]?.trim()}</Link>)}
          </nav>
          <CategoryChips cats={cats} current={sp.cat} all="Todas las categorías" href={(id) => href({ cat: id })} />
          <nav className="chips" aria-label="Estado">
            {STATES.map(([v, label]) => <Link key={v} className="chip" href={href({ estado: v || null })} aria-current={(sp.estado ?? "") === v}>{label}</Link>)}
          </nav>

          {agenda && (
            <>
              <nav className="chips" aria-label="Qué programados ver">
                <Link className="chip" href={href({ ver: null })} aria-current={view === "proximos"}>Próximos ({upcoming.length})</Link>
                <Link className="chip" href={href({ ver: "pasados" })} aria-current={view === "pasados"}>Ya pasados, sin resultado ({past.length})</Link>
              </nav>
              {view === "proximos" && <ShareUpcoming matches={shareList} nowIso={nowD.toISOString()} scope={scope} />}
            </>
          )}

          {listed.length === 0 ? (
            <p className="card empty">{agenda ? (view === "pasados" ? "No hay ningún partido pasado pendiente de resultado." : "No hay partidos programados por jugar con estos filtros.") : "No hay partidos con estos filtros."}</p>
          ) : agenda ? (
            <>
              <p className="muted">{listed.length} {view === "pasados" ? "partidos ya pasados sin resultado" : listed.length === 1 ? "partido por jugar" : "partidos por jugar"}, por fecha{view === "pasados" ? "" : " (el más cercano primero)"}.</p>
              {groupByDay(shown.map((m) => ({ startsAt: m.scheduledAt!, m }))).map((g) => (
                <section key={g.date} aria-label={dayLabel(g.date)}>
                  <h2 className="dayhead">{dayLabel(g.date)}</h2>
                  <div className="matches">{g.items.map((x) => card(x.m, false))}</div>
                </section>
              ))}
            </>
          ) : (
            <>
              <p className="muted">{matches.length} partidos{matches.length > LIMIT ? ` (mostrando los ${LIMIT} primeros: filtra por categoría)` : ""}</p>
              <div className="matches">{shown.map((m) => card(m, true))}</div>
            </>
          )}
        </>
      )}
    </>
  );
}
