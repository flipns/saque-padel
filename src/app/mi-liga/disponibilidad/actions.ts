"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeSlots, validateSlots, type Slot } from "@/lib/availability";

/** Guarda las franjas semanales de un jugador (el propio o su compañero/a). La base de datos comprueba los permisos. */
export async function saveAvailabilityAction(playerId: string, slots: Slot[]): Promise<{ ok: boolean; error?: string; slots?: Slot[] }> {
  const bad = validateSlots(slots);
  if (bad) return { ok: false, error: bad };
  const norm = normalizeSlots(slots);
  const sb = await supabaseServer();
  const { error } = await sb.rpc("save_availability", { p_player: playerId, p_slots: norm.map((s) => ({ weekday: s.weekday, start: s.startMin, end: s.endMin })) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, slots: norm };
}
