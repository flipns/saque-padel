import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { groupSizes } from "@/lib/engine";
import s from "./admin.module.css";

export default async function AdminHome() {
  const { sb } = await requireAdmin();
  const { data: season } = await sb.from("seasons").select("id, name").eq("is_current", true).maybeSingle();
  if (!season) return <p>No hay temporada activa. Ejecuta supabase/seed.sql.</p>;

  const [{ data: cats }, { data: pairs }, { count: pendingRegs }] = await Promise.all([
    sb.from("categories").select("id, name, level_order, divisions!inner(code, name, season_id)").eq("divisions.season_id", season.id),
    sb.from("pairs").select("id, category_id").eq("season_id", season.id).eq("status", "ACTIVE"),
    sb.from("registrations").select("*", { count: "exact", head: true }).eq("season_id", season.id).eq("status", "PENDING"),
  ]);
  const count = (id: string) => (pairs ?? []).filter((p) => p.category_id === id).length;
  const sorted = (cats ?? []).sort((a: any, b: any) =>
    a.divisions.code === b.divisions.code ? a.level_order - b.level_order : a.divisions.code === "MASCULINA" ? -1 : 1);

  return (
    <>
      <h1>{season.name}</h1>
      <p className="muted">
        {pairs?.length ?? 0} parejas activas y {pendingRegs ?? 0} inscripciones pendientes de revisar.{" "}
        <Link href="/admin/importar">Importar respuestas del Form</Link>
      </p>
      <div className={s.grid}>
        {sorted.map((c: any) => {
          const n = count(c.id);
          const g = groupSizes(n);
          return (
            <div key={c.id} className={s.stat}>
              <span>{c.name} {c.divisions.name.toLowerCase()}</span>
              <b>{n}</b>
              <small>
                {n === 0 ? "Sin parejas" : g.warning ?? `${g.sizes.filter((x) => x === 4).length} grupos de 4` +
                  (g.sizes.some((x) => x === 3) ? ` y ${g.sizes.filter((x) => x === 3).length} de 3` : "")}
              </small>
            </div>
          );
        })}
      </div>
    </>
  );
}
