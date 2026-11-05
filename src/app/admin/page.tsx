import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadPhases, loadMatches, groupsText } from "@/lib/data";
import { CatDot, PageHead, Progress, Flash } from "@/components/ui";
import { fmtDate } from "@/lib/dates";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const { sb } = await requireAdmin();
  const season = await getSeasonRow(sb);
  if (!season) return <p className="card">No hay temporada activa. Ejecuta supabase/seed.sql.</p>;

  const [cats, pairs, phases, matches] = await Promise.all([
    loadCats(sb, season.id), loadPairs(sb, season.id), loadPhases(sb, season.id), loadMatches(sb, season.id),
  ]);
  const active = pairs.filter((p) => p.status === "ACTIVE");
  const current = phases.find((p) => ["DRAFT", "GENERATED", "PUBLISHED", "ACTIVE"].includes(p.status));
  const live = matches.filter((m) => m.phaseId === current?.id);
  const done = live.filter((m) => ["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status)).length;
  const disputed = matches.filter((m) => m.status === "DISPUTED").length;
  const toConfirm = matches.filter((m) => m.status === "RESULT_PENDING_CONFIRMATION").length;
  const noDate = live.filter((m) => m.status === "PENDING_SCHEDULE" || m.status === "SCHEDULE_PROPOSED").length;
  const needsCourt = live.filter((m) => m.status === "DATE_AGREED").length;

  let step: { kicker: string; title: string; text: string; href: string; cta: string };
  if (active.length === 0) step = { kicker: "Siguiente paso", title: "Importa las inscripciones", text: "Sube el CSV de respuestas del Google Form para crear las parejas.", href: "/admin/importar", cta: "Importar inscripciones" };
  else if (!current) step = { kicker: "Temporada", title: "No quedan fases abiertas", text: "Todas las fases están cerradas.", href: "/admin/fases", cta: "Ver fases" };
  else if (current.status === "DRAFT") step = { kicker: "Siguiente paso", title: `Genera los grupos de ${current.name.split("·")[1]?.trim().toLowerCase() ?? current.name}`, text: "El sistema reparte las parejas de cada categoría en grupos de 4 (y de 3 para cuadrar). Podrás revisarlos y moverlos antes de publicar.", href: `/admin/fases/${current.number}`, cta: "Generar grupos" };
  else if (current.status === "GENERATED") step = { kicker: "Siguiente paso", title: "Revisa y publica los grupos", text: "Cuando publiques, los jugadores verán su grupo y sus partidos.", href: `/admin/fases/${current.number}`, cta: "Revisar y publicar" };
  else if (disputed > 0) step = { kicker: "Requiere tu atención", title: `${disputed} ${disputed === 1 ? "resultado impugnado" : "resultados impugnados"}`, text: "Decide el resultado definitivo de cada uno.", href: "/admin/partidos?estado=DISPUTED", cta: "Resolver" };
  else step = { kicker: current.name, title: "La fase está en marcha", text: `${done} de ${live.length} partidos cerrados. La fase acepta resultados hasta el ${fmtDate(current.results_deadline)}.`, href: "/admin/partidos", cta: "Ver partidos" };

  return (
    <>
      <PageHead title={season.name} sub={`${active.length} parejas inscritas en ${cats.length} categorías.`}>
        <Link className="btn btn-outline btn-sm" href="/admin/importar">Importar inscripciones</Link>
        <Link className="btn btn-outline btn-sm" href="/admin/parejas/nueva">Añadir pareja</Link>
      </PageHead>
      <Flash ok={ok} err={err} />

      <section className="next-step" aria-label="Siguiente paso">
        <div><small>{step.kicker}</small><h2>{step.title}</h2><p>{step.text}</p></div>
        <Link className="btn btn-mint" href={step.href}>{step.cta}</Link>
      </section>

      <div className="stats">
        <div className="stat"><b>{active.length}</b><span>Parejas activas</span></div>
        <Link className="stat" href="/admin/partidos"><b>{done}/{live.length}</b><span>Partidos cerrados{current ? ` · ${current.name.split("·")[0].trim()}` : ""}</span></Link>
        <Link className={`stat${toConfirm ? "" : ""}`} href="/admin/partidos?estado=RESULT_PENDING_CONFIRMATION"><b>{toConfirm}</b><span>Por confirmar (48 h)</span></Link>
        <Link className={`stat${disputed ? " alert" : ""}`} href="/admin/partidos?estado=DISPUTED"><b>{disputed}</b><span>Impugnados</span></Link>
        <Link className="stat" href="/admin/partidos?estado=PENDING_SCHEDULE,SCHEDULE_PROPOSED"><b>{noDate}</b><span>Sin fecha acordada</span></Link>
        <Link className="stat" href="/admin/partidos?estado=DATE_AGREED"><b>{needsCourt}</b><span>Fecha acordada, falta pista</span></Link>
      </div>

      <h2 className="section-title">Categorías</h2>
      <div className="cards">
        {cats.map((c) => {
          const n = active.filter((p) => p.categoryId === c.id).length;
          const cm = live.filter((m) => m.categoryId === c.id);
          const cd = cm.filter((m) => ["COMPLETED", "WO", "NOT_PLAYED"].includes(m.status)).length;
          return (
            <div className="card" key={c.id}>
              <h3 style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: "1.05rem" }}><CatDot code={c.code} />{c.label}</h3>
              <p style={{ fontSize: "var(--step-2)", fontWeight: 900, margin: ".4rem 0 0", lineHeight: 1 }}>{n}</p>
              <p className="muted" style={{ margin: ".2rem 0 .8rem", fontSize: "var(--step--1)" }}>parejas · {groupsText(n)}</p>
              {cm.length > 0 && (<><Progress value={cd} max={cm.length} /><p className="muted" style={{ fontSize: ".8rem", margin: ".3rem 0 .8rem" }}>{cd} de {cm.length} partidos cerrados</p></>)}
              <div className="actions" style={{ gap: ".9rem", fontSize: "var(--step--1)", fontWeight: 800 }}>
                <Link href={`/admin/parejas?cat=${c.id}`}>Parejas</Link>
                <Link href={`/admin/fases/${current?.number ?? 1}#cat-${c.id}`}>Grupos</Link>
                <Link href={`/admin/clasificacion?cat=${c.id}`}>Clasificación</Link>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
