import { describe, it, expect } from "vitest";
import { parseCategory, normalizePhone, parseFormRows } from "@/lib/engine";

describe("importación del Google Form", () => {
  it("reconoce las 8 categorías y la errata del Form", () => {
    expect(parseCategory("Brlonce Femenina")).toEqual({ division: "FEMENINA", level: "BRONCE" });
    expect(parseCategory("Premier Masculina")).toEqual({ division: "MASCULINA", level: "PREMIER" });
    expect(parseCategory("Oro Femenina")).toEqual({ division: "FEMENINA", level: "ORO" });
    expect(parseCategory("Rookie Masculina")).toEqual({ division: "MASCULINA", level: "ROOKIE" });
  });
  it("normaliza móviles", () => {
    expect(normalizePhone("612 34 56 78")).toBe("+34612345678");
    expect(normalizePhone("+34 612345678")).toBe("+34612345678");
    expect(normalizePhone("0034612345678")).toBe("+34612345678");
  });
  it("lee columnas duplicadas por posición, detecta duplicados y jugadores repetidos", () => {
    const table = [
      ["Marca temporal", "Dirección de correo electrónico", "Categoría", "Nombre y apellidos", "Móvil de contacto", "Nombre y apellidos", "Móvil de contacto"],
      ["30/10/2026 10:00", "Ana@x.com", "Oro Femenina", "ana garcía", "611111111", "lucía pérez", "622222222"],
      ["31/10/2026 10:00", "ana@x.com", "Oro Femenina", "Lucía Pérez", "622222222", "Ana García", "611111111"],
      ["31/10/2026 11:00", "pepe@x.com", "Plata Masculina", "Pepe Ruiz", "633333333", "Juan Gil", "644444444"],
      ["31/10/2026 12:00", "otro@x.com", "Plata Masculina", "Pepe Ruiz", "633333333", "Luis Mas", "655555555"],
    ];
    const { rows, headerIssues } = parseFormRows(table);
    expect(headerIssues).toEqual([]);
    expect(rows[0].email).toBe("ana@x.com");
    expect(rows[0].player1.name).toBe("Ana García");
    expect(rows[0].duplicateOf).toBe(3);
    expect(rows[3].issues.some((i) => i.includes("ya aparece"))).toBe(true);
  });
});
