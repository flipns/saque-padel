import { describe, it, expect } from "vitest";
import { courtOptions, optionsFor, parseCourt } from "@/lib/courts";

describe("pistas del club", () => {
  it("por defecto hay 10 pistas, de la 1 a la 10", () => {
    const o = courtOptions(10);
    expect(o).toHaveLength(10);
    expect(o[0]).toBe("Pista 1"); expect(o[9]).toBe("Pista 10");
  });
  it("el número de pistas es configurable y está acotado", () => {
    expect(courtOptions(4)).toEqual(["Pista 1", "Pista 2", "Pista 3", "Pista 4"]);
    expect(courtOptions(0)).toHaveLength(10);     // valor no válido → por defecto
    expect(courtOptions(999)).toHaveLength(30);   // máximo
  });
  it("valida la pista elegida y la deja en su forma oficial", () => {
    expect(parseCourt("Pista 6", 10)).toBe("Pista 6");
    expect(parseCourt("pista 6", 10)).toBe("Pista 6");
    expect(parseCourt("6", 10)).toBe("Pista 6");
    expect(parseCourt("Pista 10", 10)).toBe("Pista 10");
  });
  it("rechaza pistas que no existen o texto libre", () => {
    expect(parseCourt("Pista 11", 10)).toBeNull();
    expect(parseCourt("Pista 0", 10)).toBeNull();
    expect(parseCourt("central", 10)).toBeNull();
    expect(parseCourt("", 10)).toBeNull();
    expect(parseCourt(null, 10)).toBeNull();
    expect(parseCourt("Pista 11", 12)).toBe("Pista 11");   // si el club tuviera 12, sí existiría
  });
  it("conserva una pista antigua escrita a mano para no perderla al editar", () => {
    expect(optionsFor("Pista 4", 10)).toHaveLength(10);
    expect(optionsFor("Pista central", 10)[0]).toBe("Pista central");
    expect(optionsFor(null, 10)).toHaveLength(10);
  });
});
