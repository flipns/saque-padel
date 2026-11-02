import { DEFAULT_RULES, type LevelCode, type SeasonRules } from "./rules";

export type RankingCase = "EVEN" | "UPSET" | "BIG_UPSET" | "FAVOURITE";

/**
 * Cambio de ranking por partido (reglamento §8.2). Se compara la media
 * prepartido de cada pareja; cada integrante recibe el mismo cambio.
 */
export function matchRankingDelta(
  winnerAvg: number,
  loserAvg: number,
  rules: SeasonRules = DEFAULT_RULES
): { winner: number; loser: number; case: RankingCase; diff: number } {
  const r = rules.ranking;
  const diff = Math.abs(winnerAvg - loserAvg);
  let c: RankingCase;
  if (diff < r.closeThreshold) c = "EVEN";
  else if (winnerAvg < loserAvg) c = diff >= r.bigUpsetThreshold ? "BIG_UPSET" : "UPSET";
  else c = "FAVOURITE";
  const [w, l] =
    c === "EVEN" ? r.deltas.even : c === "UPSET" ? r.deltas.upset : c === "BIG_UPSET" ? r.deltas.bigUpset : r.deltas.favourite;
  return { winner: w, loser: l, case: c, diff };
}

export type Movement = "CATEGORY_UP" | "CATEGORY_DOWN" | "GROUP_UP" | "GROUP_DOWN" | "STAY";

/**
 * Bonus por movimiento deportivo (§8.3). Si cambia de categoría se aplica solo
 * el de categoría (nunca se acumula con el de grupo). Las rotaciones de
 * nivelación y los ajustes administrativos no generan bonus: no se llama a esta función.
 */
export function movementBonus(
  m: { categoryChange: -1 | 0 | 1; groupChange: -1 | 0 | 1 },
  rules: SeasonRules = DEFAULT_RULES
): { movement: Movement; points: number } {
  const b = rules.ranking.bonus;
  if (m.categoryChange === 1) return { movement: "CATEGORY_UP", points: b.categoryUp };
  if (m.categoryChange === -1) return { movement: "CATEGORY_DOWN", points: b.categoryDown };
  if (m.groupChange === 1) return { movement: "GROUP_UP", points: b.groupUp };
  if (m.groupChange === -1) return { movement: "GROUP_DOWN", points: b.groupDown };
  return { movement: "STAY", points: 0 };
}

export function startPointsFor(level: LevelCode, rules: SeasonRules = DEFAULT_RULES): number {
  return rules.ranking.startPoints[level];
}

// ---------- Recalculado cronológico ----------

export type RankingEvent =
  | { kind: "INITIAL"; at: string; playerId: string; points: number; key: string }
  | {
      kind: "MATCH";
      at: string;
      matchId: string;
      winners: [string, string];
      losers: [string, string];
      key: string;
    }
  | { kind: "BONUS"; at: string; playerIds: string[]; movement: Movement; points: number; key: string }
  | { kind: "ADJUSTMENT"; at: string; playerId: string; points: number; reason: string; key: string };

export interface LedgerLine {
  key: string; // clave idempotente: evento + jugador
  playerId: string;
  at: string;
  kind: RankingEvent["kind"];
  delta: number;
  balance: number;
  detail?: { matchId?: string; case?: RankingCase; diff?: number; ownAvg?: number; rivalAvg?: number; movement?: Movement };
}

/**
 * Reproduce todos los eventos en orden y devuelve el ledger completo.
 * Al ser determinista, corregir un resultado y volver a llamar recalcula
 * todo lo posterior de forma trazable sin dobles aplicaciones (cada clave aparece una vez).
 */
export function replayRanking(
  events: RankingEvent[],
  rules: SeasonRules = DEFAULT_RULES
): { balances: Map<string, number>; ledger: LedgerLine[] } {
  const seen = new Set<string>();
  const ordered = [...events].sort((a, b) =>
    a.at === b.at ? (a.kind === "INITIAL" ? -1 : b.kind === "INITIAL" ? 1 : a.key.localeCompare(b.key)) : a.at.localeCompare(b.at)
  );
  const bal = new Map<string, number>();
  const ledger: LedgerLine[] = [];
  const add = (playerId: string, delta: number, e: RankingEvent, detail?: LedgerLine["detail"]) => {
    const key = `${e.key}:${playerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const balance = (bal.get(playerId) ?? 0) + delta;
    bal.set(playerId, balance);
    ledger.push({ key, playerId, at: e.at, kind: e.kind, delta, balance, detail });
  };

  for (const e of ordered) {
    if (e.kind === "INITIAL") add(e.playerId, e.points, e);
    else if (e.kind === "ADJUSTMENT") add(e.playerId, e.points, e);
    else if (e.kind === "BONUS") for (const p of e.playerIds) add(p, e.points, e, { movement: e.movement });
    else {
      const avg = (ids: string[]) => ids.reduce((s, id) => s + (bal.get(id) ?? 0), 0) / ids.length;
      const wAvg = avg(e.winners);
      const lAvg = avg(e.losers);
      const d = matchRankingDelta(wAvg, lAvg, rules);
      for (const p of e.winners) add(p, d.winner, e, { matchId: e.matchId, case: d.case, diff: d.diff, ownAvg: wAvg, rivalAvg: lAvg });
      for (const p of e.losers) add(p, d.loser, e, { matchId: e.matchId, case: d.case, diff: d.diff, ownAvg: lAvg, rivalAvg: wAvg });
    }
  }
  return { balances: bal, ledger };
}
