import { describe, it, expect } from "vitest";
import { COMMITTED_STATUSES, moveImpact } from "@/lib/engine";

describe("mover una pareja de grupo o de categoría", () => {
  it("sin partidos o solo con partidos sin resultado: se puede mover y se retiran los pendientes", () => {
    expect(moveImpact([])).toEqual({ committed: 0, open: 0, allowed: true });
    expect(moveImpact(["PENDING_SCHEDULE", "SCHEDULE_PROPOSED", "DATE_AGREED", "SCHEDULED", "RESCHEDULE_REQUESTED"])).toEqual({ committed: 0, open: 5, allowed: true });
  });
  it("un partido con fecha y pista aún no cuenta como resultado", () => {
    expect(moveImpact(["SCHEDULED"]).allowed).toBe(true);
  });
  it("con un solo partido con resultado no se puede mover, sea cual sea su estado", () => {
    for (const s of COMMITTED_STATUSES) expect(moveImpact(["PENDING_SCHEDULE", s]).allowed, s).toBe(false);
  });
  it("cuenta cuántos tienen resultado y cuántos se retirarían", () => {
    expect(moveImpact(["COMPLETED", "DISPUTED", "PENDING_SCHEDULE", "SCHEDULED"])).toEqual({ committed: 2, open: 2, allowed: false });
  });
  it("incluye los estados que dejan puntos o los pueden dejar: WO, no disputado y pendiente de confirmar", () => {
    expect([...COMMITTED_STATUSES].sort()).toEqual(["COMPLETED", "DISPUTED", "NOT_PLAYED", "PLAYED_PENDING_RESULT", "RESULT_PENDING_CONFIRMATION", "WO"]);
  });
});
