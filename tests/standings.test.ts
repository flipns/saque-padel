import { describe, it, expect } from "vitest";
import { levelingStandings, groupStandings, zoneFor, type MatchRecord } from "@/lib/engine";

const m = (id: string, a: string, b: string, sets: [number, number][], winner: "A" | "B", status: MatchRecord["status"] = "COMPLETED"): MatchRecord =>
  ({ id, pairA: a, pairB: b, status, winner, sets: sets.map(([x, y]) => ({ a: x, b: y })) });

describe("clasificación acumulada de nivelación", () => {
  it("parejas de grupos distintos comparten tabla y los pendientes no cuentan", () => {
    const matches = [
      m("1", "p1", "p2", [[6, 2], [6, 2]], "A"),
      m("2", "p3", "p4", [[6, 4], [4, 6], [6, 4]], "A"),
      m("3", "p1", "p3", [[6, 0], [6, 0]], "A", "RESULT_PENDING_CONFIRMATION"),
    ];
    const t = levelingStandings(["p1", "p2", "p3", "p4"], matches);
    expect(t.map((r) => r.pairId)).toEqual(["p1", "p3", "p4", "p2"]);
    expect(t[0].points).toBe(4);
    expect(t[0].pending).toBe(1);
    const prov = levelingStandings(["p1", "p2", "p3", "p4"], matches, { provisional: true });
    expect(prov[0].points).toBe(8);
  });
  it("WO: −1 a la responsable y puntos de la otra fijados por la organización, sin sets ficticios", () => {
    const wo: MatchRecord = { id: "w", pairA: "p1", pairB: "p2", status: "WO", winner: null, sets: [], pointsOverride: { a: -1, b: 0 } };
    const t = levelingStandings(["p1", "p2"], [wo]);
    expect(t.find((r) => r.pairId === "p1")!.points).toBe(-1);
    expect(t.find((r) => r.pairId === "p2")!.setsFor).toBe(0);
    expect(t.find((r) => r.pairId === "p2")!.played).toBe(0);
  });
  it("desempata por diferencia de sets y luego de juegos", () => {
    const matches = [
      m("1", "a", "x", [[6, 0], [6, 0]], "A"),
      m("2", "b", "y", [[6, 4], [4, 6], [6, 4]], "A"),
    ];
    const t = levelingStandings(["a", "b", "x", "y"], matches);
    expect(t[0].pairId).toBe("a");
    expect(t[1].pairId).toBe("b");
    expect(t[1].tiebreak).toBe("SETS");
  });
});

describe("clasificación de grupo mensual", () => {
  it("el enfrentamiento directo va antes que los sets", () => {
    const matches = [
      m("1", "a", "b", [[7, 6], [7, 6]], "A"),
      m("2", "b", "c", [[6, 0], [6, 0]], "A"),
      m("3", "a", "c", [[6, 4], [3, 6], [2, 6]], "B"),
      m("4", "c", "d", [[6, 0], [6, 0]], "B"),
      m("5", "a", "d", [[6, 0], [6, 0]], "A"),
      m("6", "b", "d", [[6, 0], [6, 0]], "A"),
    ];
    const t = groupStandings(["a", "b", "c", "d"], matches);
    // a y b: 10 puntos; b tiene mejor diferencia de sets pero a ganó el directo.
    expect(t[0].pairId).toBe("a");
    expect(t[1].pairId).toBe("b");
  });
});

describe("zonas", () => {
  it("sin cupos no hay zonas", () => expect(zoneFor(1, 32, null)).toBeNull());
  it("ejemplo spec: 10 suben, 10 bajan de 32", () => {
    expect(zoneFor(8, 32, { up: 10, down: 10 })).toBe("UP");
    expect(zoneFor(22, 32, { up: 10, down: 10 })).toBe("STAY");
    expect(zoneFor(23, 32, { up: 10, down: 10 })).toBe("DOWN");
  });
});
