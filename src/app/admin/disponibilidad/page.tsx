import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, pairName } from "@/lib/data";
import { CategoryChips, PageHead, Pill } from "@/components/ui";

export default async function DisponibilidadAdmin({ searchParams }: { searchParams: Promise<{ cat?: string; falta?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdmin("/admin/disponibilidad");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const [cats, all, rulesRes] = await Promise.all([loadCats(sb, season.id), loadPairs(sb, season.id), sb.from("availability_rules").select("player_id").limit(5000)]);
  const slots = new Map<string, number>();
  for (const r of (rulesRes.data ?? []) as { player_id: string }[]) slots.set(r.player_id, (slots.get(r.player_id) ?? 0) + 1);
  const pairs = all.filter((p) => p.status === "ACTIVE" && (!sp.cat || p.categoryId === sp.cat));
  const players = pairs.flatMap((p) => p.players);
  const done = players.filter((pl) => slots.has(pl.id)).length;
  const catById = new Map(cats.map((c) => [c.id, c]));
  const onlyMissing = sp.falta === "1";
  const rows = pairs.filter((p) => !onlyMissing || p.players.some((pl) => !slots.has(pl.id))).sort((a, b) => pairName(a).localeCompare(pairName(b), "es"));
  const href = (cat: string | null) => `/admin/disponibilidad?${new URLSearchParams({ ...(cat ? { cat } : {}), ...(onlyMissing ? { falta: "1" } : {}) }).toString()}`;

  return (
    <>
      <PageHead title="Disponibilidad" sub="Qué jugadores han rellenado su calendario semanal. Sin él, el sistema no puede sugerir horarios a su partido." />
      <div className="stats">
        <div className="stat"><b>{done}/{players.length}</b><span>Jugadores con disponibilidad</span></div>
        <div className="stat"><b>{players.length ? Math.round((done / players.length) * 100) : 0} %</b><span>Han informado</span></div>
      </div>
      <CategoryChips cats={cats} current={sp.cat} all="Todas" href={href} />
      <nav className="chips" aria-label="Filtro">
        <Link className="chip" href={`/admin/disponibilidad${sp.cat ? `?cat=${sp.cat}` : ""}`} aria-current={!onlyMissing}>Todas las parejas</Link>
        <Link className="chip" href={`/admin/disponibilidad?${new URLSearchParams({ ...(sp.cat ? { cat: sp.cat } : {}), falta: "1" }).toString()}`} aria-current={onlyMissing}>Con jugadores sin informar</Link>
      </nav>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Pareja</th><th>Categoría</th><th>Jugador 1</th><th>Jugador 2</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="name"><Link href={`/admin/parejas/${p.id}`} style={{ fontWeight: 800 }}>{pairName(p)}</Link></td>
                <td>{catById.get(p.categoryId)?.label}</td>
                {[0, 1].map((i) => { const pl = p.players[i]; return <td key={i}>{pl ? <>{pl.name}<br />{slots.has(pl.id) ? <Pill tone="ok">{slots.get(pl.id)} franjas</Pill> : <Pill tone="warn">Sin informar</Pill>}</> : "—"}</td>; })}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="empty">{onlyMissing ? "Todas las parejas de esta selección han informado." : "No hay parejas."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
