/**
 * Mover una pareja de grupo o de categoría.
 *
 * El motor de clasificación solo cuenta un partido si las dos parejas están en la tabla de la categoría. Si una pareja con
 * resultados se fuera, sus rivales perderían los puntos que ganaron contra ella. Por eso solo se puede mover una pareja
 * mientras NO tenga partidos con resultado. Los partidos sin resultado se retiran (con sus propuestas y su chat).
 * Debe coincidir con la lista de estados que comprueban las funciones admin_move_pair y admin_change_pair_category.
 */
export const COMMITTED_STATUSES = ["COMPLETED", "RESULT_PENDING_CONFIRMATION", "DISPUTED", "WO", "NOT_PLAYED", "PLAYED_PENDING_RESULT"] as const;

export interface MoveImpact {
  /** Partidos con resultado (jugados, pendientes de confirmar, impugnados, WO o no disputados). */
  committed: number;
  /** Partidos sin resultado que se retirarían al mover (incluye los que ya tienen fecha o pista). */
  open: number;
  /** Se puede mover solo si no hay ningún partido con resultado. */
  allowed: boolean;
}

export function moveImpact(statuses: string[]): MoveImpact {
  const committed = statuses.filter((s) => (COMMITTED_STATUSES as readonly string[]).includes(s)).length;
  return { committed, open: statuses.length - committed, allowed: committed === 0 };
}
