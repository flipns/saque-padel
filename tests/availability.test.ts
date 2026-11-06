import { describe, it, expect } from "vitest";
import {
  addDays, candidates, classifyAt, dayIntervals, fmtMin, hasAvailability, intersectIntervals, isoWeekday, normalizeExceptions,
  normalizeSlots, rankCandidates, validateExceptions, validateSlots, type Exception, type PlayerCalendar, type Slot,
} from "@/lib/availability";

const m = (t: string) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
const s = (weekday: number, from: string, to: string, preferred = false): Slot => ({ weekday, startMin: m(from), endMin: m(to), preferred });
const ex = (date: string, from: string, to: string, status: Exception["status"], preferred = false): Exception => ({ date, startMin: m(from), endMin: m(to), status, preferred });
const cal = (id: string, slots: Slot[] = [], exceptions: Exception[] = []): PlayerCalendar => ({ id, slots, exceptions });
const base = {
  fromDate: "2026-11-12", toDate: "2026-11-12",
  now: new Date("2026-11-06T08:00:00Z"), windowStart: new Date("2026-11-05T23:00:00Z"), windowEnd: new Date("2026-12-05T23:00:00Z"),
};
const THU = 4, D = "2026-11-12"; // 12/11/2026 es jueves
const four = (a: Slot[], b: Slot[], c: Slot[], d: Slot[]) => [cal("A", a), cal("B", b), cal("C", c), cal("D", d)];
const starts = (list: ReturnType<typeof candidates>) => list.map((c) => fmtMin(c.startMin));

describe("cruce 4/4", () => {
  it("ejemplo del anexo: Carlos 18–22, Miguel 19–21, Sergio 18:30–21:30, David 19–20:45 → solo 19:00–20:30", () => {
    const c = candidates({ ...base, includeThree: false, players: four([s(THU, "18:00", "22:00")], [s(THU, "19:00", "21:00")], [s(THU, "18:30", "21:30")], [s(THU, "19:00", "20:45")]) });
    expect(c).toHaveLength(1);
    expect(c[0].startsAt).toBe("2026-11-12T18:00:00.000Z"); // 19:00 en Madrid (invierno, UTC+1)
    expect(c[0].endsAt).toBe("2026-11-12T19:30:00.000Z");   // 20:30
    expect(c[0].level).toBe(4);
  });
  it("una ventana de 60 minutos no se ofrece como coincidencia completa", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(THU, "19:00", "20:00")]) as [Slot[], Slot[], Slot[], Slot[]]);
    expect(candidates({ ...base, players: all })).toHaveLength(0);
  });
  it("genera un inicio cada 30 minutos mientras quepan los 90 completos", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(THU, "18:00", "22:00")]) as [Slot[], Slot[], Slot[], Slot[]]);
    expect(starts(candidates({ ...base, players: all }))).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00", "20:30"]);
  });
  it("no sugiere horarios pasados ni fuera del plazo de la fase", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(THU, "18:00", "22:00")]) as [Slot[], Slot[], Slot[], Slot[]]);
    expect(starts(candidates({ ...base, now: new Date("2026-11-12T18:45:00Z"), players: all }))).toEqual(["20:00", "20:30"]);          // ya son las 19:45 en Madrid
    expect(starts(candidates({ ...base, windowEnd: new Date("2026-11-12T19:30:00Z"), players: all }))).toEqual(["18:00", "18:30", "19:00"]); // la fase acaba a las 20:30
  });
  it("no sugiere horarios que pisan otro partido de las parejas, pero sí los contiguos", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(THU, "18:00", "22:00")]) as [Slot[], Slot[], Slot[], Slot[]]);
    const busy = [{ start: new Date("2026-11-12T19:00:00Z"), end: new Date("2026-11-12T20:30:00Z") }]; // 20:00–21:30 Madrid
    expect(starts(candidates({ ...base, players: all, busy }))).toEqual(["18:00", "18:30"]); // 18:30–20:00 acaba justo cuando empieza el otro
  });
  it("excluye los horarios ya propuestos", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(THU, "18:00", "19:30")]) as [Slot[], Slot[], Slot[], Slot[]]);
    expect(candidates({ ...base, players: all, exclude: new Set([Date.parse("2026-11-12T17:00:00Z")]) })).toHaveLength(0);
  });
  it("respeta el cambio de hora: 19:00 en Madrid es 18:00Z en invierno y 17:00Z en verano", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(6, "19:00", "20:30"), s(7, "19:00", "20:30")]) as [Slot[], Slot[], Slot[], Slot[]]);
    const c = candidates({ ...base, now: new Date("2027-03-01T00:00:00Z"), windowStart: new Date("2027-03-01T00:00:00Z"), windowEnd: new Date("2027-04-30T00:00:00Z"), fromDate: "2027-03-27", toDate: "2027-03-28", players: all });
    expect(c.map((x) => x.startsAt)).toEqual(["2027-03-27T18:00:00.000Z", "2027-03-28T17:00:00.000Z"]);
  });
  it("recorre varios días y respeta el día de la semana", () => {
    const all = four(...Array.from({ length: 4 }, () => [s(1, "18:00", "19:30")]) as [Slot[], Slot[], Slot[], Slot[]]);
    expect(candidates({ ...base, fromDate: "2026-11-09", toDate: "2026-11-23", players: all }).map((x) => x.date)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
  });
  it("con menos o más de cuatro jugadores no hay cruce", () => {
    expect(candidates({ ...base, players: [cal("A", [s(THU, "18:00", "22:00")])] })).toHaveLength(0);
  });
});

describe("nivel 3 de 4 (alternativa a consultar)", () => {
  it("tres disponibles y el cuarto sin información → 3/4, nunca 4/4", () => {
    const c = candidates({ ...base, players: four([s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], []) });
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.level === 3 && x.unknownId === "D")).toBe(true);
    expect(candidates({ ...base, includeThree: false, players: four([s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], []) })).toHaveLength(0);
  });
  it("en el ejemplo del anexo, 19:30 es una alternativa 3/4 porque a David le falta confirmar", () => {
    const c = candidates({ ...base, players: four([s(THU, "18:00", "22:00")], [s(THU, "19:00", "21:00")], [s(THU, "18:30", "21:30")], [s(THU, "19:00", "20:45")]) });
    const three = c.filter((x) => x.level === 3);
    expect(three.map((x) => fmtMin(x.startMin))).toEqual(["19:30"]);
    expect(three[0].unknownId).toBe("D");
    expect(c.filter((x) => x.level === 4).map((x) => fmtMin(x.startMin))).toEqual(["19:00"]);
  });
  it("dos sin información no dan ni 3/4", () => {
    expect(candidates({ ...base, players: four([s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [], []) })).toHaveLength(0);
  });
  it("si el cuarto ha marcado que NO puede, ese horario no se ofrece ni como 3/4", () => {
    const c = candidates({ ...base, players: [cal("A", [s(THU, "18:00", "22:00")]), cal("B", [s(THU, "18:00", "22:00")]), cal("C", [s(THU, "18:00", "22:00")]), cal("D", [], [ex(D, "18:00", "22:00", "UNAVAILABLE")])] });
    expect(c).toHaveLength(0);
  });
});

describe("excepciones y preferencias", () => {
  const all = (e: Exception[] = [], pref = false) => [cal("A", [s(THU, "18:00", "22:00", pref)]), cal("B", [s(THU, "18:00", "22:00", pref)]), cal("C", [s(THU, "18:00", "22:00", pref)]), cal("D", [s(THU, "18:00", "22:00", pref)], e)];
  it("un bloqueo explícito gana a la pauta semanal (CA-DISP-02)", () => {
    expect(starts(candidates({ ...base, players: all([ex(D, "20:00", "22:00", "UNAVAILABLE")]) }))).toEqual(["18:00", "18:30"]);
    expect(candidates({ ...base, players: all([ex(D, "00:00", "24:00", "UNAVAILABLE")]) })).toHaveLength(0);
  });
  it("el bloqueo de una fecha no afecta a las demás", () => {
    expect(candidates({ ...base, toDate: "2026-11-19", players: all([ex(D, "00:00", "24:00", "UNAVAILABLE")]) }).map((c) => c.date)).toEqual(Array(6).fill("2026-11-19"));
  });
  it("la disponibilidad extra añade horarios que la pauta semanal no tenía", () => {
    const p = [cal("A", [s(THU, "18:00", "22:00")]), cal("B", [s(THU, "18:00", "22:00")]), cal("C", [s(THU, "18:00", "22:00")]), cal("D", [], [ex(D, "19:00", "21:00", "AVAILABLE")])];
    expect(starts(candidates({ ...base, players: p, includeThree: false }))).toEqual(["19:00", "19:30"]);
  });
  it("un bloqueo gana también a la disponibilidad extra", () => {
    const p = [cal("A", [s(THU, "18:00", "22:00")]), cal("B", [s(THU, "18:00", "22:00")]), cal("C", [s(THU, "18:00", "22:00")]), cal("D", [], [ex(D, "19:00", "21:00", "AVAILABLE"), ex(D, "20:00", "21:00", "UNAVAILABLE")])];
    expect(candidates({ ...base, players: p, includeThree: false })).toHaveLength(0);
  });
  it("cuenta cuántos jugadores tienen el horario como preferente", () => {
    const p = [cal("A", [s(THU, "18:00", "22:00", true)]), cal("B", [s(THU, "18:00", "22:00", true)]), cal("C", [s(THU, "18:00", "22:00")]), cal("D", [s(THU, "18:00", "22:00")])];
    expect(candidates({ ...base, players: p }).every((c) => c.preferredBy === 2)).toBe(true);
    const mixed = [cal("A", [s(THU, "18:00", "22:00"), s(THU, "19:00", "21:00", true)]), cal("B", [s(THU, "18:00", "22:00")]), cal("C", [s(THU, "18:00", "22:00")]), cal("D", [s(THU, "18:00", "22:00")])];
    const by = Object.fromEntries(candidates({ ...base, players: mixed }).map((c) => [fmtMin(c.startMin), c.preferredBy]));
    expect(by["19:00"]).toBe(1); expect(by["18:00"]).toBe(0); expect(by["20:30"]).toBe(0);   // 19:00–20:30 cabe entero en 19:00–21:00
  });
  it("orden: los 4/4 antes que los 3/4; con más preferencias primero; luego los más próximos", () => {
    const four4 = candidates({ ...base, toDate: "2026-11-19", players: [cal("A", [s(THU, "18:00", "19:30"), s(THU, "20:00", "21:30", true)]), cal("B", [s(THU, "18:00", "19:30"), s(THU, "20:00", "21:30", true)]), cal("C", [s(THU, "18:00", "19:30"), s(THU, "20:00", "21:30")]), cal("D", [s(THU, "18:00", "19:30"), s(THU, "20:00", "21:30")])] });
    const ranked = rankCandidates(four4);
    expect(ranked.map((c) => `${c.date} ${fmtMin(c.startMin)} ${c.preferredBy}`)).toEqual(["2026-11-12 20:00 2", "2026-11-19 20:00 2", "2026-11-12 18:00 0", "2026-11-19 18:00 0"]);
    const mixed = rankCandidates([...candidates({ ...base, players: four([s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], [s(THU, "18:00", "22:00")], []) }), ...four4.slice(0, 1)]);
    expect(mixed[0].level).toBe(4);
    expect(mixed.slice(1).every((c) => c.level === 3)).toBe(true);
  });
  it("hasAvailability: solo cuenta lo que dice cuándo PUEDE jugar", () => {
    expect(hasAvailability(cal("A"))).toBe(false);
    expect(hasAvailability(cal("A", [], [ex(D, "00:00", "24:00", "UNAVAILABLE")]))).toBe(false);
    expect(hasAvailability(cal("A", [], [ex(D, "19:00", "21:00", "AVAILABLE")]))).toBe(true);
    expect(hasAvailability(cal("A", [s(1, "18:00", "20:00")]))).toBe(true);
  });
  it("dayIntervals combina pauta, extra y bloqueos", () => {
    const d = dayIntervals(cal("A", [s(THU, "18:00", "22:00", true)], [ex(D, "21:00", "23:00", "AVAILABLE"), ex(D, "19:00", "19:30", "UNAVAILABLE")]), D);
    expect(d.avail).toEqual([[m("18:00"), m("19:00")], [m("19:30"), m("23:00")]]);
    expect(d.pref).toEqual([[m("18:00"), m("19:00")], [m("19:30"), m("22:00")]]);
    expect(d.blocked).toEqual([[m("19:00"), m("19:30")]]);
  });
});

describe("clasificar un horario ya propuesto", () => {
  const p = [cal("A", [s(THU, "18:00", "22:00")]), cal("B", [s(THU, "18:00", "22:00")]), cal("C", [s(THU, "18:00", "22:00")]), cal("D", [s(THU, "19:00", "21:00")])];
  it("4/4 si encaja con los cuatro", () => expect(classifyAt(p, D, m("19:00"))).toMatchObject({ level: 4, conflict: false }));
  it("3/4 si a una persona no le consta", () => expect(classifyAt(p, D, m("20:30"))).toMatchObject({ level: 3, conflict: false, unknownId: "D" }));
  it("conflicto si alguien ha bloqueado ese horario", () => {
    const blocked = [...p.slice(0, 3), cal("D", [s(THU, "19:00", "21:00")], [ex(D, "19:00", "20:00", "UNAVAILABLE")])];
    expect(classifyAt(blocked, D, m("19:00"))).toMatchObject({ level: 0, conflict: true });
  });
  it("sin disponibilidad completa si faltan datos de varios", () => expect(classifyAt(p, D, m("08:00"))).toMatchObject({ level: 0, conflict: false }));
});

describe("franjas y excepciones", () => {
  it("une las del mismo tipo que se solapan o se tocan, y deja solapar una preferente con una normal", () => {
    expect(normalizeSlots([s(1, "20:00", "22:00"), s(1, "18:00", "20:00"), s(1, "21:00", "23:00"), s(2, "10:00", "11:00")])).toEqual([s(1, "18:00", "23:00"), s(2, "10:00", "11:00")]);
    expect(normalizeSlots([s(1, "18:00", "22:00"), s(1, "19:00", "21:00", true)])).toEqual([s(1, "18:00", "22:00"), s(1, "19:00", "21:00", true)]);
    expect(normalizeSlots([s(1, "19:00", "20:00", true), s(1, "20:00", "21:00", true)])).toEqual([s(1, "19:00", "21:00", true)]);
  });
  it("valida rangos y tramos de 30 minutos", () => {
    expect(validateSlots([s(1, "18:00", "22:00")])).toBeNull();
    expect(validateSlots([s(1, "22:00", "18:00")])).toMatch(/posterior/);
    expect(validateSlots([{ weekday: 1, startMin: 1085, endMin: 1200 }])).toMatch(/30 minutos/);
    expect(validateSlots([{ weekday: 9, startMin: 600, endMin: 660 }])).toMatch(/día/);
    expect(validateSlots([{ weekday: 1, startMin: 600, endMin: 1500 }])).toMatch(/24:00/);
  });
  it("une excepciones del mismo día y estado, pero no mezcla estados", () => {
    const n = normalizeExceptions([ex(D, "18:00", "20:00", "UNAVAILABLE"), ex(D, "19:00", "21:00", "UNAVAILABLE"), ex(D, "19:00", "21:00", "AVAILABLE"), ex("2026-11-13", "00:00", "24:00", "UNAVAILABLE")]);
    expect(n.map((e) => `${e.date} ${e.status} ${fmtMin(e.startMin)}-${fmtMin(e.endMin)}`)).toEqual([
      "2026-11-12 UNAVAILABLE 18:00-21:00", "2026-11-12 AVAILABLE 19:00-21:00", "2026-11-13 UNAVAILABLE 00:00-24:00",
    ]);
  });
  it("valida excepciones: fechas pasadas o lejanas, preferente en bloqueo, nota larga, horas", () => {
    const today = "2026-11-06";
    expect(validateExceptions([ex("2026-11-12", "00:00", "24:00", "UNAVAILABLE")], today)).toBeNull();
    expect(validateExceptions([ex("2026-11-05", "00:00", "24:00", "UNAVAILABLE")], today)).toMatch(/pasadas/);
    expect(validateExceptions([ex("2027-12-01", "00:00", "24:00", "UNAVAILABLE")], today)).toMatch(/150/);
    expect(validateExceptions([{ ...ex("2026-11-12", "10:00", "12:00", "UNAVAILABLE"), preferred: true }], today)).toMatch(/preferente/);
    expect(validateExceptions([{ ...ex("2026-11-12", "10:00", "12:00", "UNAVAILABLE"), note: "x".repeat(81) }], today)).toMatch(/80/);
    expect(validateExceptions([ex("2026-11-12", "12:00", "10:00", "UNAVAILABLE")], today)).toMatch(/posterior/);
    expect(validateExceptions([{ ...ex("2026-11-12", "10:00", "12:00", "UNAVAILABLE"), date: "mañana" }], today)).toMatch(/fecha/);
  });
  it("intersecta intervalos y calcula fechas", () => {
    expect(intersectIntervals([[1080, 1320]], [[1140, 1260], [1290, 1400]])).toEqual([[1140, 1260], [1290, 1320]]);
    expect(isoWeekday("2026-11-06")).toBe(5);   // viernes (inicio de la liga)
    expect(isoWeekday("2026-11-08")).toBe(7);   // domingo
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(fmtMin(1440)).toBe("24:00");
  });
});
