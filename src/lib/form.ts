import type { SetScore } from "@/lib/engine";

/** Lee hasta tres sets de un formulario (campos s1a, s1b, s2a, s2b, s3a, s3b). Ignora filas vacías. */
export function parseSets(form: FormData, prefix = ""): SetScore[] {
  const sets: SetScore[] = [];
  for (let i = 1; i <= 3; i++) {
    const a = String(form.get(`${prefix}s${i}a`) ?? "").trim();
    const b = String(form.get(`${prefix}s${i}b`) ?? "").trim();
    if (a === "" && b === "") continue;
    if (a === "" || b === "") throw new Error(`Completa los dos valores del set ${i}.`);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) throw new Error(`El set ${i} solo admite números.`);
    sets.push({ a: Number(a), b: Number(b) });
  }
  return sets;
}

export const SCORE_ERRORS: Record<string, string> = {
  EMPTY: "Introduce al menos un set.",
  NEGATIVE_OR_INVALID: "Hay un marcador no válido (los juegos van de 0 a 7).",
  TOO_MANY_SETS: "Un partido tiene como máximo tres sets.",
  SET_AFTER_FINISH: "El partido ya estaba decidido antes del último set.",
  INCOMPLETE_NOT_LAST: "Solo el último set puede estar sin terminar.",
  NOT_FINISHED: "El partido no está terminado. Si se acabó el tiempo, marca «terminó por tiempo».",
  FINISHED_BUT_MARKED_TIME: "El partido está terminado; quita la marca de «terminó por tiempo».",
};

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
