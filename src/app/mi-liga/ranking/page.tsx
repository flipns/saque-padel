import { requirePlayer } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadRanking } from "@/lib/data";

export default async function RankingJugador({ searchParams }: { searchParams: Promise<{ p?: string; q?: string }> }) {
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer("/mi-liga/ranking");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  if (pairIds.length === 0) return <p className="card empty">Tu email no tiene pareja inscrita.</p>;
  const pid = pairIds.includes(sp.p ?? "") ? (sp.p as string) : pairIds[0];
  const [cats, mine] = await Promise.all([loadCats(sb, season.id), loadPairs(sb, season.id, { ids: [pid] })]);
  const cat = cats.find((c) => c.id === mine[0].categoryId)!;
  const all = (await loadRanking(sb, season, cats, cat.division)).map((r, i) => ({ ...r, pos: i + 1 }));
  const mineIds = new Set(mine[0].players.map((p) => p.id));
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(sp.q ?? "");
  const rows = all.filter((r) => !q || norm(r.name).includes(q));
  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>Ranking general</h1>
      <p className="muted" style={{ margin: ".3rem 0 1rem" }}>Ranking individual {cat.division === "FEMENINA" ? "femenino" : "masculino"}. Sube y baja con cada partido confirmado y se mantiene toda la temporada.</p>
      <form method="get" style={{ maxWidth: 380, marginBottom: "1rem" }}>
        <input type="hidden" name="p" value={pid} />
        <label htmlFor="q" className="sr-only">Buscar jugador</label>
        <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Buscar jugador" />
      </form>
      <div className="table-scroll">
        <table>
          <thead><tr><th>#</th><th>Jugador</th><th className="num">Puntos</th><th className="num">G</th><th className="num">P</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} className={mineIds.has(r.playerId) ? "mine" : ""}>
                <td className="pos">{r.pos}</td><td className="name">{r.name}</td><td className="num"><b>{r.points}</b></td><td className="num">{r.wins}</td><td className="num">{r.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
