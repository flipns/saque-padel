import { describe, it, expect } from "vitest";
import { buildShareText, dayLabel, filterUpcoming, groupByDay, isUpcoming, whatsappUrl, type ShareMatch } from "@/lib/share";

const m = (startsAt: string, category: string, a: string, b: string, court: string | null = "Pista 8"): ShareMatch => ({ startsAt, court, category, a, b });
const NOW = new Date("2026-11-10T10:00:00Z");   // martes 10/11/2026, 11:00 en Madrid

const sample = [
  m("2026-11-16T17:00:00Z", "Plata femenina", "Ana Arias Barra / Silvia Acosta", "Carmen Trancón Romero / Eva María Martín Narganes", "Pista 2"),   // lun 16, 18:00
  m("2026-11-12T19:00:00Z", "Rookie masculina", "Iván Meléndez Pérez / Wilson Andrés Cuéllar Joven", "Daniel Matellanes Lazo / Fernando Franco Vázquez", "Pista 8"), // jue 12, 20:00
  m("2026-11-13T18:00:00Z", "Plata masculina", "Jorge Sánchez / David Cuadrado", "Nuño Bermejo / Hugo Fernández", "pista 9"),              // vie 13, 19:00
  m("2026-11-12T18:00:00Z", "Oro masculina", "A / B", "C / D", "Pista 1"),                                                                   // jue 12, 19:00
];

describe("próximos partidos", () => {
  it("se ordenan del más cercano al más lejano", () => {
    const r = filterUpcoming(sample, NOW, null);
    expect(r.map((x) => x.category)).toEqual(["Oro masculina", "Rookie masculina", "Plata masculina", "Plata femenina"]);
  });
  it("no salen los que ya han acabado, pero sí el que se está jugando", () => {
    const list = [m("2026-11-10T08:00:00Z", "Pasado", "A", "B"), m("2026-11-10T09:00:00Z", "Jugándose", "C", "D"), m("2026-11-10T12:00:00Z", "Futuro", "E", "F")];
    expect(filterUpcoming(list, NOW, null).map((x) => x.category)).toEqual(["Jugándose", "Futuro"]);   // el de las 10:00 UTC acaba a las 10:30
    expect(isUpcoming("2026-11-10T08:29:00Z", NOW)).toBe(false);
    expect(isUpcoming("2026-11-10T08:31:00Z", NOW)).toBe(true);
  });
  it("«próximos N días» cuenta por días de Madrid, incluido hoy", () => {
    expect(filterUpcoming(sample, NOW, 3).map((x) => x.category)).toEqual(["Oro masculina", "Rookie masculina"]);              // hoy 10, 11 y 12
    expect(filterUpcoming(sample, NOW, 4).map((x) => x.category)).toEqual(["Oro masculina", "Rookie masculina", "Plata masculina"]); // hasta el 13
    expect(filterUpcoming(sample, NOW, 7).length).toBe(4);
  });
  it("un partido a las 23:30 de Madrid cuenta en su día aunque en UTC sea el siguiente… o el anterior", () => {
    const late = m("2026-11-12T22:30:00Z", "Tarde", "A", "B");   // 23:30 en Madrid del 12/11
    const early = m("2026-11-13T23:30:00Z", "Madrugada", "C", "D"); // 00:30 del 14/11 en Madrid
    expect(filterUpcoming([late, early], NOW, 3).map((x) => x.category)).toEqual(["Tarde"]);
    expect(filterUpcoming([late, early], NOW, 5).map((x) => x.category)).toEqual(["Tarde", "Madrugada"]);
  });
  it("agrupa por día", () => {
    const g = groupByDay(filterUpcoming(sample, NOW, null));
    expect(g.map((x) => [x.date, x.items.length])).toEqual([["2026-11-12", 2], ["2026-11-13", 1], ["2026-11-16", 1]]);
  });
  it("da el día en español con mayúscula inicial", () => {
    expect(dayLabel("2026-11-12")).toBe("Jueves 12 de noviembre");
    expect(dayLabel("2026-12-01")).toBe("Martes 1 de diciembre");
  });
});

describe("texto para compartir", () => {
  const text = buildShareText(filterUpcoming(sample, NOW, null));
  it("lleva título, días, hora, pista, categoría y las dos parejas", () => {
    expect(text).toContain("*SAQUE LEAGUE · Próximos partidos*");
    expect(text).toContain("*Jueves 12 de noviembre*");
    expect(text).toContain("⏰ 20:00 · Pista 8 · Rookie masculina\nIván Meléndez Pérez / Wilson Andrés Cuéllar Joven\nvs\nDaniel Matellanes Lazo / Fernando Franco Vázquez");
    expect(text).toContain("*Lunes 16 de noviembre*");
  });
  it("sigue el orden de fechas y horas", () => {
    expect(text.indexOf("19:00 · Pista 1")).toBeLessThan(text.indexOf("20:00 · Pista 8"));
    expect(text.indexOf("Jueves 12")).toBeLessThan(text.indexOf("Viernes 13"));
    expect(text.indexOf("Viernes 13")).toBeLessThan(text.indexOf("Lunes 16"));
  });
  it("pone la pista con mayúscula aunque se escribiera a mano en minúscula", () => {
    expect(text).toContain("⏰ 19:00 · Pista 9 · Plata masculina");
  });
  it("incluye el mensaje final y las horas son de Madrid", () => {
    expect(text.trim().endsWith("¡Pásate por el club a ver jugar la liga y a tomar algo!")).toBe(true);
    expect(buildShareText([m("2027-04-10T17:00:00Z", "X", "A", "B")])).toContain("⏰ 19:00");   // verano: UTC+2
  });
  it("sin partidos, un mensaje corto en lugar de uno vacío", () => {
    const t = buildShareText([], { emptyText: "Esta semana no hay partidos programados." });
    expect(t).toContain("Esta semana no hay partidos programados.");
    expect(t).not.toContain("⏰");
  });
  it("sin pista no deja un hueco raro", () => {
    expect(buildShareText([m("2026-11-12T19:00:00Z", "Cat", "A", "B", null)])).toContain("⏰ 20:00 · Cat\nA\nvs\nB");
  });
  it("el enlace de WhatsApp lleva el texto codificado", () => {
    const u = whatsappUrl("Hola ñ\n*x*");
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(u.split("text=")[1])).toBe("Hola ñ\n*x*");
  });
});
