import { describe, it, expect } from "vitest";
import { setWinner, validateScore, matchWinner, phasePoints } from "@/lib/engine";

describe("sets y marcador", () => {
  it("reconoce sets terminados e incompletos", () => {
    expect(setWinner({ a: 6, b: 4 })).toBe("A");
    expect(setWinner({ a: 7, b: 6 })).toBe("A");
    expect(setWinner({ a: 5, b: 7 })).toBe("B");
    expect(setWinner({ a: 6, b: 5 })).toBeNull();
    expect(setWinner({ a: 3, b: 5 })).toBeNull();
  });
  it("valida partido completo y por tiempo", () => {
    expect(validateScore([{ a: 6, b: 4 }, { a: 3, b: 6 }, { a: 6, b: 2 }], false)).toBeNull();
    expect(validateScore([{ a: 6, b: 4 }, { a: 3, b: 5 }], true)).toBeNull();
    expect(validateScore([{ a: 6, b: 4 }, { a: 3, b: 5 }], false)).toBe("NOT_FINISHED");
    expect(validateScore([{ a: 6, b: 4 }, { a: 6, b: 4 }, { a: 6, b: 4 }], false)).toBe("SET_AFTER_FINISH");
    expect(validateScore([{ a: 3, b: 5 }, { a: 6, b: 4 }], true)).toBe("INCOMPLETE_NOT_LAST");
  });
});

describe("ganador al agotar los 90 minutos (reglamento §10)", () => {
  it("gana quien lleva más sets", () => {
    expect(matchWinner([{ a: 6, b: 4 }, { a: 3, b: 5 }], true)).toBe("A");
  });
  it("con sets empatados, juegos del set en curso", () => {
    expect(matchWinner([{ a: 6, b: 4 }, { a: 3, b: 6 }, { a: 2, b: 4 }], true)).toBe("B");
  });
  it("si el set en curso va empatado, juegos totales", () => {
    expect(matchWinner([{ a: 6, b: 1 }, { a: 4, b: 6 }, { a: 3, b: 3 }], true)).toBe("A");
  });
  it("igualdad absoluta: resuelve la organización", () => {
    expect(matchWinner([{ a: 6, b: 4 }, { a: 4, b: 6 }, { a: 2, b: 2 }], true)).toBeNull();
  });
});

describe("puntos de fase 4/2/1", () => {
  it("victoria 4, derrota con set 2, sin set 1", () => {
    expect(phasePoints([{ a: 6, b: 4 }, { a: 3, b: 6 }, { a: 6, b: 2 }], "A")).toEqual({ a: 4, b: 2 });
    expect(phasePoints([{ a: 6, b: 4 }, { a: 6, b: 2 }], "A")).toEqual({ a: 4, b: 1 });
  });
  it("ejemplo §7: dos victorias y una derrota sin set suman 9; una victoria y dos derrotas con set suman 8", () => {
    expect(4 + 4 + 1).toBe(9);
    const v = phasePoints([{ a: 6, b: 0 }, { a: 6, b: 0 }], "A").a;
    const d = phasePoints([{ a: 6, b: 4 }, { a: 3, b: 6 }, { a: 2, b: 6 }], "B").a;
    expect(v + d + d).toBe(8);
  });
});
