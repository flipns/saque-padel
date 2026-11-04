import type { SupabaseClient } from "@supabase/supabase-js";

/** Registro de auditoría. Un fallo al registrar no debe impedir la acción principal. */
export async function audit(sb: SupabaseClient, actor: string | undefined | null, action: string, entity: string, entityId?: string, after?: unknown, reason?: string) {
  const { error } = await sb.from("audit_log").insert({ actor: actor ?? null, action, entity, entity_id: entityId ?? null, after: after ?? null, reason: reason ?? null });
  if (error) console.error("audit failed", error.message);
}
