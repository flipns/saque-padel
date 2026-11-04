import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, pairName } from "@/lib/data";
import { CategoryChips, Flash, PageHead, Pill } from "@/components/ui";

export default async function Parejas({ searchParams }: { searchParams: Promise<{ cat?: string; q?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdmin("/admin/parejas");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const [cats, all] = await Promise.all([loadCats(sb, season.id), loadPairs(sb, season.id, { contacts: true, emails: true })]);
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(sp.q ?? "");
  const pairs = all
    .filter((p) => !sp.cat || p.categoryId === sp.cat)
    .filter((p) => !q || norm(pairName(p)).includes(q) || p.emails.some((e) => e.includes(q)) || p.players.some((x) => (x.phone ?? "").includes(q)))
    .sort((a, b) => pairName(a).localeCompare(pairName(b), "es"));
  const catById = new Map(cats.map((c) => [c.id, c]));

  return (
    <>
      <PageHead title="Parejas" sub="Todas las parejas inscritas. Abre una para corregir datos, cambiarla de categoría o darla de baja.">
        <Link className="btn btn-navy btn-sm" href="/admin/parejas/nueva">Añadir pareja</Link>
        <Link className="btn btn-outline btn-sm" href="/admin/importar">Importar CSV</Link>
      </PageHead>
      <Flash ok={sp.ok} err={sp.err} />
      <CategoryChips cats={cats} current={sp.cat} all="Todas" href={(id) => `/admin/parejas${id ? `?cat=${id}` : ""}`} />
      <form method="get" style={{ maxWidth: 420, marginBottom: "1.25rem" }}>
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        <label htmlFor="q" className="sr-only">Buscar</label>
        <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Buscar por nombre, email o móvil" />
      </form>
      <p className="muted">{pairs.length} parejas</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Pareja</th><th>Categoría</th><th>Móviles</th><th>Acceso (email)</th><th>Estado</th></tr></thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.id}>
                <td className="name"><Link href={`/admin/parejas/${p.id}`} style={{ fontWeight: 800 }}>{pairName(p)}</Link>{p.players.some((x) => x.isMinor) && <> <Pill tone="info">menor</Pill></>}</td>
                <td>{catById.get(p.categoryId)?.label}</td>
                <td>{p.players.map((x) => x.phone ?? "—").join(" · ")}</td>
                <td>{p.emails.join(", ") || <Pill tone="bad">sin acceso</Pill>}</td>
                <td>{p.status === "ACTIVE" ? <Pill tone="ok">Activa</Pill> : <Pill tone="muted">Baja</Pill>}</td>
              </tr>
            ))}
            {pairs.length === 0 && <tr><td colSpan={5} className="empty">No hay parejas con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
