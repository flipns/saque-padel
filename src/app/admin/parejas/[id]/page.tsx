import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadMatches, loadPhases, pairMap, pairName, setsText } from "@/lib/data";
import { moveImpact } from "@/lib/engine";
import { fmtDate } from "@/lib/dates";
import { Flash, MatchPill, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { changeCategoryAction, updatePairAction } from "../actions";

export default async function ParejaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb } = await requireAdmin(`/admin/parejas/${id}`);
  const season = await getSeasonRow(sb);
  if (!season) notFound();
  const [cats, pairs, matches, accessRes, phases, memberRes] = await Promise.all([
    loadCats(sb, season.id), loadPairs(sb, season.id, { contacts: true, emails: true }), loadMatches(sb, season.id, { pairIds: [id] }),
    sb.from("pair_access").select("email, player_id, added_by, added_at").eq("pair_id", id).order("added_at"),
    loadPhases(sb, season.id), sb.from("group_pairs").select("phase_id, groups(letter)").eq("pair_id", id),
  ]);
  const pm = pairMap(pairs);
  const pair = pm.get(id);
  if (!pair) notFound();
  const cat = cats.find((c) => c.id === pair.categoryId);
  const otherCats = cats.filter((c) => c.division === cat?.division && c.id !== pair.categoryId);
  const imp = moveImpact(matches.map((m) => m.status));
  const letterOf = new Map(((memberRes.data ?? []) as any[]).map((r) => [r.phase_id as string, (Array.isArray(r.groups) ? r.groups[0] : r.groups)?.letter as string]));
  const openPhases = phases.filter((p) => p.kind === "LEVELING" && ["GENERATED", "PUBLISHED", "ACTIVE"].includes(p.status));

  return (
    <>
      <PageHead title={pairName(pair)} sub={cat?.label}><Link className="btn btn-outline btn-sm" href={`/admin/parejas?cat=${pair.categoryId}`}>Volver a parejas</Link></PageHead>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <form action={updatePairAction}>
          <input type="hidden" name="pair" value={id} />
          <div className="fields">
            {pair.players.map((pl, i) => (
              <fieldset key={pl.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "1rem" }}>
                <legend style={{ fontWeight: 800, padding: "0 .4rem" }}>Jugador {i + 1}</legend>
                <label htmlFor={`name${i + 1}`}>Nombre y apellidos</label>
                <input id={`name${i + 1}`} name={`name${i + 1}`} type="text" defaultValue={pl.name} required />
                <label htmlFor={`phone${i + 1}`} style={{ marginTop: ".75rem" }}>Móvil</label>
                <input id={`phone${i + 1}`} name={`phone${i + 1}`} type="text" defaultValue={pl.phone ?? ""} />
                <label className="check"><input type="checkbox" name={`minor${i + 1}`} defaultChecked={pl.isMinor} /> Menor de edad (su móvil nunca se enseña a rivales)</label>
              </fieldset>
            ))}
            <div>
              <label>Categoría</label>
              <p style={{ margin: ".25rem 0 0", fontWeight: 800 }}>{cat?.label}</p>
              <input type="hidden" name="category" value={pair.categoryId} />
              <p className="help" style={{ marginTop: ".25rem" }}>Para cambiarla usa «Cambiar de categoría» más abajo.</p>
              <label htmlFor="status" style={{ marginTop: ".75rem" }}>Estado</label>
              <select id="status" name="status" defaultValue={pair.status}><option value="ACTIVE">Activa</option><option value="WITHDRAWN">Baja</option></select>
            </div>
            <div>
              <label htmlFor="emails">Emails con acceso (uno por línea)</label>
              <textarea id="emails" name="emails" defaultValue={pair.emails.join("\n")} required />
              <p className="help">Cualquiera de estos emails entra en la zona de esta pareja. Si el jugador es menor, el del tutor.</p>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}><SubmitButton>Guardar cambios</SubmitButton></div>
        </form>
      </div>

      {openPhases.length > 0 && (
        <>
          <h2 className="section-title">Grupos de esta pareja</h2>
          <div className="card">
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {openPhases.map((p) => {
                const l = letterOf.get(p.id);
                return (
                  <li key={p.id}>
                    {p.name.split("·")[1]?.trim() ?? p.name}: {l ? <b>Grupo {l}</b> : <><b style={{ color: "var(--danger)" }}>sin grupo</b> · <Link href={`/admin/fases/${p.number}#cat-${pair.categoryId}`}>Colocarla en un grupo</Link></>}
                    {l && <> · <Link href={`/admin/fases/${p.number}#cat-${pair.categoryId}`}>Ver grupo / mover</Link></>}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <h2 className="section-title">Cambiar de categoría</h2>
      <div className="card">
        {!imp.allowed ? (
          <p className="callout warn" style={{ marginBottom: 0 }}>
            <b>No se puede cambiar de categoría:</b> la pareja ya tiene {imp.committed} {imp.committed === 1 ? "partido con resultado" : "partidos con resultado"}.
            Si se fuera de {cat?.label}, sus rivales perderían los puntos que ganaron contra ella. Si de verdad hay que hacerlo, antes hay que decidir cómo tratar esos resultados.
          </p>
        ) : otherCats.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No hay otras categorías en su división.</p> : (
          <form action={changeCategoryAction}>
            <input type="hidden" name="pair" value={id} />
            <div className="fields">
              <div>
                <label htmlFor="newcat">Nueva categoría</label>
                <select id="newcat" name="category" defaultValue="" required>
                  <option value="" disabled>Elige…</option>
                  {otherCats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="reason">Motivo (queda en el registro)</label>
                <input id="reason" name="reason" type="text" required maxLength={200} placeholder="Ej.: nivel superior al de su categoría" />
              </div>
            </div>
            <ul className="help" style={{ margin: ".75rem 0", paddingLeft: "1.1rem" }}>
              <li>Se retiran sus partidos sin jugar ({imp.open}), con sus propuestas de fecha y su chat, y sale de sus grupos.</li>
              <li>Queda <b>sin grupo</b> en la categoría nueva: después la colocas en «Grupos y fases».</li>
              <li>Se avisa a los jugadores y a los rivales de los partidos cancelados.</li>
              <li>Su Ranking General individual no cambia y no hay bonus (un cambio administrativo nunca puntúa).</li>
              <li>Solo dentro de su división ({cat?.division === "FEMENINA" ? "femenina" : "masculina"}).</li>
            </ul>
            <SubmitButton className="btn btn-navy" confirm={`Se cancelarán ${imp.open} ${imp.open === 1 ? "partido sin jugar" : "partidos sin jugar"} y la pareja saldrá de sus grupos. Se avisa a los jugadores. ¿Cambiar de categoría?`}>Cambiar de categoría</SubmitButton>
          </form>
        )}
      </div>

      <h2 className="section-title">Accesos</h2>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {((accessRes.data ?? []) as any[]).map((a) => (
            <li key={a.email}>
              <b>{a.email}</b> · {pair.players.find((p) => p.id === a.player_id)?.name ?? "jugador sin indicar"}
              {a.added_by ? <span className="muted"> · añadido por {a.added_by} el {fmtDate(a.added_at)}</span> : <span className="muted"> · inscripción</span>}
            </li>
          ))}
        </ul>
        <p className="help" style={{ marginBottom: 0 }}>Para quitar o cambiar un email, edítalo arriba en «Emails con acceso».</p>
      </div>

      <h2 className="section-title">Partidos de la pareja</h2>
      {matches.length === 0 ? <p className="card empty">Todavía no tiene partidos.</p> : (
        <div className="matches">
          {matches.map((m) => {
            const rivalId = m.pairA === id ? m.pairB : m.pairA;
            return (
              <Link key={m.id} href={`/admin/partidos/${m.id}`} className="match">
                <div className="meta"><span>Fase {m.phaseNumber} · Grupo {m.groupLetter}</span><MatchPill status={m.status} /></div>
                <div className="team">vs {pairName(pm.get(rivalId))}</div>
                <div className="when">{setsText(m.sets) || "Sin resultado"}</div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
