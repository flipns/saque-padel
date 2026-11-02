/**
 * Generador de grupos de nivelación (spec §5 y §23).
 * - Grupos de 4; si no cuadra, se completan con grupos de 3 (decisión del club).
 * - Minimiza rivales repetidos respecto al historial de la temporada.
 * - Evita que una pareja caiga dos veces en un grupo de 3 (juega menos partidos).
 * - Reproducible: misma semilla + mismas entradas = mismos grupos.
 */

export function groupSizes(n: number): { sizes: number[]; warning?: string } {
  if (n < 3) return { sizes: n > 0 ? [n] : [], warning: `Solo hay ${n} pareja(s): no se puede formar un grupo` };
  if (n === 5) return { sizes: [5], warning: "Con 5 parejas no cuadran grupos de 3 y 4: se propone un único grupo de 5" };
  const threes = (4 - (n % 4)) % 4;
  const fours = (n - 3 * threes) / 4;
  return { sizes: [...Array(fours).fill(4), ...Array(threes).fill(3)] };
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface GeneratorInput {
  pairIds: string[];
  /** Enfrentamientos ya jugados o programados en la temporada (pairKey). */
  history: Set<string>;
  /** Parejas que ya estuvieron en un grupo de 3 en una fase anterior. */
  hadSmallGroup: Set<string>;
  seed: number;
  restarts?: number;
  /** Bloqueos manuales: parejas que deben ir juntas en el grupo indicado (índice). */
  locked?: Record<string, number>;
}

export interface GeneratorResult {
  groups: string[][];
  repeatedRivals: { a: string; b: string; group: number }[];
  smallGroupRepeats: string[];
  cost: number;
  seed: number;
  warning?: string;
}

const REPEAT_COST = 1000;
const SMALL_AGAIN_COST = 100;

function evaluate(groups: string[][], input: GeneratorInput) {
  let cost = 0;
  const repeats: GeneratorResult["repeatedRivals"] = [];
  const small: string[] = [];
  groups.forEach((g, gi) => {
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++)
        if (input.history.has(pairKey(g[i], g[j]))) {
          cost += REPEAT_COST;
          repeats.push({ a: g[i], b: g[j], group: gi });
        }
    if (g.length === 3)
      for (const p of g)
        if (input.hadSmallGroup.has(p)) {
          cost += SMALL_AGAIN_COST;
          small.push(p);
        }
  });
  return { cost, repeats, small };
}

export function generateGroups(input: GeneratorInput): GeneratorResult {
  const { sizes, warning } = groupSizes(input.pairIds.length);
  const rand = rng(input.seed);
  const restarts = input.restarts ?? 60;
  const locked = input.locked ?? {};
  const free = input.pairIds.filter((p) => locked[p] === undefined).sort();

  let best: { groups: string[][]; cost: number } | null = null;

  for (let r = 0; r < restarts; r++) {
    // Reparto inicial aleatorio respetando bloqueos.
    const shuffled = [...free];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Las parejas que ya pasaron por un grupo de 3 se colocan primero (en los grupos de 4).
    shuffled.sort((x, y) => Number(input.hadSmallGroup.has(y)) - Number(input.hadSmallGroup.has(x)));
    const groups: string[][] = sizes.map(() => []);
    for (const [p, gi] of Object.entries(locked)) groups[gi]?.push(p);
    let k = 0;
    for (let gi = 0; gi < sizes.length; gi++) while (groups[gi].length < sizes[gi] && k < shuffled.length) groups[gi].push(shuffled[k++]);

    // Mejora local: intercambiar parejas libres entre grupos mientras baje el coste.
    let cost = evaluate(groups, input).cost;
    let improved = true;
    while (improved && cost > 0) {
      improved = false;
      for (let g1 = 0; g1 < groups.length && !improved; g1++)
        for (let g2 = g1 + 1; g2 < groups.length && !improved; g2++)
          for (let i = 0; i < groups[g1].length && !improved; i++)
            for (let j = 0; j < groups[g2].length && !improved; j++) {
              const a = groups[g1][i], b = groups[g2][j];
              if (locked[a] !== undefined || locked[b] !== undefined) continue;
              groups[g1][i] = b; groups[g2][j] = a;
              const c = evaluate(groups, input).cost;
              if (c < cost) { cost = c; improved = true; }
              else { groups[g1][i] = a; groups[g2][j] = b; }
            }
    }
    if (!best || cost < best.cost) best = { groups: groups.map((g) => [...g]), cost };
    if (best.cost === 0) break;
  }

  const final = best ?? { groups: [], cost: 0 };
  const ev = evaluate(final.groups, input);
  return {
    groups: final.groups,
    repeatedRivals: ev.repeats,
    smallGroupRepeats: ev.small,
    cost: ev.cost,
    seed: input.seed,
    warning,
  };
}

/** Todos contra todos dentro del grupo: 4 parejas = 6 partidos (3 por pareja); 3 parejas = 3 partidos (2 por pareja). */
export function roundRobin(group: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) out.push([group[i], group[j]]);
  return out;
}
