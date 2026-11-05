import type { SupabaseClient } from "@supabase/supabase-js";

/** Avisa a todos los emails con acceso a unas parejas (para acciones de la organización). Un fallo aquí nunca interrumpe la acción principal. */
export async function notifyPairs(sb: SupabaseClient, pairIds: string[], n: { matchId?: string | null; kind: string; title: string; body: string }) {
  try {
    const { data } = await sb.from("pair_access").select("email").in("pair_id", pairIds);
    const emails = [...new Set(((data ?? []) as any[]).map((r) => r.email as string))];
    if (emails.length === 0) return;
    const { error } = await sb.from("notifications").insert(emails.map((email) => ({ email, match_id: n.matchId ?? null, kind: n.kind, title: n.title, body: n.body })));
    if (error) console.error("notifyPairs failed", error.message);
  } catch (e) {
    console.error("notifyPairs failed", e);
  }
}
