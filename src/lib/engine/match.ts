import { DEFAULT_RULES, type SeasonRules } from "./rules";

export type Side = "A" | "B";
export interface SetScore {
  a: number;
  b: number;
}

/**
 * Un set está terminado si alguien llega a 6 con 2 de ventaja, o a 7
 * (7-5 / 7-6 con tie-break). Si no, es un set en curso (p. ej. 3-5 por tiempo).
 */
export function setWinner(s: SetScore): Side | null {
  const { a, b } = s;
  if ((a >= 6 && a - b >= 2) || (a === 7 && (b === 5 || b === 6))) return "A";
  if ((b >= 6 && b - a >= 2) || (b === 7 && (a === 5 || a === 6))) return "B";
  return null;
}

export interface MatchTally {
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
}

export function tally(sets: SetScore[]): MatchTally {
  let setsA = 0,
    setsB = 0,
    gamesA = 0,
    gamesB = 0;
  for (const s of sets) {
    gamesA += s.a;
    gamesB += s.b;
    const w = setWinner(s);
    if (w === "A") setsA++;
    if (w === "B") setsB++;
  }
  return { setsA, setsB, gamesA, gamesB };
}

export type ValidationError =
  | "EMPTY"
  | "NEGATIVE_OR_INVALID"
  | "TOO_MANY_SETS"
  | "SET_AFTER_FINISH"
  | "INCOMPLETE_NOT_LAST"
  | "NOT_FINISHED"
  | "FINISHED_BUT_MARKED_TIME";

/**
 * Valida un marcador al mejor de tres sets.
 * - Partido completo: alguien gana 2 sets y no hay sets después.
 * - Partido por tiempo (endedByTime): se permiten sets incompletos, solo el último.
 */
export function validateScore(sets: SetScore[], endedByTime: boolean): ValidationError | null {
  if (sets.length === 0) return "EMPTY";
  if (sets.length > 3) return "TOO_MANY_SETS";
  for (const s of sets) {
    if (!Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a < 0 || s.b < 0 || s.a > 7 || s.b > 7)
      return "NEGATIVE_OR_INVALID";
  }
  let wa = 0,
    wb = 0;
  for (let i = 0; i < sets.length; i++) {
    if (wa === 2 || wb === 2) return "SET_AFTER_FINISH";
    const w = setWinner(sets[i]);
    if (w === null && i < sets.length - 1) return "INCOMPLETE_NOT_LAST";
    if (w === "A") wa++;
    if (w === "B") wb++;
  }
  const finished = wa === 2 || wb === 2;
  if (!endedByTime && !finished) return "NOT_FINISHED";
  if (endedByTime && finished) return "FINISHED_BUT_MARKED_TIME";
  return null;
}

/**
 * Ganador de un partido. Si terminó por tiempo (reglamento §10 y §18):
 * 1) sets ganados, 2) juegos del set en curso, 3) juegos totales;
 * si persiste la igualdad devuelve null (resuelve la organización).
 */
export function matchWinner(sets: SetScore[], endedByTime: boolean): Side | null {
  const t = tally(sets);
  if (t.setsA !== t.setsB) return t.setsA > t.setsB ? "A" : "B";
  if (!endedByTime) return null;
  const last = sets[sets.length - 1];
  if (last && setWinner(last) === null && last.a !== last.b) return last.a > last.b ? "A" : "B";
  if (t.gamesA !== t.gamesB) return t.gamesA > t.gamesB ? "A" : "B";
  return null;
}

/** Puntos de fase para cada pareja: 4 victoria, 2 derrota con set, 1 derrota sin set. */
export function phasePoints(
  sets: SetScore[],
  winner: Side,
  rules: SeasonRules = DEFAULT_RULES
): { a: number; b: number } {
  const t = tally(sets);
  const mp = rules.matchPoints;
  const loserSets = winner === "A" ? t.setsB : t.setsA;
  const loserPts = loserSets >= 1 ? mp.lossWithSet : mp.lossNoSet;
  return winner === "A" ? { a: mp.win, b: loserPts } : { a: loserPts, b: mp.win };
}
