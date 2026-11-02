import { DEFAULT_RULES, type SeasonRules } from "./rules";

/**
 * Los cálculos Race se hacen en milésimas enteras para evitar errores de coma
 * flotante acumulados. Se muestran con 2 decimales como máximo.
 */
const SCALE = 1000;

/** Puntos Race brutos de un puesto en un grupo (0 = A). Lanza si el grupo no tiene coeficiente configurado. */
export function racePointsMilli(position: number, groupIndex: number, rules: SeasonRules = DEFAULT_RULES): number {
  const base = rules.race.basePoints[position - 1];
  if (base === undefined) throw new Error(`Puesto ${position} sin puntos base`);
  const coef = rules.race.groupCoefPct[groupIndex];
  if (coef === undefined)
    throw new Error(`Grupo ${String.fromCharCode(65 + groupIndex)} sin coeficiente: la organización debe configurarlo`);
  return (base * coef * SCALE) / 100;
}

/**
 * Factor por categoría (§9.2). levelOrder: 1 = categoría más alta de la división.
 * phaseLevel = categoría donde se obtuvieron los puntos; refLevel = categoría disputada en mayo.
 */
export function categoryFactorPct(phaseLevel: number, refLevel: number, rules: SeasonRules = DEFAULT_RULES): number {
  const f = rules.race.categoryFactorPct;
  const below = phaseLevel - refLevel; // >0: se obtuvieron en una categoría inferior
  if (below <= 0) return below === 0 ? f.same : f.above;
  return below === 1 ? f.oneBelow : f.twoOrMoreBelow;
}

export interface RacePhaseResult {
  phaseId: string;
  position: number;
  groupIndex: number;
  categoryLevel: number;
}

export interface RaceBreakdownLine extends RacePhaseResult {
  grossMilli: number;
  factorPct: number;
  countedMilli: number;
}

/** Total Race de una pareja para la categoría de referencia, menos sanciones (sin saldo negativo). */
export function raceTotal(
  results: RacePhaseResult[],
  refLevel: number,
  penaltiesMilli = 0,
  rules: SeasonRules = DEFAULT_RULES
): { totalMilli: number; grossMilli: number; lines: RaceBreakdownLine[] } {
  const lines = results.map((r) => {
    const grossMilli = racePointsMilli(r.position, r.groupIndex, rules);
    const factorPct = categoryFactorPct(r.categoryLevel, refLevel, rules);
    return { ...r, grossMilli, factorPct, countedMilli: (grossMilli * factorPct) / 100 };
  });
  const grossMilli = lines.reduce((s, l) => s + l.grossMilli, 0);
  const counted = lines.reduce((s, l) => s + l.countedMilli, 0);
  return { totalMilli: Math.max(0, counted - penaltiesMilli), grossMilli, lines };
}

export const milliToNumber = (m: number) => m / SCALE;
export const formatRace = (m: number) =>
  (m / SCALE).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
