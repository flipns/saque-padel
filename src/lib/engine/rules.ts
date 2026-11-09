/**
 * Reglas configurables de la temporada. Los valores por defecto siguen el
 * Reglamento 2026/27 (18/10/2026) y la Especificación V5 (23/10/2026).
 * En base de datos se guardan en seasons.rules (jsonb) y se mezclan con estos.
 */
export type DivisionCode = "MASCULINA" | "FEMENINA";
export type LevelCode = "PREMIER" | "ORO" | "PLATA" | "BRONCE" | "ROOKIE";

export interface SeasonRules {
  matchPoints: { win: number; lossWithSet: number; lossNoSet: number; notPlayed: number };
  wo: { responsible: number; otherDefault: number };
  ranking: {
    startPoints: Record<LevelCode, number>;
    closeThreshold: number; // diferencia < 150 => partido igualado
    bigUpsetThreshold: number; // 300
    deltas: {
      even: [number, number]; // [ganador, perdedor]
      upset: [number, number]; // inferior gana por 150–299
      bigUpset: [number, number]; // inferior gana por 300+
      favourite: [number, number]; // favorito gana por 150+
    };
    bonus: { categoryUp: number; categoryDown: number; groupUp: number; groupDown: number };
  };
  race: {
    basePoints: number[]; // por puesto 1.º..4.º
    groupCoefPct: number[]; // A..G en porcentaje entero
    categoryFactorPct: { same: number; oneBelow: number; twoOrMoreBelow: number; above: number };
  };
  resultConfirmHours: number;
  phaseMarginDays: number;
  mastersMinPhases: number;
  courts: number; // pistas del club (Pista 1 … Pista N)
}

export const DEFAULT_RULES: SeasonRules = {
  matchPoints: { win: 4, lossWithSet: 2, lossNoSet: 1, notPlayed: 0 },
  wo: { responsible: -1, otherDefault: 0 },
  ranking: {
    startPoints: { PREMIER: 2200, ORO: 1800, PLATA: 1400, BRONCE: 1000, ROOKIE: 600 },
    closeThreshold: 150,
    bigUpsetThreshold: 300,
    deltas: { even: [10, -5], upset: [15, -10], bigUpset: [20, -15], favourite: [7, -3] },
    bonus: { categoryUp: 50, categoryDown: -50, groupUp: 15, groupDown: -15 },
  },
  race: {
    basePoints: [100, 75, 50, 25],
    groupCoefPct: [100, 95, 90, 85, 80, 75, 70],
    categoryFactorPct: { same: 100, oneBelow: 50, twoOrMoreBelow: 0, above: 100 },
  },
  resultConfirmHours: 48,
  phaseMarginDays: 5,
  mastersMinPhases: 3,
  courts: 10,
};

export function mergeRules(partial?: Partial<SeasonRules> | null): SeasonRules {
  if (!partial) return DEFAULT_RULES;
  return {
    ...DEFAULT_RULES,
    ...partial,
    matchPoints: { ...DEFAULT_RULES.matchPoints, ...partial.matchPoints },
    wo: { ...DEFAULT_RULES.wo, ...partial.wo },
    ranking: {
      ...DEFAULT_RULES.ranking,
      ...partial.ranking,
      deltas: { ...DEFAULT_RULES.ranking.deltas, ...partial.ranking?.deltas },
      bonus: { ...DEFAULT_RULES.ranking.bonus, ...partial.ranking?.bonus },
      startPoints: { ...DEFAULT_RULES.ranking.startPoints, ...partial.ranking?.startPoints },
    },
    race: {
      ...DEFAULT_RULES.race,
      ...partial.race,
      categoryFactorPct: { ...DEFAULT_RULES.race.categoryFactorPct, ...partial.race?.categoryFactorPct },
    },
  };
}

/** Letra de grupo a partir de su índice (0 = A). */
export const groupLetter = (i: number) => String.fromCharCode(65 + i);
