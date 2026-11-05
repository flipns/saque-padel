import type { PairView, Quota } from "@/lib/data";
import { pairName } from "@/lib/data";
import { zoneFor, type StandingRow } from "@/lib/engine";

/** Clasificación de una categoría. `mine` resalta las parejas del usuario. */
export function StandingsTable({ rows, pairs, quota, mine }: { rows: StandingRow[]; pairs: Map<string, PairView>; quota: Quota | null; mine?: Set<string> }) {
  const total = rows.length;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>#</th><th>Pareja</th><th className="num">Pts</th><th className="num">PJ</th><th className="num">G</th><th className="num">P</th><th className="num">Sets</th><th className="num">Juegos</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const z = zoneFor(r.position, total, quota);
            const cut = quota && (r.position === quota.up || r.position === total - quota.down);
            return (
              <tr key={r.pairId} className={`${mine?.has(r.pairId) ? "mine " : ""}${z === "UP" ? "zone-up " : z === "DOWN" ? "zone-down " : ""}${cut ? "cut" : ""}`}>
                <td className="pos">{r.position}</td><td className="name">{pairName(pairs.get(r.pairId))}</td>
                <td className="num"><b>{r.points}</b></td><td className="num">{r.played}{r.pending ? <small className="muted"> (+{r.pending})</small> : null}</td>
                <td className="num">{r.won}</td><td className="num">{r.lost}</td>
                <td className="num">{r.setDiff >= 0 ? "+" : ""}{r.setDiff}</td><td className="num">{r.gameDiff >= 0 ? "+" : ""}{r.gameDiff}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={8} className="empty">Esta categoría no tiene parejas activas.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
