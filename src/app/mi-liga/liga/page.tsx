import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { getSeasonRow, loadBase, loadPairs, loadGroups, loadMatches, loadRecentResults, categoryStandings, toRecord, pairName } from "@/lib/data";
import { groupStandings } from "@/lib/engine";
import { CategoryChips, CatDot } from "@/components/ui";
import { ResultCard } from "@/components/ResultCard";
import { StandingsTable } from "@/components/StandingsTable";

const VIEWS = [["clasificacion", "Clasificación"], ["grupos", "Grupos y partidos"], ["resultados", "Resultados"]] as const;
const PUBLISHED = ["PUBLISHED", "ACTIVE", "CLOSED", "LOCKED"];

export default async function Liga({ searchParams }: { searchParams: Promise<{ cat?: string; vista?: string; fase?: string }> }) {
  const sp = await searchParams;
  const { sb, pairIds, pairCats } = await requirePlayer("/mi-liga/liga");
  const base = await loadBase(sb);
  if (!base) return null;
  const { season, cats, phases } = base;
  const myCat = pairCats[pairIds[0]];
  const cat = cats.find((c) => c.id === sp.cat) ?? cats.find((c) => c.id === myCat) ?? cats[0];
  const vista = (VIEWS.map((v) => v[0]) as string[]).includes(sp.vista ?? "") ? (sp.vista as string) : "clasificacion";
  const mine = new Set(pairIds);
  const href = (o: { cat?: string | null; vista?: string; fase?: string | null }) => {
    const q = new URLSearchParams({ cat: o.cat ?? cat.id, vista: o.vista ?? vista });
    const f = o.fase === null ? undefined : o.fase ?? sp.fase;
    if (f) q.set("fase", f);
    return `/mi-liga/liga?${q.toString()}`;
  };

  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>La liga</h1>
      <p className="muted" style={{ margin: ".3rem 0 1rem" }}>Clasificaciones, grupos y resultados de todas las categorías.</p>
      <CategoryChips cats={cats} current={cat.id} href={(id) => href({ cat: id, fase: null })} />
      <nav className="chips" aria-label="Vista">
        {VIEWS.map(([v, label]) => <Link key={v} className="chip" href={href({ vista: v })} aria-current={vista === v}>{label}</Link>)}
      </nav>
      <p style={{ display: "flex", alignItems: "center", gap: ".5rem", fontWeight: 800, margin: "0 0 1rem" }}><CatDot code={cat.code} />{cat.label}</p>

      {vista === "clasificacion" && <Clasificacion sbp={{ sb, season, cat, mine }} />}
      {vista === "grupos" && <Grupos sbp={{ sb, season, cat, mine }} phases={phases} faseParam={sp.fase} href={href} />}
      {vista === "resultados" && <Resultados sbp={{ sb, season, cat, mine }} />}
    </>
  );
}

type Ctx = { sb: any; season: any; cat: any; mine: Set<string> };

async function Clasificacion({ sbp: { sb, season, cat, mine } }: { sbp: Ctx }) {
  const { rows, quota, pairs } = await categoryStandings(sb, season, cat.id);
  return (
    <>
      <StandingsTable rows={rows} pairs={pairs} quota={quota} mine={mine} />
      <p className="help">Suma de noviembre, diciembre y enero. PJ: partidos jugados (entre paréntesis, los que faltan). Los resultados pendientes de confirmar no cuentan hasta que se confirman. Tus parejas aparecen resaltadas.{" "}
        {rows.some((r) => mine.has(r.pairId)) && <Link href="/mi-liga/clasificacion"><b>Ver mi situación →</b></Link>}</p>
    </>
  );
}

async function Grupos({ sbp: { sb, season, cat, mine }, phases, faseParam, href }: { sbp: Ctx; phases: any[]; faseParam?: string; href: (o: any) => string }) {
  const published = phases.filter((p) => PUBLISHED.includes(p.status));
  const phase = published.find((p) => String(p.number) === faseParam) ?? published[published.length - 1];
  if (!phase) return <p className="card empty">Todavía no hay grupos publicados.</p>;
  const [groups, matches, pairs] = await Promise.all([
    loadGroups(sb, phase.id), loadMatches(sb, season.id, { phaseId: phase.id, categoryId: cat.id }), loadPairs(sb, season.id, { categoryId: cat.id }),
  ]);
  const pm = new Map(pairs.map((p) => [p.id, p]));
  const catGroups = groups.filter((g) => g.categoryId === cat.id);
  return (
    <>
      <nav className="chips" aria-label="Fase">
        {published.map((p) => <Link key={p.id} className="chip" href={href({ fase: String(p.number) })} aria-current={p.id === phase.id}>{p.name.split("·")[1]?.trim() ?? p.name}</Link>)}
      </nav>
      <div className="stack">
        {catGroups.map((g) => {
          const gm = matches.filter((m) => m.groupId === g.id);
          const rows = groupStandings(g.pairIds, gm.map(toRecord));
          return (
            <section key={g.id} className="card">
              <h2 style={{ fontSize: "1.1rem", marginBottom: ".75rem" }}>Grupo {g.letter}</h2>
              <div className="table-scroll compact" style={{ marginBottom: "1rem" }}>
                <table>
                  <thead><tr><th>#</th><th>Pareja</th><th className="num">Pts</th><th className="num">PJ</th><th className="num">Sets</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.pairId} className={mine.has(r.pairId) ? "mine" : ""}>
                        <td className="pos">{r.position}</td><td className="name">{pairName(pm.get(r.pairId))}</td>
                        <td className="num"><b>{r.points}</b></td><td className="num">{r.played}</td><td className="num">{r.setDiff >= 0 ? "+" : ""}{r.setDiff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="matches">{gm.map((m) => <ResultCard key={m.id} m={m} pairs={pm} mine={mine} showCat={false} />)}</div>
            </section>
          );
        })}
        {catGroups.length === 0 && <p className="card empty">Esta categoría no tiene grupos en esta fase.</p>}
      </div>
    </>
  );
}

async function Resultados({ sbp: { sb, season, cat, mine } }: { sbp: Ctx }) {
  const [list, pairs] = await Promise.all([loadRecentResults(sb, season.id, { categoryId: cat.id, limit: 60 }), loadPairs(sb, season.id, { categoryId: cat.id })]);
  const pm = new Map(pairs.map((p) => [p.id, p]));
  if (list.length === 0) return <p className="card empty">Aún no hay resultados en esta categoría.</p>;
  return <div className="matches">{list.map((m) => <ResultCard key={m.id} m={m} pairs={pm} mine={mine} showCat={false} />)}</div>;
}
