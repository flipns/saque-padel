import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addDays, candidates, fmtMin, DURATION, type Slot } from "@/lib/availability";
import { isoToMadridParts, madridToIso } from "@/lib/dates";
import { loadMatches, type MatchView, type PairView } from "@/lib/data";

export const FILTERS = [["todos", "Todos"], ["semana", "Entre semana"], ["finde", "Fin de semana"], ["manana", "Mañanas"], ["tarde", "Tardes"]] as const;

export interface SuggestionDay { date: string; label: string; options: { iso: string; start: string; end: string }[]; more: number }
export interface Suggestions { missing: { id: string; name: string }[]; days: SuggestionDay[]; total: number; hiddenDays: number }

const CLOSED = ["COMPLETED", "WO", "NOT_PLAYED", "CANCELLED"];

/**
 * Horarios en los que los cuatro jugadores pueden (90 minutos completos), dentro de la fase y sin pisar otro partido.
 * Lee los calendarios con permisos de servidor y devuelve SOLO las coincidencias: nadie ve el calendario de otro (RF-DISP-08).
 * El llamador debe haber comprobado ya que quien consulta juega este partido.
 */
export async function loadMatchSuggestions(
  sb: SupabaseClient, seasonId: string, m: MatchView, pairs: PairView[], phase: { starts_on: string; results_deadline: string },
  opts: { filter: string; maxDays: number; excludeMs: number[] }
): Promise<Suggestions> {
  const players = [...new Map(pairs.filter((p) => p.id === m.pairA || p.id === m.pairB).flatMap((p) => p.players).map((x) => [x.id, x])).values()];
  const ids = players.map((p) => p.id);
  const { data } = await supabaseAdmin().from("availability_rules").select("player_id, weekday, start_min, end_min").in("player_id", ids).limit(2000);
  const byPlayer = new Map<string, Slot[]>();
  for (const r of (data ?? []) as any[]) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), { weekday: r.weekday, startMin: r.start_min, endMin: r.end_min }]);
  const missing = players.filter((p) => !(byPlayer.get(p.id)?.length)).map((p) => ({ id: p.id, name: p.name }));

  // Otros partidos de las dos parejas que ocupan una pista (programados o con fecha acordada).
  const others = (await loadMatches(sb, seasonId, { pairIds: [m.pairA, m.pairB] })).filter((x) => x.id !== m.id && !CLOSED.includes(x.status));
  const busy = others.flatMap((x) => [x.scheduledAt, x.agreedStartAt].filter(Boolean).map((t) => ({ start: new Date(t!), end: new Date(new Date(t!).getTime() + DURATION * 60000) })));

  const now = new Date();
  const today = isoToMadridParts(now.toISOString()).date;
  const all = players.length === 4 && missing.length === 0
    ? candidates({
        rules: players.map((p) => byPlayer.get(p.id) ?? []),
        fromDate: today > phase.starts_on ? today : phase.starts_on, toDate: phase.results_deadline, now,
        windowStart: new Date(madridToIso(phase.starts_on, "00:00")), windowEnd: new Date(madridToIso(addDays(phase.results_deadline, 1), "00:00")),
        busy, exclude: new Set(opts.excludeMs),
      })
    : [];

  const filtered = all.filter((c) => {
    switch (opts.filter) {
      case "semana": return c.weekday <= 5;
      case "finde": return c.weekday >= 6;
      case "manana": return c.startMin < 14 * 60;
      case "tarde": return c.startMin >= 14 * 60;
      default: return true;
    }
  });
  const byDate = new Map<string, typeof filtered>();
  for (const c of filtered) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  const dates = [...byDate.keys()];
  const days: SuggestionDay[] = dates.slice(0, opts.maxDays).map((date) => {
    const list = byDate.get(date)!;
    return {
      date,
      label: (l => l.charAt(0).toUpperCase() + l.slice(1))(new Date(madridToIso(date, "12:00")).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" })),
      options: list.slice(0, 10).map((c) => ({ iso: c.startsAt, start: fmtMin(c.startMin), end: fmtMin(c.startMin + DURATION) })),
      more: Math.max(0, list.length - 10),
    };
  });
  return { missing, days, total: filtered.length, hiddenDays: Math.max(0, dates.length - days.length) };
}
