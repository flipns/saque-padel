import { madridToIso } from "@/lib/dates";

/** Franja semanal en la que un jugador puede jugar. weekday: 1 = lunes … 7 = domingo. Minutos desde las 00:00 (1440 = 24:00). */
export interface Slot { weekday: number; startMin: number; endMin: number; preferred?: boolean }

/** Excepción por fecha: «no disponible» (gana siempre) o disponibilidad extra. */
export interface Exception { date: string; startMin: number; endMin: number; status: "AVAILABLE" | "UNAVAILABLE"; preferred?: boolean; note?: string }

export interface PlayerCalendar { id: string; name?: string; slots: Slot[]; exceptions: Exception[] }

export const STEP = 30;        // granularidad de las franjas y de los horarios sugeridos
export const DURATION = 90;    // duración de un partido
export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtMin = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const pref = (p?: boolean) => Boolean(p);

type Interval = [number, number];

// ---------- Franjas semanales ----------

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

/**
 * Ordena y une las franjas del mismo tipo que se solapan o se tocan (18:00–20:00 + 20:00–22:00 → 18:00–22:00).
 * Una franja preferente puede solaparse con una normal: la preferente también cuenta como disponible.
 */
export function normalizeSlots(slots: Slot[]): Slot[] {
  const out: Slot[] = [];
  for (const p of [false, true]) {
    const sorted = slots.filter((s) => pref(s.preferred) === p).sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
    const merged: Slot[] = [];
    for (const s of sorted) {
      const last = merged[merged.length - 1];
      if (last && last.weekday === s.weekday && s.startMin <= last.endMin) last.endMin = Math.max(last.endMin, s.endMin);
      else merged.push({ weekday: s.weekday, startMin: s.startMin, endMin: s.endMin, preferred: p });
    }
    out.push(...merged);
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin || Number(pref(a.preferred)) - Number(pref(b.preferred)));
}

// ---------- Excepciones por fecha ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateExceptions(items: Exception[], today: string): string | null {
  if (items.length > 200) return "Demasiadas excepciones (máximo 200).";
  const limit = addDays(today, 150);
  for (const e of items) {
    if (!DATE_RE.test(e.date) || Number.isNaN(Date.parse(`${e.date}T00:00:00Z`))) return "Hay una fecha no válida.";
    if (e.date < today) return "No se pueden añadir excepciones en fechas pasadas.";
    if (e.date > limit) return "Solo se admiten fechas de los próximos 150 días.";
    if (e.status !== "AVAILABLE" && e.status !== "UNAVAILABLE") return "Hay una excepción incompleta.";
    if (!Number.isInteger(e.startMin) || !Number.isInteger(e.endMin) || e.startMin < 0 || e.endMin > 1440 || e.startMin % STEP !== 0 || e.endMin % STEP !== 0) return "Usa tramos de 30 minutos.";
    if (e.endMin <= e.startMin) return "La hora de fin debe ser posterior a la de inicio.";
    if (e.status === "UNAVAILABLE" && e.preferred) return "Una franja de «no disponible» no puede ser preferente.";
    if ((e.note ?? "").length > 80) return "La nota admite como máximo 80 caracteres.";
  }
  return null;
}

/** Une las excepciones de la misma fecha, estado y tipo que se solapan o se tocan. Conserva la nota de la primera. */
export function normalizeExceptions(items: Exception[]): Exception[] {
  const key = (e: Exception) => `${e.date}|${e.status}|${pref(e.preferred)}`;
  const groups = new Map<string, Exception[]>();
  for (const e of items) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  const out: Exception[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
    const merged: Exception[] = [];
    for (const e of sorted) {
      const last = merged[merged.length - 1];
      if (last && e.startMin <= last.endMin) { last.endMin = Math.max(last.endMin, e.endMin); last.note = last.note || e.note; }
      else merged.push({ ...e, preferred: e.status === "AVAILABLE" ? pref(e.preferred) : undefined });
    }
    out.push(...merged);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.status.localeCompare(b.status));
}

// ---------- Intervalos ----------

const union = (iv: Interval[]): Interval[] => {
  const sorted = iv.map((x): Interval => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return out;
};

const subtract = (a: Interval[], b: Interval[]): Interval[] => {
  let cur = a.map((x): Interval => [x[0], x[1]]);
  for (const [bs, be] of b) {
    const next: Interval[] = [];
    for (const [s, e] of cur) {
      if (be <= s || bs >= e) { next.push([s, e]); continue; }
      if (bs > s) next.push([s, bs]);
      if (be < e) next.push([be, e]);
    }
    cur = next;
  }
  return cur;
};

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [s1, e1] of a) for (const [s2, e2] of b) {
    const s = Math.max(s1, s2), e = Math.min(e1, e2);
    if (e > s) out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

const covers = (iv: Interval[], s: number, e: number) => iv.some(([a, b]) => a <= s && b >= e);
const overlaps = (iv: Interval[], s: number, e: number) => iv.some(([a, b]) => a < e && b > s);

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

// ---------- Disponibilidad efectiva de un jugador ----------

export interface DayIntervals { avail: Interval[]; pref: Interval[]; blocked: Interval[] }

/**
 * Disponibilidad de un jugador en una fecha: (pauta semanal ∪ disponibilidad extra) − bloqueos.
 * El bloqueo explícito prevalece siempre sobre la pauta semanal (CA-DISP-02).
 */
export function dayIntervals(cal: PlayerCalendar, date: string): DayIntervals {
  const wd = isoWeekday(date);
  const weekly = cal.slots.filter((s) => s.weekday === wd);
  const extra = cal.exceptions.filter((e) => e.date === date && e.status === "AVAILABLE");
  const blocked = union(cal.exceptions.filter((e) => e.date === date && e.status === "UNAVAILABLE").map((e): Interval => [e.startMin, e.endMin]));
  const avail = subtract(union([...weekly, ...extra].map((s): Interval => [s.startMin, s.endMin])), blocked);
  const prefer = subtract(union([...weekly.filter((s) => s.preferred), ...extra.filter((s) => s.preferred)].map((s): Interval => [s.startMin, s.endMin])), blocked);
  return { avail, pref: prefer, blocked };
}

/** Un jugador ha dicho algo sobre cuándo PUEDE jugar (pauta semanal o disponibilidad extra). */
export const hasAvailability = (cal: PlayerCalendar) => cal.slots.length > 0 || cal.exceptions.some((e) => e.status === "AVAILABLE");

export type PlayerStatus = "yes" | "no" | "unknown";

/** Estado de un jugador para un tramo: «yes» (lo cubre su disponibilidad), «no» (lo pisa un bloqueo explícito) o «unknown» (no consta). */
export function statusAt(d: DayIntervals, start: number, end: number): { status: PlayerStatus; preferred: boolean } {
  if (overlaps(d.blocked, start, end)) return { status: "no", preferred: false };
  if (covers(d.avail, start, end)) return { status: "yes", preferred: covers(d.pref, start, end) };
  return { status: "unknown", preferred: false };
}

// ---------- Cruce de calendarios ----------

export interface Candidate {
  startsAt: string; endsAt: string; date: string; weekday: number; startMin: number;
  /** 4 = los cuatro disponibles (óptimo); 3 = tres disponibles y falta confirmar a una persona (alternativa a consultar). */
  level: 4 | 3;
  unknownId?: string;       // en el nivel 3, el jugador que falta por confirmar
  preferredBy: number;      // cuántos jugadores lo tienen como franja preferente
}

export interface MatchingInput {
  /** Los cuatro jugadores del partido. */
  players: PlayerCalendar[];
  fromDate: string;            // primer día a considerar (hora de Madrid)
  toDate: string;              // último día incluido
  now: Date;
  windowStart: Date;           // no se sugiere nada antes (inicio de la fase)
  windowEnd: Date;             // los 90 minutos tienen que acabar como muy tarde aquí (cierre de la fase)
  busy?: { start: Date; end: Date }[];   // otros partidos de las dos parejas
  exclude?: Set<number>;       // inicios (en ms) que ya están propuestos
  duration?: number;
  step?: number;
  /** Incluir el nivel 3 de 4. Por defecto sí. */
  includeThree?: boolean;
}

/**
 * Cruce de los calendarios: genera inicios de partido (cada 30 min) dentro de la fase, en el futuro y sin pisar otro partido.
 * Nivel 4: los cuatro disponibles los 90 minutos completos. Nivel 3: tres disponibles y el cuarto «desconocido»
 * (nunca si ha marcado explícitamente que no puede). Lo desconocido jamás cuenta como disponible.
 */
export function candidates(input: MatchingInput): Candidate[] {
  const { players, fromDate, toDate, now, windowStart, windowEnd } = input;
  const duration = input.duration ?? DURATION, step = input.step ?? STEP;
  if (players.length !== 4) return [];
  const out: Candidate[] = [];

  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const days = players.map((p) => dayIntervals(p, date));
    for (let start = 0; start + duration <= 1440; start += step) {
      const st = days.map((d) => statusAt(d, start, start + duration));
      const yes = st.filter((x) => x.status === "yes").length;
      const no = st.filter((x) => x.status === "no").length;
      let level: 4 | 3 | 0 = 0, unknownId: string | undefined;
      if (yes === 4) level = 4;
      else if (yes === 3 && no === 0 && input.includeThree !== false) { level = 3; unknownId = players[st.findIndex((x) => x.status === "unknown")].id; }
      if (level === 0) continue;

      const startsAt = madridToIso(date, fmtMin(start));
      const t = Date.parse(startsAt), end = t + duration * 60000;
      if (t <= now.getTime() || t < windowStart.getTime() || end > windowEnd.getTime()) continue;
      if (input.exclude?.has(t)) continue;
      if (input.busy?.some((b) => t < b.end.getTime() && b.start.getTime() < end)) continue;
      out.push({ startsAt, endsAt: new Date(end).toISOString(), date, weekday: isoWeekday(date), startMin: start, level, unknownId, preferredBy: st.filter((x) => x.status === "yes" && x.preferred).length });
    }
  }
  return out;
}

/** Orden de recomendación: los 4/4 antes que los 3/4; dentro de cada nivel, más preferencias primero y después los más próximos. */
export function rankCandidates(list: Candidate[]): Candidate[] {
  return [...list].sort((a, b) => b.level - a.level || b.preferredBy - a.preferredBy || a.startsAt.localeCompare(b.startsAt));
}

export interface Classification {
  level: 4 | 3 | 0;
  conflict: boolean;          // algún jugador ha marcado explícitamente que no puede
  unknownId?: string;
  preferredBy: number;
}

/** Cómo encaja un horario concreto (p. ej. uno propuesto a mano) con los calendarios de los cuatro. */
export function classifyAt(players: PlayerCalendar[], date: string, startMin: number, duration = DURATION): Classification {
  const st = players.map((p) => statusAt(dayIntervals(p, date), startMin, startMin + duration));
  const yes = st.filter((x) => x.status === "yes").length, no = st.some((x) => x.status === "no");
  const unknown = st.findIndex((x) => x.status === "unknown");
  return {
    level: yes === 4 ? 4 : yes === 3 && !no ? 3 : 0,
    conflict: no,
    unknownId: yes === 3 && !no && unknown >= 0 ? players[unknown].id : undefined,
    preferredBy: st.filter((x) => x.status === "yes" && x.preferred).length,
  };
}
