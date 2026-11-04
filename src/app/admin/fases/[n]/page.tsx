import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadPhases, loadGroups, loadHistoryAll, loadMatches, pairMap, pairName, groupsText } from "@/lib/data";
import { pairKey } from "@/lib/engine";
import { CatDot, Flash, MatchPill, PageHead, PhasePill } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtDate } from "@/lib/dates";
import { addToGroupAction, generateAction, moveAction, publishAction, unpublishAction } from "../actions";

export default async function FasePage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { n: nParam } = await params;
  const { ok, err } = await searchParams;
  const n = Number(nParam);
  const { sb } = await requireAdmin(`/admin/fases/${n}`);
  const season = await getSeasonRow(sb);
  if (!season) notFound();
  const phase = (await loadPhases(sb, season.id)).find((p) => p.number === n);
  if (!phase) notFound();

  const [cats, pairs, groups, matches, histories] = await Promise.all([
    loadCats(sb, season.id), loadPairs(sb, season.id), loadGroups(sb, phase.id), loadMatches(sb, season.id, { phaseId: phase.id }),
    loadHistoryAll(sb, season.id, phase.id),
  ]);

  const pm = pairMap(pairs);
  const active = pairs.filter((p) => p.status === "ACTIVE");
  const isLeveling = phase.kind === "LEVELING";
  const editable = phase.status === "DRAFT" || phase.status === "GENERATED";
  const published = ["PUBLISHED", "ACTIVE", "CLOSED", "LOCKED"].includes(phase.status);
  const title = phase.name.split("·")[1]?.trim() ?? phase.name;

  return (
    <>
      <PageHead title={`${isLeveling ? "Nivelación" : "Race"} · ${title}`}
        sub={`Del ${fmtDate(phase.starts_on)} al ${fmtDate(phase.ends_on)}. Resultados hasta el ${fmtDate(phase.results_deadline)}.`}>
        <PhasePill status={phase.status} />
        <Link className="btn btn-outline btn-sm" href="/admin/fases">Todas las fases</Link>
      </PageHead>
      <Flash ok={ok} err={err} />

      {!isLeveling && (
        <p className="hint">Los grupos jerárquicos de la Race (A &gt; B &gt; C) se crean al cerrar la nivelación de enero, con la clasificación acumulada. Se desarrolla en la siguiente entrega.</p>
      )}

      {isLeveling && editable && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem" }}>{phase.status === "DRAFT" ? "1. Genera los grupos" : "Grupos generados: revísalos"}</h2>
              <p className="muted" style={{ margin: ".3rem 0 0", maxWidth: "62ch" }}>
                {phase.status === "DRAFT"
                  ? "Reparte las parejas de cada categoría en grupos de 4 (y de 3 para cuadrar), evitando repetir rivales."
                  : "Si no te gusta el reparto, regéneralo entero o por categoría. También puedes mover parejas a mano. Cuando todo esté bien, publica."}
              </p>
            </div>
            <div className="actions">
              <form action={generateAction}>
                <input type="hidden" name="phase" value={n} />
                <SubmitButton className={phase.status === "DRAFT" ? "btn btn-navy" : "btn btn-outline"} pendingText="Generando…"
                  confirm={phase.status === "GENERATED" ? "Esto rehace todos los grupos y descarta los cambios manuales. ¿Continuar?" : undefined}>
                  {phase.status === "DRAFT" ? "Generar grupos de todas las categorías" : "Regenerar todo"}
                </SubmitButton>
              </form>
              {phase.status === "GENERATED" && (
                <form action={publishAction}>
                  <input type="hidden" name="phase" value={n} />
                  <SubmitButton className="btn btn-mint" pendingText="Publicando…" confirm="Al publicar se crean los partidos y los jugadores los verán. ¿Publicar la fase?">Publicar fase</SubmitButton>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {published && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <p style={{ margin: 0 }}><b>{matches.length}</b> partidos creados. <Link href={`/admin/partidos?fase=${n}`}><b>Ver partidos</b></Link></p>
            <form action={unpublishAction}>
              <input type="hidden" name="phase" value={n} />
              <SubmitButton className="btn btn-danger btn-sm" confirm="Los partidos se borran y los jugadores dejan de verlos. Solo es posible si nadie ha puesto fecha ni resultado. ¿Continuar?">Volver a borrador</SubmitButton>
            </form>
          </div>
        </div>
      )}

      {cats.map((c) => {
        const cg = groups.filter((g) => g.categoryId === c.id);
        const catPairs = active.filter((p) => p.categoryId === c.id);
        const inGroup = new Set(cg.flatMap((g) => g.pairIds));
        const loose = catPairs.filter((p) => !inGroup.has(p.id));
        const hist = histories.get(c.id) ?? { history: new Set<string>(), small: new Set<string>() };
        const warnings: string[] = [];
        for (const g of cg) {
          if (g.pairIds.length > 0 && (g.pairIds.length < 3 || g.pairIds.length > 4)) warnings.push(`El grupo ${g.letter} tiene ${g.pairIds.length} parejas.`);
          for (let i = 0; i < g.pairIds.length; i++) for (let j = i + 1; j < g.pairIds.length; j++)
            if (hist.history.has(pairKey(g.pairIds[i], g.pairIds[j]))) warnings.push(`Grupo ${g.letter}: ${pairName(pm.get(g.pairIds[i]))} y ${pairName(pm.get(g.pairIds[j]))} ya se enfrentaron.`);
        }
        if (cg.length > 0 && loose.length > 0 && editable) warnings.push(`${loose.length} ${loose.length === 1 ? "pareja sin grupo" : "parejas sin grupo"}: regenera los grupos de esta categoría.`);
        const groupMatches = (gid: string) => matches.filter((m) => m.groupId === gid);

        return (
          <section key={c.id} id={`cat-${c.id}`} className="card" style={{ scrollMarginTop: "5rem" }}>
            <div className="actions" style={{ justifyContent: "space-between", marginBottom: ".75rem" }}>
              <div>
                <h2 style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: "1.15rem" }}><CatDot code={c.code} />{c.label}</h2>
                <p className="muted" style={{ margin: ".2rem 0 0", fontSize: "var(--step--1)" }}>{catPairs.length} parejas · {groupsText(catPairs.length)}</p>
              </div>
              {isLeveling && editable && cg.length > 0 && (
                <form action={generateAction}>
                  <input type="hidden" name="phase" value={n} /><input type="hidden" name="cat" value={c.id} />
                  <SubmitButton className="btn btn-outline btn-sm" pendingText="Regenerando…">Regenerar esta categoría</SubmitButton>
                </form>
              )}
            </div>

            {warnings.length > 0 && (<ul className="warn-list" role="status">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>)}
            {cg.length === 0 && <p className="empty">{isLeveling ? "Aún sin grupos." : "Sin grupos."}</p>}

            <div className="groupgrid" style={{ marginTop: ".75rem" }}>
              {cg.map((g) => {
                const gm = groupMatches(g.id);
                return (
                  <div className="group" key={g.id}>
                    <h4><span>Grupo {g.letter}</span><span className="muted" style={{ fontWeight: 600, fontSize: ".8rem" }}>{g.pairIds.length} parejas{gm.length ? ` · ${gm.length} partidos` : ""}</span></h4>
                    <ul>
                      {g.pairIds.map((pid) => (
                        <li key={pid}>
                          <Link href={`/admin/parejas/${pid}`} style={{ textDecoration: "none" }}>{pairName(pm.get(pid))}</Link>
                          {editable && cg.length > 1 && (
                            <form action={moveAction} className="mini-form">
                              <input type="hidden" name="phase" value={n} /><input type="hidden" name="pair" value={pid} />
                              <select name="to" aria-label="Mover a otro grupo" defaultValue="">
                                <option value="" disabled>Mover…</option>
                                {cg.filter((o) => o.id !== g.id).map((o) => <option key={o.id} value={o.id}>Grupo {o.letter}</option>)}
                              </select>
                              <SubmitButton className="btn btn-outline btn-sm" pendingText="…">Ir</SubmitButton>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                    {gm.length > 0 && (
                      <p style={{ margin: ".7rem 0 0", display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
                        {(["COMPLETED", "RESULT_PENDING_CONFIRMATION", "DISPUTED", "PENDING_SCHEDULE"] as const).map((st) => {
                          const k = gm.filter((m) => m.status === st).length;
                          return k ? <span key={st}><MatchPill status={st} /> <small>{k}</small></span> : null;
                        })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {(published || phase.status === "GENERATED") && cg.length > 0 && loose.length > 0 && (
              <div className="hint" style={{ marginTop: "1rem" }}>
                <b>Parejas sin grupo en esta fase</b> (altas tardías):
                {loose.map((p) => (
                  <form key={p.id} action={addToGroupAction} className="mini-form" style={{ display: "flex", margin: ".5rem 0 0", flexWrap: "wrap" }}>
                    <input type="hidden" name="phase" value={n} /><input type="hidden" name="pair" value={p.id} />
                    <span style={{ minWidth: 180 }}>{pairName(p)}</span>
                    <select name="to" aria-label="Grupo" defaultValue="" style={{ maxWidth: 160 }}>
                      <option value="" disabled>Elige grupo…</option>
                      {cg.map((o) => <option key={o.id} value={o.id}>Grupo {o.letter} ({o.pairIds.length})</option>)}
                    </select>
                    <SubmitButton className="btn btn-outline btn-sm">{published ? "Añadir y crear partidos" : "Añadir al grupo"}</SubmitButton>
                  </form>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
