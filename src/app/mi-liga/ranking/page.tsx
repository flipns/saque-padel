import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { loadBase, loadPairs, loadRanking, type Division } from "@/lib/data";

export default async function RankingJugador({ searchParams }: { searchParams: Promise<{ div?: string; q?: string }> }) {
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer("/mi-liga/ranking");
  const base = await loadBase(sb);
  if (!base) return null;
  const { season, cats } = base;
  const mine = pairIds.length ? await loadPairs(sb, season.id, { ids: pairIds }) : [];
  const myDivision = cats.find((c) => c.id === mine[0]?.categoryId)?.division ?? "MASCULINA";
  const division: Division = sp.div === "FEMENINA" || sp.div === "MASCULINA" ? sp.div : myDivision;
  const all = (await loadRanking(sb, season, cats, division)).map((r, i) => ({ ...r, pos: i + 1 }));
  const mineIds = new Set(mine.flatMap((p) => p.players.map((x) => x.id)));
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(sp.q ?? "");
  const rows = all.filter((r) => !q || norm(r.name).includes(q));
  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>Ranking general</h1>
      <p className="muted" style={{ margin: ".3rem 0 1rem" }}>Ranking individual. Sube y baja con cada partido confirmado y se mantiene toda la temporada.</p>
      <nav className="chips" aria-label="División">
        {(["MASCULINA", "FEMENINA"] as const).map((d) => <Link key={d} className="chip" href={`/mi-liga/ranking?div=${d}`} aria-current={division === d}>{d === "MASCULINA" ? "Masculino" : "Femenino"}</Link>)}
      </nav>
      <form method="get" style={{ maxWidth: 380, marginBottom: "1rem" }}>
        <input type="hidden" name="div" value={division} />
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
