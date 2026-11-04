import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadRanking, type Division } from "@/lib/data";
import { PageHead } from "@/components/ui";

export default async function Ranking({ searchParams }: { searchParams: Promise<{ div?: string; q?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdmin("/admin/ranking");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const cats = await loadCats(sb, season.id);
  const division: Division = sp.div === "FEMENINA" ? "FEMENINA" : "MASCULINA";
  const all = await loadRanking(sb, season, cats, division);
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(sp.q ?? "");
  const rows = all.map((r, i) => ({ ...r, pos: i + 1 })).filter((r) => !q || norm(r.name).includes(q));
  return (
    <>
      <PageHead title="Ranking general" sub="Ranking individual de cada jugador, separado por división. Se recalcula con cada resultado confirmado." />
      <nav className="chips" aria-label="División">
        {(["MASCULINA", "FEMENINA"] as const).map((d) => <Link key={d} className="chip" href={`/admin/ranking?div=${d}`} aria-current={division === d}>{d === "MASCULINA" ? "Masculina" : "Femenina"}</Link>)}
      </nav>
      <form method="get" style={{ maxWidth: 420, marginBottom: "1.25rem" }}>
        <input type="hidden" name="div" value={division} />
        <label htmlFor="q" className="sr-only">Buscar jugador</label>
        <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Buscar jugador" />
      </form>
      <div className="table-scroll">
        <table>
          <thead><tr><th>#</th><th>Jugador</th><th className="num">Puntos</th><th className="num">Ganados</th><th className="num">Perdidos</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.playerId}><td className="pos">{r.pos}</td><td className="name" style={{ fontWeight: 800 }}>{r.name}</td><td className="num"><b>{r.points}</b></td><td className="num">{r.wins}</td><td className="num">{r.losses}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={5} className="empty">Sin jugadores.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
