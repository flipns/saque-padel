import { describe, it, expect } from "vitest";
import { addDays, candidates, fmtMin, intersectIntervals, isoWeekday, normalizeSlots, validateSlots, type Slot } from "@/lib/availability";

const s = (weekday: number, from: string, to: string): Slot => {
  const m = (t: string) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
  return { weekday, startMin: m(from), endMin: m(to) };
};
const base = {
  fromDate: "2026-11-12", toDate: "2026-11-12",
  now: new Date("2026-11-06T08:00:00Z"), windowStart: new Date("2026-11-05T23:00:00Z"), windowEnd: new Date("2026-12-05T23:00:00Z"),
};
const THU = 4; // 12/11/2026 es jueves

describe("cruce de calendarios", () => {
  it("ejemplo del anexo: Carlos 18–22, Miguel 19–21, Sergio 18:30–21:30, David 19–20:45 → solo 19:00–20:30", () => {
    const c = candidates({ ...base, rules: [[s(THU, "18:00", "22:00")], [s(THU, "19:00", "21:00")], [s(THU, "18:30", "21:30")], [s(THU, "19:00", "20:45")]] });
    expect(c).toHaveLength(1);
    expect(c[0].startsAt).toBe("2026-11-12T18:00:00.000Z"); // 19:00 en Madrid (invierno, UTC+1)
    expect(c[0].endsAt).toBe("2026-11-12T19:30:00.000Z");   // 20:30
  });
  it("una ventana de 60 minutos no se ofrece como coincidencia completa", () => {
    const all = Array.from({ length: 4 }, () => [s(THU, "19:00", "20:00")]);
    expect(candidates({ ...base, rules: all })).toHaveLength(0);
  });
  it("sin información de un jugador no hay coincidencias (lo desconocido nunca es disponible)", () => {
    expect(candidates({ ...base, rules: [[s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], []] })).toHaveLength(0);
  });
  it("si un jugador no tiene franja ese día, no hay coincidencia ese día", () => {
    expect(candidates({ ...base, rules: [[s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [s(5, "18:00", "22:00")]] })).toHaveLength(0);
  });
  it("genera un inicio cada 30 minutos mientras quepan los 90 completos", () => {
    const all = Array.from({ length: 4 }, () => [s(THU, "18:00", "22:00")]);
    const starts = candidates({ ...base, rules: all }).map((c) => fmtMin(c.startMin));
    expect(starts).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00", "20:30"]);
  });
  it("no sugiere horarios pasados ni fuera del plazo de la fase", () => {
    const all = Array.from({ length: 4 }, () => [s(THU, "18:00", "22:00")]);
    const past = candidates({ ...base, now: new Date("2026-11-12T18:45:00Z"), rules: all }); // ya son las 19:45 en Madrid
    expect(past.map((c) => fmtMin(c.startMin))).toEqual(["20:00", "20:30"]);
    const late = candidates({ ...base, windowEnd: new Date("2026-11-12T19:30:00Z"), rules: all }); // la fase acaba a las 20:30 Madrid
    expect(late.map((c) => fmtMin(c.startMin))).toEqual(["18:00", "18:30", "19:00"]); // el último acaba a las 20:30
  });
  it("no sugiere horarios que pisan otro partido de las parejas, pero sí los contiguos", () => {
    const all = Array.from({ length: 4 }, () => [s(THU, "18:00", "22:00")]);
    const busy = [{ start: new Date("2026-11-12T19:00:00Z"), end: new Date("2026-11-12T20:30:00Z") }]; // 20:00–21:30 Madrid
    const starts = candidates({ ...base, rules: all, busy }).map((c) => fmtMin(c.startMin));
    // 18:30–20:00 acaba justo cuando empieza el otro partido (contiguo, vale); 19:00 y 19:30 ya lo pisarían
    expect(starts).toEqual(["18:00", "18:30"]);
  });
  it("excluye los horarios ya propuestos", () => {
    const all = Array.from({ length: 4 }, () => [s(THU, "18:00", "19:30")]);   // solo cabe un inicio: 18:00
    const c = candidates({ ...base, rules: all, exclude: new Set([Date.parse("2026-11-12T17:00:00Z")]) }); // 18:00 Madrid
    expect(c).toHaveLength(0);
  });
  it("respeta el cambio de hora: 19:00 en Madrid es 18:00Z en invierno y 17:00Z en verano", () => {
    const all = Array.from({ length: 4 }, () => [s(6, "19:00", "20:30"), s(7, "19:00", "20:30")]);
    const c = candidates({ ...base, now: new Date("2027-03-01T00:00:00Z"), windowStart: new Date("2027-03-01T00:00:00Z"), windowEnd: new Date("2027-04-30T00:00:00Z"), fromDate: "2027-03-27", toDate: "2027-03-28", rules: all });
    expect(c.map((x) => x.startsAt)).toEqual(["2027-03-27T18:00:00.000Z", "2027-03-28T17:00:00.000Z"]);
  });
  it("recorre varios días y respeta el día de la semana", () => {
    const all = Array.from({ length: 4 }, () => [s(1, "18:00", "19:30")]); // lunes
    const c = candidates({ ...base, fromDate: "2026-11-09", toDate: "2026-11-23", rules: all });
    expect(c.map((x) => x.date)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
  });
});

describe("franjas", () => {
  it("une las que se solapan o se tocan", () => {
    expect(normalizeSlots([s(1, "20:00", "22:00"), s(1, "18:00", "20:00"), s(1, "21:00", "23:00"), s(2, "10:00", "11:00")]))
      .toEqual([s(1, "18:00", "23:00"), s(2, "10:00", "11:00")]);
  });
  it("valida rangos y tramos de 30 minutos", () => {
    expect(validateSlots([s(1, "18:00", "22:00")])).toBeNull();
    expect(validateSlots([s(1, "22:00", "18:00")])).toMatch(/posterior/);
    expect(validateSlots([{ weekday: 1, startMin: 1085, endMin: 1200 }])).toMatch(/30 minutos/);
    expect(validateSlots([{ weekday: 9, startMin: 600, endMin: 660 }])).toMatch(/día/);
    expect(validateSlots([{ weekday: 1, startMin: 600, endMin: 1500 }])).toMatch(/24:00/);
  });
  it("intersecta intervalos y calcula fechas", () => {
    expect(intersectIntervals([[1080, 1320]], [[1140, 1260], [1290, 1400]])).toEqual([[1140, 1260], [1290, 1320]]);
    expect(isoWeekday("2026-11-06")).toBe(5);   // viernes (inicio de la liga)
    expect(isoWeekday("2026-11-08")).toBe(7);   // domingo
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(fmtMin(1440)).toBe("24:00");
  });
});
