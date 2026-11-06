"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeExceptions, normalizeSlots, validateExceptions, validateSlots, type Exception, type Slot } from "@/lib/availability";
import { isoToMadridParts } from "@/lib/dates";

/** Guarda las franjas semanales de un jugador (el propio o su compañero/a). La base de datos comprueba los permisos. */
export async function saveAvailabilityAction(playerId: string, slots: Slot[]): Promise<{ ok: boolean; error?: string; slots?: Slot[] }> {
  const bad = validateSlots(slots);
  if (bad) return { ok: false, error: bad };
  const norm = normalizeSlots(slots);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("save_availability", { p_player: playerId, p_slots: norm.map((s) => ({ weekday: s.weekday, start: s.startMin, end: s.endMin, preferred: Boolean(s.preferred) })) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, slots: norm };
}

/** Guarda las excepciones por fecha de un jugador (sustituye las de hoy en adelante). La base de datos comprueba los permisos. */
export async function saveExceptionsAction(playerId: string, items: Exception[]): Promise<{ ok: boolean; error?: string; items?: Exception[] }> {
  const today = isoToMadridParts(new Date().toISOString()).date;
  const bad = validateExceptions(items, today);
  if (bad) return { ok: false, error: bad };
  const norm = normalizeExceptions(items);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("save_exceptions", {
    p_player: playerId,
    p_items: norm.map((e) => ({ date: e.date, start: e.startMin, end: e.endMin, status: e.status, preferred: Boolean(e.preferred), note: e.note ?? null })),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, items: norm };
}
