import { describe, it, expect } from "vitest";
import { groupSizes, generateGroups, roundRobin, pairKey } from "@/lib/engine";

describe("tamaños de grupo", () => {
  it("grupos de 4 y el resto de 3", () => {
    expect(groupSizes(12).sizes).toEqual([4, 4, 4]);
    expect(groupSizes(13).sizes).toEqual([4, 3, 3, 3]);
    expect(groupSizes(14).sizes).toEqual([4, 4, 3, 3]);
    expect(groupSizes(15).sizes).toEqual([4, 4, 4, 3]);
    expect(groupSizes(6).sizes).toEqual([3, 3]);
    expect(groupSizes(5).warning).toBeTruthy();
  });
});

describe("rotación de rivales", () => {
  const ids = Array.from({ length: 16 }, (_, i) => `p${String(i + 1).padStart(2, "0")}`);
  it("tres fases de 16 parejas sin repetir rival", () => {
    const history = new Set<string>();
    for (let phase = 0; phase < 3; phase++) {
      const r = generateGroups({ pairIds: ids, history, hadSmallGroup: new Set(), seed: 2026 + phase, restarts: 200 });
      expect(r.repeatedRivals).toHaveLength(0);
      for (const g of r.groups) for (const [a, b] of roundRobin(g)) history.add(pairKey(a, b));
    }
    expect(history.size).toBe(16 * 9 / 2);
  });
  it("es reproducible con la misma semilla", () => {
    const a = generateGroups({ pairIds: ids, history: new Set(), hadSmallGroup: new Set(), seed: 7 });
    const b = generateGroups({ pairIds: ids, history: new Set(), hadSmallGroup: new Set(), seed: 7 });
    expect(a.groups).toEqual(b.groups);
  });
  it("evita repetir grupo de 3 a la misma pareja", () => {
    const ids13 = ids.slice(0, 13);
    const first = generateGroups({ pairIds: ids13, history: new Set(), hadSmallGroup: new Set(), seed: 1 });
    const small = new Set(first.groups.filter((g) => g.length === 3).flat());
    const history = new Set(first.groups.flatMap((g) => roundRobin(g).map(([a, b]) => pairKey(a, b))));
    const second = generateGroups({ pairIds: ids13, history, hadSmallGroup: small, seed: 2, restarts: 200 });
    expect(second.repeatedRivals).toHaveLength(0);
    // 9 parejas vienen de tres grupos de 3. Para no repetir rival, el grupo de 4 solo admite una de cada
    // grupo anterior (3 como máximo), así que el óptimo es que 6 repitan grupo de 3, ninguna más.
    expect(second.smallGroupRepeats.length).toBe(6);
  });
  it("con pocas parejas minimiza y lista las repeticiones", () => {
    const six = ids.slice(0, 6);
    const history = new Set([pairKey("p01", "p02"), pairKey("p01", "p03"), pairKey("p02", "p03")]);
    const r = generateGroups({ pairIds: six, history, hadSmallGroup: new Set(), seed: 3 });
    // 3 parejas que ya se han enfrentado entre sí y solo 2 grupos: 1 repetición es inevitable (y es el mínimo)
    expect(r.repeatedRivals).toHaveLength(1);
  });
  it("round robin: 6 partidos en grupo de 4 y 3 en grupo de 3", () => {
    expect(roundRobin(["a", "b", "c", "d"])).toHaveLength(6);
    expect(roundRobin(["a", "b", "c"])).toHaveLength(3);
  });
});
