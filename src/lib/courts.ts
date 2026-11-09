/** Pistas del club. Por defecto 10 («Pista 1» … «Pista 10»); el número se puede cambiar en Panel → Ajustes. */
export const DEFAULT_COURTS = 10;
export const MAX_COURTS = 30;

export const courtName = (n: number) => `Pista ${n}`;

export function courtOptions(count: number): string[] {
  const n = Math.max(1, Math.min(MAX_COURTS, Math.floor(count) || DEFAULT_COURTS));
  return Array.from({ length: n }, (_, i) => courtName(i + 1));
}

/** Devuelve la pista en su forma oficial («Pista 6») si es una de las del club; null si no lo es. Acepta «6» y «pista 6». */
export function parseCourt(input: string | null | undefined, count: number): string | null {
  const m = /^\s*(?:pista\s*)?(\d{1,2})\s*$/i.exec(input ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= Math.max(1, Math.min(MAX_COURTS, Math.floor(count) || DEFAULT_COURTS)) ? courtName(n) : null;
}

/** Opciones del desplegable. Si el partido ya tenía una pista escrita a mano que no está en la lista, se conserva para no perderla. */
export function optionsFor(current: string | null | undefined, count: number): string[] {
  const base = courtOptions(count);
  const cur = (current ?? "").trim();
  return cur && !base.includes(cur) ? [cur, ...base] : base;
}
