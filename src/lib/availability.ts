import { madridToIso } from "@/lib/dates";

/** Franja semanal en la que un jugador puede jugar. weekday: 1 = lunes … 7 = domingo. Minutos desde las 00:00 (1440 = 24:00). */
export interface Slot { weekday: number; startMin: number; endMin: number }

export const STEP = 30;        // granularidad de las franjas y de los horarios sugeridos
export const DURATION = 90;    // duración de un partido
export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtMin = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Devuelve el motivo si hay alguna franja no válida; null si todas lo son. */
export function validateSlots(slots: Slot[]): string | null {
  if (slots.length > 56) return "Demasiadas franjas (máximo 56).";
  for (const s of slots) {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) return "Hay un día no válido.";
    if (!Number.isInteger(s.startMin) || !Number.isInteger(s.endMin)) return "Hay una hora no válida.";
    if (s.startMin < 0 || s.endMin > 1440) return "Las horas deben estar entre las 00:00 y las 24:00.";
    if (s.startMin % STEP !== 0 || s.endMin % STEP !== 0) return "Usa tramos de 30 minutos.";
    if (s.endMin <= s.startMin) return `En ${WEEKDAYS[s.weekday - 1].toLowerCase()}, la hora de fin debe ser posterior a la de inicio.`;
  }
  return null;
}

/** Ordena y une las franjas que se solapan o se tocan (18:00–20:00 + 20:00–22:00 → 18:00–22:00). */
export function normalizeSlots(slots: Slot[]): Slot[] {
  const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  const out: Slot[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.weekday === s.weekday && s.startMin <= last.endMin) last.endMin = Math.max(last.endMin, s.endMin);
    else out.push({ ...s });
  }
  return out;
}

type Interval = [number, number];

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [s1, e1] of a) for (const [s2, e2] of b) {
    const s = Math.max(s1, s2), e = Math.min(e1, e2);
    if (e > s) out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Día de la semana (1 = lunes … 7 = domingo) de una fecha «AAAA-MM-DD». */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface Candidate { startsAt: string; endsAt: string; date: string; weekday: number; startMin: number }

export interface MatchingInput {
  /** Una lista de franjas por jugador (los cuatro). Una lista vacía significa «sin información»: no hay coincidencias. */
  rules: Slot[][];
  fromDate: string;            // primer día a considerar (hora de Madrid)
  toDate: string;              // último día incluido
  now: Date;
  windowStart: Date;           // no se sugiere nada antes (inicio de la fase)
  windowEnd: Date;             // los 90 minutos tienen que acabar como muy tarde aquí (cierre de la fase)
  busy?: { start: Date; end: Date }[];   // otros partidos de las dos parejas
  exclude?: Set<number>;       // inicios (en ms) que ya están propuestos
  duration?: number;
  step?: number;
}

/**
 * Cruce de los calendarios de los cuatro jugadores: genera inicios de partido (cada 30 min) en los que
 * los cuatro están disponibles durante los 90 minutos completos, dentro de la fase, en el futuro y sin pisar otro partido.
 */
export function candidates(input: MatchingInput): Candidate[] {
  const { rules, fromDate, toDate, now, windowStart, windowEnd } = input;
  const duration = input.duration ?? DURATION, step = input.step ?? STEP;
  if (rules.length === 0 || rules.some((r) => r.length === 0)) return [];
  const byPlayer = rules.map((r) => normalizeSlots(r));
  const out: Candidate[] = [];

  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const wd = isoWeekday(date);
    const perPlayer = byPlayer.map((r) => r.filter((s) => s.weekday === wd).map((s): Interval => [s.startMin, s.endMin]));
    if (perPlayer.some((p) => p.length === 0)) continue;
    let common = perPlayer[0];
    for (let i = 1; i < perPlayer.length; i++) common = intersectIntervals(common, perPlayer[i]);
    for (const [s, e] of common) {
      for (let start = s; start + duration <= e; start += step) {
        const startsAt = madridToIso(date, fmtMin(start));
        const t = Date.parse(startsAt), end = t + duration * 60000;
        if (t <= now.getTime() || t < windowStart.getTime() || end > windowEnd.getTime()) continue;
        if (input.exclude?.has(t)) continue;
        if (input.busy?.some((b) => t < b.end.getTime() && b.start.getTime() < end)) continue;
        out.push({ startsAt, endsAt: new Date(end).toISOString(), date, weekday: wd, startMin: start });
      }
    }
  }
  return out;
}
