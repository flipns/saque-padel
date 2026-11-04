import Link from "next/link";
import { requirePlayer } from "@/lib/auth";
import { getSeasonRow, loadCats, loadPairs, categoryStandings, pairName } from "@/lib/data";
import { zoneFor } from "@/lib/engine";
import { CatDot, Pill } from "@/components/ui";

export default async function Clasificacion({ searchParams }: { searchParams: Promise<{ p?: string; prov?: string }> }) {
  const sp = await searchParams;
  const { sb, pairIds } = await requirePlayer("/mi-liga/clasificacion");
  const season = await getSeasonRow(sb);
  if (!season) return null;
  if (pairIds.length === 0) return <p className="card empty">Tu email no tiene pareja inscrita.</p>;
  const pid = pairIds.includes(sp.p ?? "") ? (sp.p as string) : pairIds[0];
  const [cats, mine] = await Promise.all([loadCats(sb, season.id), loadPairs(sb, season.id, { ids: [pid] })]);
  const cat = cats.find((c) => c.id === mine[0].categoryId)!;
  const prov = sp.prov === "1";
  const { rows, quota, pairs } = await categoryStandings(sb, season, cat.id, { provisional: prov });
  const total = rows.length;
  const me = rows.find((r) => r.pairId === pid);
  const zone = me ? zoneFor(me.position, total, quota) : null;

  let note = "";
  if (me && quota && zone) {
    if (zone === "UP") note = `Estáis en zona de ascenso, con ${me.points - (rows[quota.up]?.points ?? 0)} puntos sobre la primera pareja que se queda fuera.`;
    if (zone === "STAY") note = `A ${rows[quota.up - 1].points - me.points} puntos de la zona de ascenso y ${me.points - rows[total - quota.down].points} por encima del descenso.`;
    if (zone === "DOWN") note = `Estáis en zona de descenso: a ${rows[total - quota.down - 1].points - me.points} puntos de salir.`;
  }

  return (
    <>
      <h1 style={{ fontSize: "var(--step-2)", fontWeight: 900, textTransform: "uppercase" }}>Clasificación</h1>
      <p className="muted" style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: ".3rem 0 1rem" }}><CatDot code={cat.code} />{cat.label} · {total} parejas · suma de noviembre, diciembre y enero</p>

      {me && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p style={{ margin: 0, fontSize: "1.1rem" }}><b>Vais {me.position}.º de {total}</b> con <b>{me.points} puntos</b>{zone === "UP" && <> <Pill tone="ok">Zona de ascenso</Pill></>}{zone === "DOWN" && <> <Pill tone="bad">Zona de descenso</Pill></>}{zone === "STAY" && <> <Pill>Permanencia</Pill></>}</p>
          {note && <p className="muted" style={{ margin: ".4rem 0 0" }}>{note}</p>}
          {quota && <p className="muted" style={{ margin: ".4rem 0 0", fontSize: ".85rem" }}>Cupos {quota.status === "CONFIRMED" ? "confirmados" : "previstos"}: suben {quota.up}, bajan {quota.down}. La posición es provisional hasta cerrar las tres fases.</p>}
        </div>
      )}

      <nav className="chips" aria-label="Vista">
        <Link className="chip" href={`/mi-liga/clasificacion?p=${pid}`} aria-current={!prov}>Oficial</Link>
        <Link className="chip" href={`/mi-liga/clasificacion?p=${pid}&prov=1`} aria-current={prov}>Incluir por confirmar</Link>
      </nav>

      <div className="table-scroll">
        <table>
          <thead><tr><th>#</th><th>Pareja</th><th className="num">Pts</th><th className="num">PJ</th><th className="num">G</th><th className="num">P</th><th className="num">Sets</th><th className="num">Juegos</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const z = zoneFor(r.position, total, quota);
              const cut = quota && (r.position === quota.up || r.position === total - quota.down);
              return (
                <tr key={r.pairId} className={`${r.pairId === pid ? "mine " : ""}${z === "UP" ? "zone-up " : z === "DOWN" ? "zone-down " : ""}${cut ? "cut" : ""}`}>
                  <td className="pos">{r.position}</td><td className="name">{pairName(pairs.get(r.pairId))}</td>
                  <td className="num"><b>{r.points}</b></td><td className="num">{r.played}{r.pending ? <small className="muted"> (+{r.pending})</small> : null}</td>
                  <td className="num">{r.won}</td><td className="num">{r.lost}</td>
                  <td className="num">{r.setDiff >= 0 ? "+" : ""}{r.setDiff}</td><td className="num">{r.gameDiff >= 0 ? "+" : ""}{r.gameDiff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="help">PJ: partidos jugados (entre paréntesis, los que faltan). Desempates: sets, juegos y decisión de la organización.</p>
    </>
  );
}
