import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addDays, candidates, classifyAt, fmtMin, hasAvailability, rankCandidates, DURATION, type Candidate, type Exception, type PlayerCalendar, type Slot } from "@/lib/availability";
import { isoToMadridParts, madridToIso } from "@/lib/dates";
import { loadMatches, type MatchView, type PairView } from "@/lib/data";

export const FILTERS = [["todos", "Todos"], ["semana", "Entre semana"], ["finde", "Fin de semana"], ["manana", "Mañanas"], ["tarde", "Tardes"]] as const;

export interface SuggestionOption { iso: string; start: string; end: string; preferredBy: number; unknownName?: string }
export interface SuggestionDay { date: string; label: string; options: SuggestionOption[]; more: number }
export interface Hint { text: string; tone: "ok" | "warn" | "bad" | "muted" }
export interface Suggestions {
  missing: { id: string; name: string }[];
  best: (SuggestionOption & { label: string })[];   // los mejores 4/4 (más preferencias y más próximos)
  days: SuggestionDay[];                             // 4 de 4, por día
  alt: SuggestionDay[];                              // 3 de 4 (alternativas a consultar), por día
  total4: number; total3: number; hiddenDays: number; hiddenAltDays: number;
  hints: Record<string, Hint>;                       // cómo encaja con los calendarios cada horario ya propuesto
}

const CLOSED = ["COMPLETED", "WO", "NOT_PLAYED", "CANCELLED"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDay = (date: string, o: Intl.DateTimeFormatOptions) => new Date(madridToIso(date, "12:00")).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", ...o });

/**
 * Horarios en los que los cuatro jugadores pueden (90 minutos completos), dentro de la fase y sin pisar otro partido.
 * Además de los 4 de 4, ofrece como «alternativas a consultar» los 3 de 4 en los que falta confirmar a una persona.
 * Lee los calendarios con permisos de servidor y devuelve SOLO coincidencias: nadie ve el calendario de otro (RF-DISP-08).
 * El llamador debe haber comprobado ya que quien consulta juega este partido.
 */
export async function loadMatchSuggestions(
  sb: SupabaseClient, seasonId: string, m: MatchView, pairs: PairView[], phase: { starts_on: string; results_deadline: string },
  opts: { filter: string; maxDays: number; excludeMs: number[]; options: { id: string; startsAt: string }[] }
): Promise<Suggestions> {
  const players = [...new Map(pairs.filter((p) => p.id === m.pairA || p.id === m.pairB).flatMap((p) => p.players).map((x) => [x.id, x])).values()];
  const ids = players.map((p) => p.id);
  const now = new Date();
  const today = isoToMadridParts(now.toISOString()).date;

  // Calendarios y otros partidos de las dos parejas, a la vez (antes se pedían uno detrás de otro).
  const db = supabaseAdmin();
  const [rulesRes, excRes, allOthers] = await Promise.all([
    db.from("availability_rules").select("player_id, weekday, start_min, end_min, preferred").in("player_id", ids).limit(2000),
    db.from("availability_exceptions").select("player_id, on_date, start_min, end_min, status, preferred").in("player_id", ids).gte("on_date", today).limit(2000),
    loadMatches(sb, seasonId, { pairIds: [m.pairA, m.pairB] }),
  ]);
  const cals: PlayerCalendar[] = players.map((p) => ({
    id: p.id, name: p.name,
    slots: ((rulesRes.data ?? []) as any[]).filter((r) => r.player_id === p.id).map((r): Slot => ({ weekday: r.weekday, startMin: r.start_min, endMin: r.end_min, preferred: r.preferred })),
    exceptions: ((excRes.data ?? []) as any[]).filter((r) => r.player_id === p.id).map((r): Exception => ({ date: r.on_date, startMin: r.start_min, endMin: r.end_min, status: r.status, preferred: r.preferred })),
  }));
  const missing = cals.filter((c) => !hasAvailability(c)).map((c) => ({ id: c.id, name: c.name ?? "" }));
  const nameOf = new Map(players.map((p) => [p.id, p.name]));

  // Otros partidos de las dos parejas que ocupan una pista (programados o con fecha acordada).
  const others = allOthers.filter((x) => x.id !== m.id && !CLOSED.includes(x.status));
  const busy = others.flatMap((x) => [x.scheduledAt, x.agreedStartAt].filter(Boolean).map((t) => ({ start: new Date(t!), end: new Date(new Date(t!).getTime() + DURATION * 60000) })));

  const all = candidates({
    players: cals, fromDate: today > phase.starts_on ? today : phase.starts_on, toDate: phase.results_deadline, now,
    windowStart: new Date(madridToIso(phase.starts_on, "00:00")), windowEnd: new Date(madridToIso(addDays(phase.results_deadline, 1), "00:00")),
    busy, exclude: new Set(opts.excludeMs),
  });
  const filtered = all.filter((c) => {
    switch (opts.filter) {
      case "semana": return c.weekday <= 5;
      case "finde": return c.weekday >= 6;
      case "manana": return c.startMin < 14 * 60;
      case "tarde": return c.startMin >= 14 * 60;
      default: return true;
    }
  });
  const four = filtered.filter((c) => c.level === 4), three = filtered.filter((c) => c.level === 3);

  const toOption = (c: Candidate): SuggestionOption => ({
    iso: c.startsAt, start: fmtMin(c.startMin), end: fmtMin(c.startMin + DURATION), preferredBy: c.preferredBy,
    unknownName: c.unknownId ? nameOf.get(c.unknownId) : undefined,
  });
  const group = (list: Candidate[], maxDays: number) => {
    const byDate = new Map<string, Candidate[]>();
    for (const c of list) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
    const dates = [...byDate.keys()];
    const days: SuggestionDay[] = dates.slice(0, maxDays).map((date) => {
      const l = byDate.get(date)!;
      return { date, label: cap(fmtDay(date, { weekday: "long", day: "numeric", month: "long" })), options: l.slice(0, 10).map(toOption), more: Math.max(0, l.length - 10) };
    });
    return { days, hidden: Math.max(0, dates.length - days.length) };
  };
  const g4 = group(four, opts.maxDays), g3 = group(three, Math.min(opts.maxDays, 6));
  const best = rankCandidates(four).slice(0, 3).map((c) => ({ ...toOption(c), label: `${fmtDay(c.date, { weekday: "short", day: "numeric", month: "short" })} · ${fmtMin(c.startMin)}` }));

  // Cómo encaja con los calendarios cada horario ya propuesto (a mano o sugerido): solo orienta, nunca bloquea (RF-DISP-20/22).
  const hints: Record<string, Hint> = {};
  for (const o of opts.options) {
    const { date, time } = isoToMadridParts(o.startsAt);
    const [h, mm] = time.split(":").map(Number);
    const c = classifyAt(cals, date, h * 60 + mm);
    hints[o.id] = c.conflict ? { text: "Posible conflicto de disponibilidad", tone: "bad" }
      : c.level === 4 ? { text: "Encaja con los 4 calendarios", tone: "ok" }
      : c.level === 3 ? { text: `Falta confirmar a ${nameOf.get(c.unknownId ?? "") ?? "una persona"}`, tone: "warn" }
      : { text: "No consta disponibilidad completa", tone: "muted" };
  }
  return { missing, best, days: g4.days, alt: g3.days, total4: four.length, total3: three.length, hiddenDays: g4.hidden, hiddenAltDays: g3.hidden, hints };
}
