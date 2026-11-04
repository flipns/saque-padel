import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOT_DESTINATIONS = ["/", "/acceso", "/crear-contrasena"];

/**
 * Adónde mandar a alguien recién identificado:
 * sin contraseña -> a crearla; con `next` seguro -> allí; administración -> panel; jugadores -> su liga.
 */
export async function destinationAfterLogin(sb: SupabaseClient, next?: string | null): Promise<string> {
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return "/acceso";
  const safe = next && next.startsWith("/") && !next.startsWith("//") && !NOT_DESTINATIONS.includes(next.split("?")[0]) ? next : null;
  if (!user.app_metadata?.has_password) {
    return `/crear-contrasena${safe ? `?next=${encodeURIComponent(safe)}` : ""}`;
  }
  if (safe) return safe;
  const { data: isAdmin } = await sb.rpc("is_admin");
  return isAdmin ? "/admin" : "/mi-liga";
}
