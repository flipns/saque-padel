import { describe, it, expect } from "vitest";
import { matchRankingDelta, movementBonus, replayRanking, type RankingEvent } from "@/lib/engine";

describe("ranking por partido (§8.2)", () => {
  it("ejemplo del reglamento: medias 1.020 vs 1.240, gana la inferior => +15 / −10", () => {
    expect(matchRankingDelta(1020, 1240)).toMatchObject({ winner: 15, loser: -10, case: "UPSET", diff: 220 });
  });
  it("igualado, sorpresa grande y favorito", () => {
    expect(matchRankingDelta(1000, 1100)).toMatchObject({ winner: 10, loser: -5 });
    expect(matchRankingDelta(1000, 1300)).toMatchObject({ winner: 20, loser: -15 });
    expect(matchRankingDelta(1300, 1000)).toMatchObject({ winner: 7, loser: -3 });
    expect(matchRankingDelta(1149, 1000)).toMatchObject({ case: "EVEN" });
    expect(matchRankingDelta(1150, 1000)).toMatchObject({ case: "FAVOURITE" });
  });
});

describe("bonus por movimientos (§8.3)", () => {
  it("categoría sustituye a grupo, nunca se acumulan", () => {
    expect(movementBonus({ categoryChange: 1, groupChange: 1 }).points).toBe(50);
    expect(movementBonus({ categoryChange: -1, groupChange: -1 }).points).toBe(-50);
    expect(movementBonus({ categoryChange: 0, groupChange: 1 }).points).toBe(15);
    expect(movementBonus({ categoryChange: 0, groupChange: 0 }).points).toBe(0);
  });
});

describe("recalculado cronológico", () => {
  it("ejemplo completo: 1.000 + 65 + 50 = 1.115; +25 + 15 = 1.155", () => {
    const ev: RankingEvent[] = [
      { kind: "INITIAL", at: "2026-11-01", playerId: "j", points: 1000, key: "init" },
      { kind: "ADJUSTMENT", at: "2026-12-01", playerId: "j", points: 65, reason: "netos nivelación (simulado)", key: "n" },
      { kind: "BONUS", at: "2027-02-01", playerIds: ["j"], movement: "CATEGORY_UP", points: 50, key: "b1" },
      { kind: "ADJUSTMENT", at: "2027-02-20", playerId: "j", points: 25, reason: "netos febrero (simulado)", key: "f" },
      { kind: "BONUS", at: "2027-03-01", playerIds: ["j"], movement: "GROUP_UP", points: 15, key: "b2" },
    ];
    const { balances } = replayRanking(ev);
    expect(balances.get("j")).toBe(1155);
  });
  it("usa la media prepartido y no duplica eventos repetidos", () => {
    const ev: RankingEvent[] = [
      { kind: "INITIAL", at: "0", playerId: "a1", points: 1000, key: "i1" },
      { kind: "INITIAL", at: "0", playerId: "a2", points: 1040, key: "i2" },
      { kind: "INITIAL", at: "0", playerId: "b1", points: 1220, key: "i3" },
      { kind: "INITIAL", at: "0", playerId: "b2", points: 1260, key: "i4" },
      { kind: "MATCH", at: "1", matchId: "m1", winners: ["a1", "a2"], losers: ["b1", "b2"], key: "m1" },
      { kind: "MATCH", at: "1", matchId: "m1", winners: ["a1", "a2"], losers: ["b1", "b2"], key: "m1" },
    ];
    const { balances } = replayRanking(ev);
    expect(balances.get("a1")).toBe(1015);
    expect(balances.get("b2")).toBe(1250);
  });
});
