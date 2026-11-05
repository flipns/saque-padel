import { phasePoints, tally, type SetScore, type Side } from "./match";
import { DEFAULT_RULES, type SeasonRules } from "./rules";

export type MatchStatus =
  | "PENDING_SCHEDULE"
  | "SCHEDULE_PROPOSED"
  | "DATE_AGREED"
  | "RESCHEDULE_REQUESTED"
  | "PLAYED_PENDING_RESULT"
  | "SCHEDULED"
  | "RESULT_PENDING_CONFIRMATION"
  | "DISPUTED"
  | "COMPLETED"
  | "WO"
  | "NOT_PLAYED"
  | "CANCELLED";

export interface MatchRecord {
  id: string;
  pairA: string;
  pairB: string;
  status: MatchStatus;
  sets: SetScore[];
  winner: Side | null;
  /** Puntos fijados por la organización (WO, no disputado, resolución). Sustituyen al cálculo. */
  pointsOverride?: { a: number; b: number } | null;
  playedAt?: string | null;
}

/** Estados que cuentan para la clasificación oficial. */
export const OFFICIAL: MatchStatus[] = ["COMPLETED", "WO", "NOT_PLAYED"];
/** La vista provisional añade los resultados pendientes de confirmar. */
export const PROVISIONAL: MatchStatus[] = [...OFFICIAL, "RESULT_PENDING_CONFIRMATION"];

export interface StandingRow {
  pairId: string;
  points: number;
  played: number;
  pending: number;
  won: number;
  lost: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
  setDiff: number;
  gameDiff: number;
  position: number;
  /** Criterio que deshizo el empate con la fila anterior, para mostrarlo y auditarlo. */
  tiebreak?: "SETS" | "GAMES" | "H2H" | "MANUAL" | null;
}

export function computeRows(
  pairIds: string[],
  matches: MatchRecord[],
  counted: MatchStatus[] = OFFICIAL,
  rules: SeasonRules = DEFAULT_RULES
): Map<string, StandingRow> {
  const rows = new Map<string, StandingRow>();
  for (const id of pairIds)
    rows.set(id, {
      pairId: id, points: 0, played: 0, pending: 0, won: 0, lost: 0,
      setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0, setDiff: 0, gameDiff: 0, position: 0,
    });
  for (const m of matches) {
    const ra = rows.get(m.pairA);
    const rb = rows.get(m.pairB);
    if (!ra || !rb) continue;
    if (!counted.includes(m.status)) {
      if (m.status !== "CANCELLED") {
        ra.pending++;
        rb.pending++;
      }
      continue;
    }
    let pts: { a: number; b: number };
    if (m.pointsOverride) pts = m.pointsOverride;
    else if (m.status === "NOT_PLAYED") pts = { a: rules.matchPoints.notPlayed, b: rules.matchPoints.notPlayed };
    else if (m.winner) pts = phasePoints(m.sets, m.winner, rules);
    else pts = { a: 0, b: 0 }; // sin ganador (igualdad absoluta pendiente de la organización)
    ra.points += pts.a;
    rb.points += pts.b;
    // WO y no disputados no generan sets, juegos ni partidos jugados (no se inventan marcadores).
    if (m.status === "COMPLETED" || m.status === "RESULT_PENDING_CONFIRMATION") {
      const t = tally(m.sets);
      ra.played++; rb.played++;
      ra.setsFor += t.setsA; ra.setsAgainst += t.setsB;
      rb.setsFor += t.setsB; rb.setsAgainst += t.setsA;
      ra.gamesFor += t.gamesA; ra.gamesAgainst += t.gamesB;
      rb.gamesFor += t.gamesB; rb.gamesAgainst += t.gamesA;
      if (m.winner === "A") { ra.won++; rb.lost++; }
      if (m.winner === "B") { rb.won++; ra.lost++; }
    }
  }
  for (const r of rows.values()) {
    r.setDiff = r.setsFor - r.setsAgainst;
    r.gameDiff = r.gamesFor - r.gamesAgainst;
  }
  return rows;
}

/** Resultado del enfrentamiento directo entre dos parejas (>0 gana a, <0 gana b, 0 sin datos). */
function headToHead(a: string, b: string, matches: MatchRecord[], counted: MatchStatus[]): number {
  let score = 0;
  for (const m of matches) {
    if (!counted.includes(m.status) || !m.winner) continue;
    if (m.pairA === a && m.pairB === b) score += m.winner === "A" ? 1 : -1;
    if (m.pairA === b && m.pairB === a) score += m.winner === "B" ? 1 : -1;
  }
  return score;
}

type Criterion = "POINTS" | "SETS" | "GAMES" | "H2H";

/**
 * Ordena con una lista de criterios. El enfrentamiento directo solo se aplica
 * entre exactamente dos parejas empatadas que se hayan enfrentado.
 * manualOrder: orden fijado por la organización para empates absolutos (pairId -> rango).
 */
function rank(
  rows: StandingRow[],
  criteria: Criterion[],
  matches: MatchRecord[],
  counted: MatchStatus[],
  manualOrder: Record<string, number> = {}
): StandingRow[] {
  const key = (r: StandingRow, c: Criterion) =>
    c === "POINTS" ? r.points : c === "SETS" ? r.setDiff : c === "GAMES" ? r.gameDiff : 0;

  const sortBlock = (block: StandingRow[], ci: number): StandingRow[] => {
    if (block.length <= 1 || ci >= criteria.length) {
      return [...block].sort((x, y) => {
        const mx = manualOrder[x.pairId] ?? Infinity;
        const my = manualOrder[y.pairId] ?? Infinity;
        if (mx !== my) return mx - my;
        return x.pairId.localeCompare(y.pairId); // estable y reproducible; la organización decide
      });
    }
    const c = criteria[ci];
    if (c === "H2H") {
      if (block.length === 2) {
        const h = headToHead(block[0].pairId, block[1].pairId, matches, counted);
        if (h > 0) return [block[0], block[1]];
        if (h < 0) return [block[1], block[0]];
      }
      return sortBlock(block, ci + 1);
    }
    const groups = new Map<number, StandingRow[]>();
    for (const r of block) {
      const k = key(r, c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    return [...groups.keys()].sort((x, y) => y - x).flatMap((k) => sortBlock(groups.get(k)!, ci + 1));
  };

  const sorted = sortBlock(rows, 0);
  sorted.forEach((r, i) => {
    r.position = i + 1;
    r.tiebreak = null;
    if (i > 0) {
      const p = sorted[i - 1];
      if (p.points === r.points) {
        r.tiebreak =
          p.setDiff !== r.setDiff ? "SETS" : p.gameDiff !== r.gameDiff ? "GAMES"
          : headToHead(p.pairId, r.pairId, matches, counted) !== 0 ? "H2H" : "MANUAL";
      }
    }
  });
  return sorted;
}

/** Clasificación acumulada de nivelación (reglamento §4.2): puntos, sets, juegos, H2H si existe, organización. */
export function levelingStandings(
  pairIds: string[],
  matches: MatchRecord[],
  opts: { provisional?: boolean; manualOrder?: Record<string, number>; rules?: SeasonRules } = {}
): StandingRow[] {
  const counted = opts.provisional ? PROVISIONAL : OFFICIAL;
  const rows = [...computeRows(pairIds, matches, counted, opts.rules).values()];
  return rank(rows, ["POINTS", "SETS", "GAMES", "H2H"], matches, counted, opts.manualOrder);
}

/** Clasificación de un grupo mensual (reglamento §7): puntos, H2H, sets, juegos, organización. */
export function groupStandings(
  pairIds: string[],
  matches: MatchRecord[],
  opts: { provisional?: boolean; manualOrder?: Record<string, number>; rules?: SeasonRules } = {}
): StandingRow[] {
  const counted = opts.provisional ? PROVISIONAL : OFFICIAL;
  const rows = [...computeRows(pairIds, matches, counted, opts.rules).values()];
  return rank(rows, ["POINTS", "H2H", "SETS", "GAMES"], matches, counted, opts.manualOrder);
}

export type Zone = "UP" | "STAY" | "DOWN" | null;

/** Zonas de ascenso/descenso. Sin cupos publicados no se muestran zonas (spec §23). */
export function zoneFor(position: number, total: number, quotas?: { up: number; down: number } | null): Zone {
  if (!quotas) return null;
  if (position <= quotas.up) return "UP";
  if (position > total - quotas.down) return "DOWN";
  return "STAY";
}
