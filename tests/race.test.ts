import { describe, it, expect } from "vitest";
import { racePointsMilli, raceTotal, milliToNumber, formatRace } from "@/lib/engine";

describe("Race (§9)", () => {
  it("tabla de coeficientes A–G", () => {
    expect(milliToNumber(racePointsMilli(2, 1))).toBe(71.25);
    expect(milliToNumber(racePointsMilli(4, 6))).toBe(17.5);
    expect(() => racePointsMilli(1, 7)).toThrow(/coeficiente/);
  });
  it("ejemplo sin cambio de categoría: 310", () => {
    const r = raceTotal(
      [
        { phaseId: "feb", position: 1, groupIndex: 2, categoryLevel: 2 },
        { phaseId: "mar", position: 1, groupIndex: 1, categoryLevel: 2 },
        { phaseId: "abr", position: 3, groupIndex: 0, categoryLevel: 2 },
        { phaseId: "may", position: 2, groupIndex: 0, categoryLevel: 2 },
      ],
      2
    );
    expect(milliToNumber(r.totalMilli)).toBe(310);
  });
  it("ejemplo §9.2: puntos de Silver al 50 % para la Race Gold = 265", () => {
    const r = raceTotal(
      [
        { phaseId: "feb", position: 1, groupIndex: 2, categoryLevel: 3 },
        { phaseId: "mar", position: 1, groupIndex: 1, categoryLevel: 2 },
        { phaseId: "abr", position: 3, groupIndex: 0, categoryLevel: 2 },
        { phaseId: "may", position: 2, groupIndex: 0, categoryLevel: 2 },
      ],
      2
    );
    expect(milliToNumber(r.totalMilli)).toBe(265);
  });
  it("ejemplo integrado §17: 360 y sanción sin saldo negativo", () => {
    const res = [
      { phaseId: "feb", position: 1, groupIndex: 2, categoryLevel: 3 },
      { phaseId: "mar", position: 1, groupIndex: 1, categoryLevel: 3 },
      { phaseId: "abr", position: 2, groupIndex: 0, categoryLevel: 3 },
      { phaseId: "may", position: 1, groupIndex: 0, categoryLevel: 3 },
    ];
    expect(milliToNumber(raceTotal(res, 3).totalMilli)).toBe(360);
    expect(raceTotal([{ phaseId: "feb", position: 4, groupIndex: 6, categoryLevel: 1 }], 1, 50_000).totalMilli).toBe(0);
  });
  it("formato con dos decimales como máximo", () => expect(formatRace(racePointsMilli(2, 1) / 2)).toBe("35,63"));
});
