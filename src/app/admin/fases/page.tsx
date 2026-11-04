import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadPhases, loadMatches } from "@/lib/data";
import { PageHead, PhasePill, Progress } from "@/components/ui";
import { fmtDate } from "@/lib/dates";

export default async function Fases() {
  const { sb } = await requireAdmin("/admin/fases");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const [phases, matches] = await Promise.all([loadPhases(sb, season.id), loadMatches(sb, season.id)]);
  return (
    <>
      <PageHead title="Grupos y fases" sub="Cada fase es un mes. En la nivelación los grupos no tienen jerarquía; desde febrero (Race) sí." />
      <div className="cards">
        {phases.map((p) => {
          const pm = matches.filter((m) => m.phaseId === p.id);
          const done = pm.filter((m) => ["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status)).length;
          return (
            <Link key={p.id} href={`/admin/fases/${p.number}`} className="card" style={{ textDecoration: "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", alignItems: "center" }}>
                <span className="muted" style={{ fontWeight: 800, fontSize: "var(--step--1)" }}>{p.kind === "LEVELING" ? "NIVELACIÓN" : "RACE"}</span>
                <PhasePill status={p.status} />
              </div>
              <h3 style={{ margin: ".4rem 0" }}>{p.name.split("·")[1]?.trim() ?? p.name}</h3>
              <p className="muted" style={{ margin: 0, fontSize: "var(--step--1)" }}>Hasta el {fmtDate(p.results_deadline)} para cerrar resultados</p>
              {pm.length > 0 && (<><Progress value={done} max={pm.length} /><p className="muted" style={{ fontSize: ".8rem", margin: ".3rem 0 0" }}>{done} de {pm.length} partidos cerrados</p></>)}
            </Link>
          );
        })}
      </div>
    </>
  );
}
