import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Adónde mandar a alguien recién identificado: administración al panel; jugadores a su zona. */
export async function destinationAfterLogin(sb: SupabaseClient, next?: string | null): Promise<string> {
  const safe = next && next.startsWith("/") && !next.startsWith("//") && next !== "/" && !next.startsWith("/acceso") ? next : null;
  if (safe) return safe;
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (isAdmin) return "/admin";
  return "/"; // cuando exista la zona de jugador: "/mi-liga"
}
