import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, loadMatches, pairMap, pairName, setsText } from "@/lib/data";
import { fmtDate } from "@/lib/dates";
import { Flash, MatchPill, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { updatePairAction } from "../actions";

export default async function ParejaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb } = await requireAdmin(`/admin/parejas/${id}`);
  const season = await getSeasonRow(sb);
  if (!season) notFound();
  const [cats, pairs, matches, accessRes] = await Promise.all([
    loadCats(sb, season.id), loadPairs(sb, season.id, { contacts: true, emails: true }), loadMatches(sb, season.id, { pairIds: [id] }),
    sb.from("pair_access").select("email, player_id, added_by, added_at").eq("pair_id", id).order("added_at"),
  ]);
  const pm = pairMap(pairs);
  const pair = pm.get(id);
  if (!pair) notFound();
  const cat = cats.find((c) => c.id === pair.categoryId);
  const sameDivision = cats.filter((c) => c.division === cat?.division);

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
              <label htmlFor="category">Categoría</label>
              <select id="category" name="category" defaultValue={pair.categoryId}>{sameDivision.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
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
