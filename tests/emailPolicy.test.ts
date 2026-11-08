import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EMAIL_KINDS, isEmailKind } from "@/lib/emailPolicy";

describe("qué avisos se envían por email", () => {
  it("solo fechas propuestas, fecha aceptada y resultado introducido", () => {
    expect([...EMAIL_KINDS].sort()).toEqual(["DATES_PROPOSED", "DATE_AGREED", "RESULT_SUBMITTED"]);
    expect(isEmailKind("DATES_PROPOSED")).toBe(true);
    expect(isEmailKind("DATE_AGREED")).toBe(true);
    expect(isEmailKind("RESULT_SUBMITTED")).toBe(true);
  });
  it("el resto de avisos NO se envían por email, solo se ven en la web", () => {
    for (const k of [
      "DATES_REJECTED", "RESCHEDULE_REQUESTED", "BOOKED", "COURT_CHANGED",
      "RESULT_CONFIRMED", "RESULT_DISPUTED", "RESULT_WITHDRAWN", "RESULT_AUTO_CONFIRMED", "ADMIN_RESULT",
      "CHAT_MESSAGE", "CHAT_ORG", "REMINDER_NO_RESPONSE", "PHASE_PUBLISHED",
      "GROUP_CHANGED", "GROUP_NEW_RIVAL", "MATCH_CANCELLED", "CATEGORY_CHANGED",
      "AVAILABILITY_FILLED", "AVAILABILITY_CONFLICT", "AVAILABILITY_REQUEST",
    ]) expect(isEmailKind(k), k).toBe(false);
  });
  it("la lista del código coincide con la de la base de datos (migración 0012)", () => {
    const sql = readFileSync("supabase/migrations/0012_email_policy.sql", "utf8");
    const m = sql.match(/select array\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const inDb = m![1].split(",").map((x) => x.trim().replace(/'/g, "")).sort();
    expect(inDb).toEqual([...EMAIL_KINDS].sort());
  });
});
