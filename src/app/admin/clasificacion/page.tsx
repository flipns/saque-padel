import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, categoryStandings, pairName } from "@/lib/data";
import { zoneFor } from "@/lib/engine";
import { CategoryChips, Flash, PageHead, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveQuotaAction } from "./actions";

const TB: Record<string, string> = { SETS: "por sets", GAMES: "por juegos", H2H: "por directo", MANUAL: "decide la organización" };

export default async function Clasificacion({ searchParams }: { searchParams: Promise<{ cat?: string; prov?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdmin("/admin/clasificacion");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const cats = await loadCats(sb, season.id);
  const cat = cats.find((c) => c.id === sp.cat) ?? cats[0];
  const prov = sp.prov === "1";
  const { rows, quota, pairs } = await categoryStandings(sb, season, cat.id, { provisional: prov });
  const total = rows.length;

  return (
    <>
      <PageHead title="Clasificación de nivelación" sub="Suma los puntos de noviembre, diciembre y enero de cada pareja, sin importar el grupo de cada mes.">
        <Link className="btn btn-outline btn-sm" href={`/admin/clasificacion?cat=${cat.id}${prov ? "" : "&prov=1"}`}>{prov ? "Ver solo resultados oficiales" : "Incluir por confirmar"}</Link>
      </PageHead>
      <Flash ok={sp.ok} err={sp.err} />
      <CategoryChips cats={cats} current={cat.id} href={(id) => `/admin/clasificacion?cat=${id}${prov ? "&prov=1" : ""}`} />
      {prov && <p className="hint" style={{ marginBottom: "1rem" }}>Vista provisional: incluye resultados que aún no ha confirmado la otra pareja.</p>}

      <div className="table-scroll">
        <table>
          <thead><tr><th>#</th><th>Pareja</th><th className="num">Pts</th><th className="num">PJ</th><th className="num">Pend.</th><th className="num">G</th><th className="num">P</th><th className="num">Sets</th><th className="num">Juegos</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const z = zoneFor(r.position, total, quota);
              const cut = quota && (r.position === quota.up || r.position === total - quota.down);
              return (
                <tr key={r.pairId} className={`${z === "UP" ? "zone-up" : z === "DOWN" ? "zone-down" : ""}${cut ? " cut" : ""}`}>
                  <td className="pos">{r.position}</td>
                  <td className="name"><Link href={`/admin/parejas/${r.pairId}`} style={{ fontWeight: 800 }}>{pairName(pairs.get(r.pairId))}</Link></td>
                  <td className="num"><b>{r.points}</b></td><td className="num">{r.played}</td><td className="num">{r.pending}</td>
                  <td className="num">{r.won}</td><td className="num">{r.lost}</td>
                  <td className="num">{r.setsFor}-{r.setsAgainst} ({r.setDiff >= 0 ? "+" : ""}{r.setDiff})</td>
                  <td className="num">{r.gamesFor}-{r.gamesAgainst} ({r.gameDiff >= 0 ? "+" : ""}{r.gameDiff})</td>
                  <td>{z === "UP" && <Pill tone="ok">Asciende</Pill>}{z === "DOWN" && <Pill tone="bad">Desciende</Pill>}{r.tiebreak && r.played > 0 && <> <Pill tone={r.tiebreak === "MANUAL" ? "warn" : "muted"}>{TB[r.tiebreak]}</Pill></>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={10} className="empty">Esta categoría no tiene parejas activas.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Cupos de ascenso y descenso · {cat.label}</h2>
        <p className="muted" style={{ margin: ".3rem 0 1rem" }}>Cuántas parejas suben y bajan al cerrar enero. Mientras no pongas cupos, la tabla no muestra zonas.</p>
        <form action={saveQuotaAction}>
          <input type="hidden" name="cat" value={cat.id} />
          <div className="fields" style={{ maxWidth: 640 }}>
            <div><label htmlFor="up">Suben</label><input id="up" name="up" type="number" min={0} defaultValue={quota?.up ?? 0} /></div>
            <div><label htmlFor="down">Bajan</label><input id="down" name="down" type="number" min={0} defaultValue={quota?.down ?? 0} /></div>
            <div><label htmlFor="status">Estado</label><select id="status" name="status" defaultValue={quota?.status ?? "PLANNED"}><option value="PLANNED">Previstos</option><option value="CONFIRMED">Confirmados</option></select></div>
          </div>
          <div style={{ marginTop: "1rem" }}><SubmitButton>Guardar cupos</SubmitButton></div>
        </form>
      </div>
    </>
  );
}
