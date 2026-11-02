import type { DivisionCode, LevelCode } from "./rules";

/**
 * Importa el CSV de respuestas del Google Form de inscripción.
 * Campos del Form: marca temporal, email, categoría, nombre y móvil del
 * primer jugador y nombre y móvil del segundo. Las columnas se localizan por
 * texto de cabecera, así que el orden o pequeños cambios de redacción no rompen la importación.
 */

export interface ImportedRow {
  rowNumber: number; // fila en el CSV (1 = cabecera)
  submittedAt: string | null;
  email: string;
  division: DivisionCode | null;
  level: LevelCode | null;
  categoryRaw: string;
  player1: { name: string; phone: string };
  player2: { name: string; phone: string };
  issues: string[];
  duplicateOf?: number; // fila más reciente que la sustituye
}

const strip = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const LEVELS: [LevelCode, string[]][] = [
  ["PREMIER", ["premier"]],
  ["ORO", ["oro", "gold"]],
  ["PLATA", ["plata", "silver"]],
  ["BRONCE", ["bronce", "bronze"]],
  ["ROOKIE", ["rookie"]],
];

/** "Brlonce Femenina" -> { FEMENINA, BRONCE }. Tolera erratas de 1–2 letras. */
export function parseCategory(raw: string): { division: DivisionCode | null; level: LevelCode | null } {
  const s = strip(raw);
  const division: DivisionCode | null = /femen/.test(s) ? "FEMENINA" : /mascul/.test(s) ? "MASCULINA" : null;
  const words = s.split(/[^a-z]+/).filter(Boolean);
  let level: LevelCode | null = null;
  let bestDist = Infinity;
  for (const w of words)
    for (const [code, names] of LEVELS)
      for (const n of names) {
        const dist = levenshtein(w, n);
        if (dist < bestDist && dist <= (n.length <= 3 ? 0 : 2)) {
          bestDist = dist;
          level = code;
        }
      }
  return { division, level };
}

/** Normaliza móviles españoles a +34XXXXXXXXX; deja intactos otros prefijos. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^0034\d{9}$/.test(digits)) return "+" + digits.slice(2);
  if (/^34\d{9}$/.test(digits)) return "+" + digits;
  if (/^[6789]\d{8}$/.test(digits)) return "+34" + digits;
  return digits;
}

const titleCase = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());

export function parseFormRows(table: string[][]): { rows: ImportedRow[]; headerIssues: string[] } {
  const headerIssues: string[] = [];
  if (table.length === 0) return { rows: [], headerIssues: ["El archivo está vacío"] };
  const header = table[0].map(strip);
  const find = (re: RegExp) => header.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0);

  const ts = find(/marca temporal|timestamp/)[0];
  const email = find(/correo|e-?mail/)[0];
  const cat = find(/categor/)[0];
  const names = find(/nombre/);
  const phones = find(/movil|telefono|tlf|phone/);

  if (email === undefined) headerIssues.push("No encuentro la columna de email");
  if (cat === undefined) headerIssues.push("No encuentro la columna de categoría");
  if (names.length < 2) headerIssues.push("Faltan las columnas de nombre de los dos jugadores");
  if (phones.length < 2) headerIssues.push("Faltan las columnas de móvil de los dos jugadores");
  if (headerIssues.length) return { rows: [], headerIssues };

  const rows: ImportedRow[] = [];
  table.slice(1).forEach((cells, idx) => {
    if (cells.every((c) => !c || !c.trim())) return;
    const get = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
    const categoryRaw = get(cat);
    const { division, level } = parseCategory(categoryRaw);
    const r: ImportedRow = {
      rowNumber: idx + 2,
      submittedAt: get(ts) || null,
      email: get(email).toLowerCase(),
      division,
      level,
      categoryRaw,
      player1: { name: titleCase(get(names[0])), phone: normalizePhone(get(phones[0])) },
      player2: { name: titleCase(get(names[1])), phone: normalizePhone(get(phones[1])) },
      issues: [],
    };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) r.issues.push("Email no válido");
    if (!division || !level) r.issues.push(`Categoría no reconocida: «${categoryRaw}»`);
    if (division === "FEMENINA" && (level === "PREMIER" || level === "ROOKIE"))
      r.issues.push("Esa categoría no existe en la división femenina");
    if (!r.player1.name || !r.player2.name) r.issues.push("Falta el nombre de algún jugador");
    for (const p of [r.player1, r.player2])
      if (p.phone && !/^\+\d{9,15}$/.test(p.phone)) r.issues.push(`Móvil dudoso: ${p.phone}`);
    if (r.player1.name && strip(r.player1.name) === strip(r.player2.name)) r.issues.push("Los dos jugadores tienen el mismo nombre");
    rows.push(r);
  });

  // Duplicados: misma pareja (nombres) en la misma categoría. Se queda la fila más reciente.
  const keyOf = (r: ImportedRow) =>
    [r.division, r.level, ...[strip(r.player1.name), strip(r.player2.name)].sort()].join("|");
  const last = new Map<string, ImportedRow>();
  for (const r of rows) {
    const k = keyOf(r);
    const prev = last.get(k);
    if (prev) prev.duplicateOf = r.rowNumber;
    last.set(k, r);
  }
  // Un mismo jugador (por móvil) inscrito en dos parejas distintas.
  const byPhone = new Map<string, number>();
  for (const r of rows.filter((x) => !x.duplicateOf))
    for (const p of [r.player1, r.player2]) {
      if (!p.phone) continue;
      const other = byPhone.get(p.phone);
      if (other !== undefined && other !== r.rowNumber) r.issues.push(`${p.name} ya aparece en la fila ${other}`);
      else byPhone.set(p.phone, r.rowNumber);
    }
  return { rows, headerIssues };
}
