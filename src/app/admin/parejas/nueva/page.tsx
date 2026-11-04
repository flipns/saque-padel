import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSeasonRow, loadCats } from "@/lib/data";
import { Flash, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createPairAction } from "../actions";

export default async function NuevaPareja({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdmin("/admin/parejas/nueva");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  const cats = await loadCats(sb, season.id);
  return (
    <>
      <PageHead title="Añadir pareja" sub="Para altas tardías o inscripciones que no llegaron por el Form."><Link className="btn btn-outline btn-sm" href="/admin/parejas">Cancelar</Link></PageHead>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <form action={createPairAction}>
          <div className="fields">
            {[1, 2].map((i) => (
              <fieldset key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "1rem" }}>
                <legend style={{ fontWeight: 800, padding: "0 .4rem" }}>Jugador {i}</legend>
                <label htmlFor={`name${i}`}>Nombre y apellidos</label><input id={`name${i}`} name={`name${i}`} type="text" required />
                <label htmlFor={`phone${i}`} style={{ marginTop: ".75rem" }}>Móvil</label><input id={`phone${i}`} name={`phone${i}`} type="text" />
                <label className="check"><input type="checkbox" name={`minor${i}`} /> Menor de edad</label>
              </fieldset>
            ))}
            <div>
              <label htmlFor="category">Categoría</label>
              <select id="category" name="category" defaultValue="" required>
                <option value="" disabled>Elige…</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="emails">Email de acceso (o varios, uno por línea)</label>
              <textarea id="emails" name="emails" required />
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}><SubmitButton>Crear pareja</SubmitButton></div>
        </form>
      </div>
    </>
  );
}
