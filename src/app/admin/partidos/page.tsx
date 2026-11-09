import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { loadBase, loadPairs, loadMatches, matchWhen, pairMap, pairName } from "@/lib/data";
import { CategoryChips, MatchPill, PageHead } from "@/components/ui";

const STATES = [
  ["", "Todos"], ["PENDING_SCHEDULE,SCHEDULE_PROPOSED", "Sin fecha"], ["DATE_AGREED", "Falta pista"], ["RESCHEDULE_REQUESTED", "Cambio de fecha"],
  ["SCHEDULED", "Programados"], ["RESULT_PENDING_CONFIRMATION", "Por confirmar"], ["DISPUTED", "Impugnados"], ["COMPLETED", "Jugados"],
] as const;
const LIMIT = 150;

export default async function Partidos({ searchParams }: { searchParams: Promise<{ fase?: string; cat?: string; estado?: string }> }) {
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
  const href = (o: { fase?: string | null; cat?: string | null; estado?: string | null }) => {
    const q = new URLSearchParams();
    const v = { fase: sp.fase, cat: sp.cat, estado: sp.estado, ...o };
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    const s = q.toString();
    return `/admin/partidos${s ? `?${s}` : ""}`;
  };
  const shown = matches.slice(0, LIMIT);

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

          {matches.length === 0 ? <p className="card empty">No hay partidos con estos filtros.</p> : (
            <>
              <p className="muted">{matches.length} partidos{matches.length > LIMIT ? ` (mostrando los ${LIMIT} primeros: filtra por categoría)` : ""}</p>
              <div className="matches">
                {shown.map((m) => {
                  const a = pm.get(m.pairA), b = pm.get(m.pairB), c = catById.get(m.categoryId);
                  const sa = m.winner === "A", sb2 = m.winner === "B";
                  return (
                    <Link key={m.id} href={`/admin/partidos/${m.id}`} className="match">
                      <div className="meta"><span>{c?.label} · Grupo {m.groupLetter}</span><MatchPill status={m.status} /></div>
                      <div className="teams">
                        <span className={`team${sa ? " win" : ""}`}>{pairName(a)}</span>
                        <span className="sets">{m.sets.map((s) => s.a).join(" ")}</span>
                        <span className={`team${sb2 ? " win" : ""}`}>{pairName(b)}</span>
                        <span className="sets">{m.sets.map((s) => s.b).join(" ")}</span>
                      </div>
                      <div className="when">{matchWhen(m) || "Sin fecha acordada"}</div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
